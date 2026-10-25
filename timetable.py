"""Rilevamento dell'orario settimanale dalle lezioni già svolte.

Funzioni pure (niente rete, niente database): ricevono le liste grezze di
ClasseViva (`lessons`, `subjects`) e restituiscono una *proposta* di orario
che l'utente dovrà verificare e correggere.

Come ragiona:
- ogni lezione ha giorno (`evtDate`) e ora (`evtHPos`); una cella unita su
  più ore sono semplicemente più `evtHPos` consecutivi;
- una lezione è "reale" se la materia è tra quelle dello studente e non è
  una supplenza; supplenze e progetti (materie fuori da `subjects`)
  dicono solo "slot occupato", non quale materia;
- ogni osservazione pesa meno quanto più è vecchia (dimezza ogni
  HALF_LIFE_DAYS giorni), così un orario provvisorio di settembre conta
  poco rispetto a quello in uso adesso.
"""
from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date, timedelta
from pathlib import Path

HALF_LIFE_DAYS = 10.0   # peso delle osservazioni: dimezza ogni 10 giorni
LOOKBACK_DAYS = 28      # quanto indietro andare a leggere le lezioni (basta 1 richiesta)
MAX_HPOS = 12
MIN_SLOTS = 6           # righe mostrate al minimo (se non ci sono dati)
MAX_NAME = 40           # lunghezza massima di un nome materia scelto dall'utente
SUBJECT_COLORS = ("red", "green", "blue", "yellow", "brown", "purple", "orange", "teal", "pink")
LAB_TYPE = "Attività di laboratorio"
COMPRESENCE = "LSC0"    # riga di compresenza: secondo docente nell'ora
# Dizionario materia intera -> nome breve: {"MATEMATICA E COMPLEMENTI": "Matematica", ...}
# (è lo stesso subjects.json usato da events.py). Facoltativo: senza voce si usa
# il nome originale in minuscolo con l'iniziale maiuscola.
SUBJECTS_FILE = Path(__file__).parent / "subjects.json"


def _norm(name: str) -> frozenset:
    """'FEDERICA DI MARIA' e 'DI MARIA FEDERICA' sono lo stesso docente."""
    return frozenset(name.upper().replace("'", " ").split())


def short_names() -> dict[str, str]:
    """Legge il dizionario materia intera -> rinominata (chiavi in maiuscolo)."""
    try:
        raw = json.loads(SUBJECTS_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(raw, dict):
        return {}
    return {str(k).strip().upper(): v.strip() for k, v in raw.items() if isinstance(v, str) and v.strip()}


def default_name(description: str, names: dict[str, str]) -> str:
    """Nome proposto per una materia: dal dizionario, altrimenti 'Materia lunga' ->
    iniziale maiuscola, resto minuscolo, entro MAX_NAME caratteri."""
    name = names.get(description.strip().upper()) or description.strip().capitalize()
    return name[:MAX_NAME].strip()


def school_year(d: date) -> str:
    """'2026-27' per qualsiasi data tra settembre 2026 e agosto 2027."""
    y = d.year if d.month >= 9 else d.year - 1
    return f"{y}-{(y + 1) % 100:02d}"


def lookback_start(today: date) -> date:
    """Prima data da cui leggere le lezioni (mai prima dell'inizio dell'anno)."""
    year_start = date(today.year if today.month >= 9 else today.year - 1, 9, 1)
    return max(year_start, today - timedelta(days=LOOKBACK_DAYS))


def detect(lessons: list[dict], subjects: list[dict], today: date,
           half_life: float | None = HALF_LIFE_DAYS) -> dict:
    known = {s["id"]: s["description"] for s in subjects}
    # Docenti con più materie (es. Italiano e Storia): in uno slot il docente è
    # quasi sempre giusto, la materia no (può fare l'altra o firmare nell'ora
    # sbagliata). "Educazione civica" elenca tutti i docenti, quindi si ignora.
    per_teacher: dict[str, set] = defaultdict(set)
    for s_ in subjects:
        if s_["description"] != "EDUCAZIONE CIVICA":
            for t in s_.get("teachers", []):
                per_teacher[_norm(t["teacherName"])].add(s_["id"])
    multi = {t for t, subs in per_teacher.items() if len(subs) > 1}

    # (data, ora) -> righe di lezione (principale + compresenze)
    slots: dict[tuple[date, int], list[dict]] = defaultdict(list)
    for l in lessons:
        try:
            d = date.fromisoformat(l["evtDate"])
            h = int(l["evtHPos"])
        except (KeyError, TypeError, ValueError):
            continue
        if d > today or not 1 <= h <= MAX_HPOS:
            continue
        slots[(d, h)].append(l)

    votes: dict[tuple[int, int], Counter] = defaultdict(Counter)      # cella -> materia -> peso
    teachers: dict[tuple[int, int, int], Counter] = defaultdict(Counter)  # (giorno, ora, materia) -> docente -> peso
    n_real: Counter = Counter()      # cella -> quante volte vista una lezione reale
    n_subst: Counter = Counter()     # cella -> quante volte solo supplenza/progetto
    real_w: Counter = Counter()      # cella -> peso totale delle osservazioni reali
    subst_w: Counter = Counter()     # cella -> peso totale delle supplenze/progetti
    lab_w: Counter = Counter()       # cella -> peso di quelle con indizi di laboratorio
    lab_subjects: set[int] = set()
    max_h = 0

    for (d, h), parts in slots.items():
        wd = d.weekday()
        cell = (wd, h)
        max_h = max(max_h, h)
        w = 1.0 if not half_life else 0.5 ** ((today - d).days / half_life)
        real = [p for p in parts
                if p.get("subjectId") in known and p.get("lessonType") != "Supplenza"]
        if not real:
            n_subst[cell] += 1
            subst_w[cell] += w
            continue
        n_real[cell] += 1
        real_w[cell] += w
        # Indizi di laboratorio: tipo di lezione "Attività di laboratorio" oppure
        # un secondo docente (compresenza). Il secondo è solo un indizio: va bene
        # per il laboratorio tecnico, ma altrove può essere un docente di sostegno.
        if any(p.get("lessonType") == LAB_TYPE or p.get("evtCode") == COMPRESENCE for p in real):
            lab_w[cell] += w
            lab_subjects |= {p["subjectId"] for p in real}
        for sid in {p["subjectId"] for p in real}:
            votes[cell][sid] += w
        for p in real:
            teachers[(wd, h, p["subjectId"])][p.get("authorName", "")] += w

    days = sorted({wd for wd, _ in list(votes) + list(n_subst)} | {0, 1, 2, 3, 4})
    n_slots = max(max_h, MIN_SLOTS)

    cells = []
    for wd in days:
        for h in range(1, n_slots + 1):
            cell = (wd, h)
            out = {"weekday": wd, "hpos": h, "subject_id": None, "subject": None,
                   "teachers": [], "status": "empty", "observations": n_real[cell],
                   "candidates": [], "lab": False}
            if votes[cell] and subst_w[cell] > real_w[cell]:
                # Le osservazioni recenti sono quasi tutte supplenze: la materia vista
                # in passato è probabilmente di un altro orario o di un docente assente.
                out.update(status="substituted",
                           candidates=[sid for sid, _ in votes[cell].most_common()])
            elif votes[cell]:
                ranked = votes[cell].most_common()
                total = sum(v for _, v in ranked)
                top, w_top = ranked[0]
                tcount = teachers[(wd, h, top)]
                t_top = max(tcount.values())
                ambiguous = any(_norm(t) in multi for t in tcount)
                out.update(
                    subject_id=top, subject=known[top],
                    teachers=[t for t, v in tcount.most_common() if v >= 0.25 * t_top and t],
                    status="ok" if (w_top / total >= 0.75 and n_real[cell] >= 2
                                    and not ambiguous) else "low",
                    candidates=[sid for sid, _ in ranked],
                    lab=lab_w[cell] / real_w[cell] >= 0.5,
                )
            elif n_subst[cell]:
                out["status"] = "substituted"   # occupato, ma mai da un docente di ruolo
            cells.append(out)

    return {"school_year": school_year(today), "days": days, "slots": n_slots,
            "lessons_used": sum(n_real.values()) + sum(n_subst.values()),
            "lab_subjects": sorted(lab_subjects),
            "cells": cells}


def _clean_name(name: str | None) -> str | None:
    """Nome materia scelto dall'utente: niente caratteri di controllo, spazi
    normalizzati, lunghezza limitata. Vuoto = usa il nome originale."""
    if not name:
        return None
    name = "".join(ch if ch.isprintable() else " " for ch in name)
    return " ".join(name.split())[:MAX_NAME] or None


def validate_setup(config_in: dict[int, dict], cells: list[dict],
                   subjects: list[dict]) -> tuple[dict, list[dict]]:
    """Controlla e normalizza la configurazione inviata dal client.

    Ritorna (config, cells):
    - config: {"<id materia>": {"name": str | None, "lab": bool, "color": str | None}},
      solo per le materie personalizzate;
    - cells: orario senza celle vuote, con il nome originale della materia
      (preso dal server, mai dal client).
    Solleva ValueError se qualcosa non va.
    """
    known = {s["id"]: s["description"] for s in subjects}

    config: dict[str, dict] = {}
    for sid, c in config_in.items():
        if sid not in known:
            raise ValueError("Materia non valida per questo studente.")
        name, lab = _clean_name(c.get("name")), bool(c.get("lab"))
        color = c.get("color")
        if color is not None and color not in SUBJECT_COLORS:
            raise ValueError("Colore materia non valido.")
        if name or lab or color:
            config[str(sid)] = {"name": name, "lab": lab, "color": color}

    seen: set[tuple[int, int]] = set()
    out = []
    for c in cells:
        key = (c["weekday"], c["hpos"])
        if key in seen:
            raise ValueError("Slot duplicato nell'orario.")
        seen.add(key)
        sid = c.get("subject_id")
        if sid is None:
            continue
        if sid not in known:
            raise ValueError("Materia non valida per questo studente.")
        lab = bool(c.get("lab"))
        if lab and not config.get(str(sid), {}).get("lab"):
            raise ValueError("Ora di laboratorio assegnata a una materia senza laboratorio.")
        out.append({"weekday": c["weekday"], "hpos": c["hpos"],
                    "subject_id": sid, "subject": known[sid], "lab": lab})
    out.sort(key=lambda c: (c["weekday"], c["hpos"]))
    return config, out
