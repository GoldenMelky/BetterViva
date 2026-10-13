"""Unisce agenda e compiti di ClasseViva in un unico elenco di eventi.

Evento: {id, date, subject, subject_id, teacher, text, kind, code, source}
- kind: "verifica", "interrogazione" o None, riconosciuto dal testo (vedi verifiche.py)
- subject_id: id della materia dello studente (None se non è riconducibile a una materia)
- id: stabile, calcolato da data + materia + testo (uguale per agenda e compiti)
- code: evtCode grezzo di ClasseViva, per riconoscere in futuro verifiche/interrogazioni
"""
import hashlib
import json
import re
from datetime import date, timedelta
from pathlib import Path

from verifiche import classify

# Facoltativo: subjects.json = {"MATEMATICA E COMPLEMENTI": "Matematica", ...}
SUBJECTS_FILE = Path(__file__).parent / "subjects.json"
# Per i compiti la data che conta è quella di scadenza; se manca si ripiega sulle altre
HW_DATE_KEYS = ("expiryDate", "evtDatetimeBegin", "evtDate", "assignmentDate")


def _tokens(name: str) -> frozenset:
    """'DI MARIA FEDERICA' e 'Federica Di Maria' sono lo stesso docente."""
    return frozenset(re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).split())


def make_resolver(subjects: list[dict], names: dict[int, str], schedule: dict[int, list[int]]):
    """Ritorna resolve(item, day) -> id materia | None.

    subjects: materie dello studente (id, description, teachers) da ClasseViva
    names:    id materia -> nome da mostrare
    schedule: giorno della settimana (0 = lunedì) -> id materia in ordine di ora

    Ordine dei tentativi:
    1. subjectId dell'evento, se è una materia dello studente;
    2. subjectDesc (nome originale o nome mostrato);
    3. solo se l'evento non ha materia (l'agenda mette l'autore): il docente.
       Se il docente ha più materie si sceglie la prima in orario quel giorno.
    """
    known = {s["id"] for s in subjects}
    by_name: dict[str, int] = {}
    for s in subjects:
        by_name[s["description"].strip().upper()] = s["id"]
    for sid, name in names.items():
        by_name.setdefault(name.strip().upper(), sid)

    by_teacher: dict[frozenset, set[int]] = {}
    for s in subjects:
        if s["description"] == "EDUCAZIONE CIVICA":   # elenca tutti i docenti: inutile per riconoscere
            continue
        for t in s.get("teachers", []):
            by_teacher.setdefault(_tokens(t["teacherName"]), set()).add(s["id"])

    def resolve(item: dict, day: str) -> int | None:
        if item.get("subjectId") in known:
            return item["subjectId"]
        desc = (item.get("subjectDesc") or "").strip().upper()
        if desc:
            return by_name.get(desc)
        candidates = by_teacher.get(_tokens(item.get("authorName")), set())
        if len(candidates) <= 1:
            return next(iter(candidates), None)
        for sid in schedule.get(date.fromisoformat(day).weekday(), []):
            if sid in candidates:
                return sid
        return None

    return resolve


def _short_subjects() -> dict:
    try:
        return json.loads(SUBJECTS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _title(value: str) -> str:
    return (value or "").strip().title()


def _day(value) -> str | None:
    return value[:10] if isinstance(value, str) and re.match(r"\d{4}-\d{2}-\d{2}", value) else None


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip().lower()


def _event(item: dict, day: str, source: str, subjects: dict, resolve, names: dict[int, str]) -> dict:
    subject_id = resolve(item, day)
    raw_subject = (item.get("subjectDesc") or item.get("authorName") or "").strip()
    if subject_id is not None:
        subject = names.get(subject_id) or _title(raw_subject)
    else:
        subject = subjects.get(raw_subject.upper()) or subjects.get(raw_subject) or _title(raw_subject)
    text = (item.get("notes") or item.get('homeworkDesc') or "").strip()
    # La stessa chiave riconosce l'evento anche quando arriva da due fonti
    # (con la materia risolta, agenda e compiti coincidono anche se uno dei due ha solo il docente).
    event_key = f"{day}|{subject_id if subject_id is not None else _norm(subject)}|{_norm(text)}"
    return {
        "id": hashlib.sha1(event_key.encode()).hexdigest()[:12],
        "date": day,
        "subject": subject,
        "subject_id": subject_id,
        "teacher": _title(item.get("authorName")),
        "text": text,
        "kind": classify(text),   # "verifica" | "interrogazione" | None
        "code": item.get("evtCode"),
        "source": [source],
    }


def build_events(user, days: int, subject_list: list[dict] | None = None,
                 names: dict[int, str] | None = None,
                 schedule: dict[int, list[int]] | None = None,
                 since: date | None = None, until: date | None = None) -> list[dict]:
    """Eventi da `since` (default oggi) a `until` (default oggi + days), estremi inclusi."""
    first = since or date.today()
    last = until or first + timedelta(days=days)
    api_date_format = "%Y%m%d"
    agenda = user.agenda(first.strftime(api_date_format), last.strftime(api_date_format))["agenda"]
    # date_field=None: nessun filtro del wrapper, filtriamo qui con la data giusta
    homeworks = user.homeworks(
        first.strftime(api_date_format), last.strftime(api_date_format), date_field=None
    )["items"]

    subjects = _short_subjects()
    names = names or {}
    resolve = make_resolver(subject_list or [], names, schedule or {})
    merged: dict[str, dict] = {}

    def add_event(item, event_day, source):
        if not event_day or not (first.isoformat() <= event_day <= last.isoformat()):
            return
        event = _event(item, event_day, source, subjects, resolve, names)
        existing_event = merged.get(event["id"])
        if existing_event:  # Unisce le fonti dello stesso evento e conserva il codice disponibile.
            existing_event["source"] = sorted(set(existing_event["source"]) | {source})
            existing_event["code"] = existing_event["code"] or event["code"]
        else:
            merged[event["id"]] = event

    for agenda_item in agenda:
        add_event(agenda_item, _day(agenda_item.get("evtDatetimeBegin")), "agenda")
    for homework_item in homeworks:
        # Preferisce la scadenza dei compiti, usando le altre date come ripiego in ordine.
        homework_day = next(
            (
                parsed_day
                for date_key in HW_DATE_KEYS
                if (parsed_day := _day(homework_item.get(date_key)))
            ),
            None,
        )
        add_event(homework_item, homework_day, "homework")

    return sorted(merged.values(), key=lambda event: (event["date"], event["subject"]))
