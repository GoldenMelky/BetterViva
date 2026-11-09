"""BetterViva - backend minimo: login, sessione, logout.

Usa il wrapper ClasseViva (classeviva.py). Il server NON conserva la
password: la usa solo per il login e tiene in memoria l'istanza `Utente`
(con il token), legata a un cookie di sessione opaco.
Se il server si riavvia le sessioni si perdono: il frontend rifà il login
in silenzio con le credenziali cifrate custodite nel browser.
"""
import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal
from dotenv import load_dotenv

import requests
from fastapi import Body, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import db
import grades
import overrides
import timetable
from classeviva import ProfileSelectionError, Utente
from events import build_events

log = logging.getLogger("betterviva")

load_dotenv()
COOKIE = "bv_session"
# Metti BV_SECURE_COOKIE=0 solo per provare in locale senza HTTPS
SECURE = os.getenv("BV_SECURE_COOKIE", "1") == "1"
STATIC = Path(__file__).parent / "static"

app = FastAPI(docs_url=None, redoc_url=None)
db.init_db()

sessions: dict[str, dict] = {}         # sid -> {user: Utente, name, expires}
attempts: dict[str, list[float]] = {}  # ip -> timestamp dei tentativi di login
feedback_attempts: dict[str, list[float]] = {}
feedback_attempts_lock = threading.Lock()
me_state_cache: dict[str, dict] = {}
me_state_lock = threading.RLock()


def load_me_state(student_id: str, year: str) -> dict:
    """Carica dal database solo i dati di profilo non già presenti in RAM."""
    with me_state_lock:
        state = me_state_cache.get(student_id)
        if state is None:
            state = {"options": db.get_options(student_id), "timetables": {}}
            me_state_cache[student_id] = state
        if year not in state["timetables"]:
            state["timetables"][year] = db.get_timetable(student_id, year) is not None
        return state


def update_me_state(student_id: str, *, options: dict | None = None) -> None:
    """Aggiorna i dati già caricati in RAM dopo una scrittura riuscita."""
    with me_state_lock:
        state = me_state_cache.get(student_id)
        if state is None:
            return
        if options is not None:
            state["options"] = options


class Credentials(BaseModel):
    username: str
    password: str


class SubjectIn(BaseModel):
    name: str | None = Field(default=None, max_length=timetable.MAX_NAME)  # None/"" = nome originale
    lab: bool = False                       # la materia ha laboratorio
    color: str | None = None


class CellIn(BaseModel):
    weekday: int = Field(ge=0, le=6)        # 0 = lunedì
    hpos: int = Field(ge=1, le=12)          # ora di lezione, da 1
    subject_id: int | None = None           # None = nessuna lezione
    lab: bool = False                       # questa ora è di laboratorio


class SetupIn(BaseModel):
    subjects: dict[int, SubjectIn] = Field(default_factory=dict, max_length=60)  # id materia -> config
    cells: list[CellIn] = Field(max_length=84)


class SubjectsIn(BaseModel):
    subjects: dict[int, SubjectIn] = Field(default_factory=dict, max_length=60)


class GradeAverageModeIn(BaseModel):
    mode: Literal["all_grades", "average_of_averages"] = grades.DEFAULT_AVERAGE_MODE


class FeedbackIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class OtherInfoIn(BaseModel):
    id: int = Field(ge=0)


class JustificationIn(BaseModel):
    evtType: Literal[0, 1, 2]
    causalCode: str = Field(min_length=1, max_length=64)
    dateStart: date
    dateEnd: date
    time: str | None = Field(default=None, pattern=r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")
    reason: str = Field(min_length=1, max_length=1000)
    pickup: str | None = Field(default=None, max_length=300)
    hPos: int | None = Field(default=None, ge=1)
    otherInfo: list[OtherInfoIn] = Field(default_factory=list, max_length=50)


def norm_username(username: str) -> str:
    """Normalizza un nome utente rimuovendo gli spazi esterni e ignorando le maiuscole."""
    return username.strip().lower()


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Aggiunge le intestazioni di sicurezza alla risposta HTTP.

    Le risposte API non vengono memorizzate nella cache; per tutte le risposte
    imposta inoltre la Content Security Policy e le intestazioni anti-sniffing
    e di referer.
    """
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; style-src 'self'; script-src 'self'; "
        "img-src 'self' data:; frame-ancestors 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def client_ip(request: Request) -> str:
    """Restituisce l'indirizzo del client, preferendo quello inoltrato da Cloudflare."""
    return request.headers.get("cf-connecting-ip") or request.client.host


def check_rate(ip: str, limit: int = 10, window: int = 600) -> None:
    """Registra un tentativo e limita le richieste recenti provenienti dallo stesso IP.

    I tentativi più vecchi di `window` secondi vengono esclusi dal conteggio.
    Solleva HTTP 429 se sono già stati raggiunti `limit` tentativi nella finestra.
    """
    now = time.time()
    recent = [t for t in attempts.get(ip, []) if now - t < window]
    if len(recent) >= limit:
        raise HTTPException(429, "Troppi tentativi. Riprova tra qualche minuto.")
    recent.append(now)
    attempts[ip] = recent


def check_feedback_rate(ip: str, limit: int = 3, window: int = 600) -> None:
    """Limita a tre invii di feedback ogni dieci minuti per indirizzo IP."""
    now = time.time()
    with feedback_attempts_lock:
        recent = [t for t in feedback_attempts.get(ip, []) if now - t < window]
        if len(recent) >= limit:
            raise HTTPException(429, "Hai inviato troppi feedback. Riprova tra qualche minuto.")
        recent.append(now)
        feedback_attempts[ip] = recent


def parse_expiry(value: str | None) -> float:
    """Converte la scadenza ISO 8601 in timestamp Unix.

    Se il valore manca o non è valido, usa una scadenza prudenziale di un'ora
    a partire dall'ora corrente.
    """
    try:
        return datetime.fromisoformat(value).timestamp()
    except (TypeError, ValueError):
        return time.time() + 3600  # ipotesi prudente: 1 ora


def current_session(request: Request) -> dict:
    """Recupera la sessione associata al cookie della richiesta.

    Restituisce il record in memoria, che contiene fra l'altro l'istanza
    `Utente`. Se la sessione non esiste o è scaduta, rimuove l'eventuale record
    residuo e solleva HTTP 401.
    """
    sid = request.cookies.get(COOKIE)
    s = sessions.get(sid) if sid else None
    if not s or s["expires"] <= time.time():
        sessions.pop(sid, None)
        raise HTTPException(401, "Sessione scaduta")
    return s


# `def` (non `async def`): Utente usa `requests`, che è bloccante, quindi
# FastAPI esegue l'endpoint in un thread senza fermare gli altri.
@app.post("/api/login")
def login(creds: Credentials, request: Request, response: Response):
    """Autentica l'utente e crea una sessione identificata da un cookie opaco.

    Applica il limite di tentativi per IP, crea il client ClasseViva e salva
    in memoria i dati necessari agli endpoint. Elimina sessioni scadute e la
    sessione precedente del browser, quindi imposta un cookie HTTP-only con
    scadenza corrispondente a quella del token.

    Il nome `testuser` abilita l'utente di prova configurato nell'ambiente.
    Solleva HTTP 401 per credenziali errate e HTTP 502 se ClasseViva non è
    raggiungibile o restituisce dati inattesi.
    """
    check_rate(client_ip(request))
    testuser = False
    if creds.username.strip() == "testuser":
        testuser = True
        # Simula un utente valido per test
        creds.username = os.getenv("BV_TESTUSER")
        creds.password = os.getenv("BV_TESTPASS")
    try:
        user = Utente(creds.username.strip(), creds.password)
    except (requests.RequestException, KeyError, json.JSONDecodeError, ProfileSelectionError) as e:
        # JSONDecodeError è un ValueError: va gestito prima del ramo sotto
        print(e)
        raise HTTPException(502, "ClasseViva non è raggiungibile o ha risposto in modo inatteso. Riprova più tardi.")
    except ValueError:
        raise HTTPException(401, "Username o password non corretti.")

    # Ripulisce le sessioni scadute e quella precedente di questo browser
    now = time.time()
    for sid in [k for k, v in sessions.items() if v["expires"] <= now]:
        del sessions[sid]
    sessions.pop(request.cookies.get(COOKIE), None)

    sid = secrets.token_urlsafe(32)
    sessions[sid] = {
        "user": user,
        "username": norm_username(creds.username),
        "name": f'{user.login.get("firstName", "")} {user.login.get("lastName", "")}'.strip(),
        "first_name": (user.login.get("firstName") or "").strip().title(),
        "class_name": (
            user.whoami_data.get("classe_desc")
            or user.whoami_data.get("classDesc")
            or user.whoami_data.get("class_desc")
            or ""
        ),
        "expires": parse_expiry(user.login.get("expire")),
        "studentId": "testuser" if testuser else user.login.get("studentId")
    }
    response.set_cookie(
        COOKIE, sid, httponly=True, secure=SECURE, samesite="lax",
        max_age=max(int(sessions[sid]["expires"] - now), 1),
    )
    return {"name": sessions[sid]["name"]}


@app.get("/api/me")
def me(request: Request):
    """Restituisce il profilo minimo della sessione e lo stato della configurazione.

    Include nome, nome proprio, anno scolastico corrente e indica se l'utente
    deve ancora configurare l'orario.
    """
    s = current_session(request)
    year = timetable.school_year(date.today())
    student_id = s["studentId"]
    with me_state_lock:
        state = load_me_state(student_id, year)
        options = state["options"]
        subject_config = options.get("subject_config", {})
        has_subject_colors = any(
            isinstance(subject, dict) and subject.get("color") in timetable.SUBJECT_COLORS
            for subject in subject_config.values()
        )
        return {
            "name": s["name"], "first_name": s.get("first_name", ""),
            "class_name": s.get("class_name", ""), "school_year": year,
            "cache_scope": hashlib.sha256(student_id.encode()).hexdigest(),
            "grade_average_mode": (
                options.get("grade_average_mode")
                if options.get("grade_average_mode") in grades.AVERAGE_MODES
                else grades.DEFAULT_AVERAGE_MODE
            ),
            "setup_needed": not state["timetables"][year],
            "color_setup_pending": not has_subject_colors
            and not options.get("color_settings_configured")
            and not options.get("color_setup_dismissed"),
        }


def subject_names(s: dict) -> dict[int, str]:
    """Costruisce la mappa ID materia -> nome da mostrare.

    Preferisce il nome personalizzato salvato dall'utente; in sua assenza usa
    il nome predefinito derivato dalla descrizione ClasseViva.
    """
    config = db.get_options(s["studentId"]).get("subject_config", {})
    short = timetable.short_names()
    return {x["id"]: (config.get(str(x["id"])) or {}).get("name") or timetable.default_name(x["description"], short)
            for x in load_subjects(s)}


def schedule_by_weekday(s: dict) -> dict[int, list[int]]:
    """Restituisce le materie dell'orario raggruppate per giorno della settimana.

    Le chiavi sono i giorni numerati da 0 (lunedì) a 6 (domenica); gli ID delle
    materie mantengono l'ordine delle ore. Il risultato è vuoto se l'orario
    dell'anno scolastico corrente non è stato configurato.
    """
    saved = db.get_timetable(s["studentId"], timetable.school_year(date.today()))
    out: dict[int, list[int]] = {}
    for c in (saved or {}).get("cells", []):
        out.setdefault(c["weekday"], []).append(c["subject_id"])   # le celle sono già ordinate per ora
    return out


def with_done(data: dict, username: str) -> dict:
    """Aggiunge a ogni evento il flag `done` letto dal database.

    Aggiorna il dizionario ricevuto sul posto e lo restituisce; mantenere questo
    stato separato dalla cache degli eventi evita di invalidarla quando un
    compito viene segnato come svolto.
    """
    data["today"] = date.today().isoformat()
    done = db.get_done_events(username)
    for event in data["events"]:
        event["done"] = event["id"] in done
    return data


@app.get("/api/noticeboard")
def get_noticeboard(request: Request):
    """Restituisce gli avvisi della bacheca ClasseViva."""
    s = current_session(request)
    try:
        board = s["user"].bacheca()
        items = board["items"]
        if not isinstance(items, list):
            raise TypeError("La lista degli avvisi non è valida.")
        return {"items": items}
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("noticeboard: errore nel recupero degli avvisi")
        raise HTTPException(502, "ClasseViva non ha restituito dati validi per la bacheca.")


@app.post("/api/noticeboard/{evt_code}/{pub_id}/read")
def read_notice(
    evt_code: str,
    pub_id: str,
    request: Request,
    reply: dict | None = Body(default=None),
):
    """Segna come letto l'avviso aperto e restituisce il contenuto."""
    s = current_session(request)
    if (not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", evt_code)
            or not re.fullmatch(r"[0-9]{1,30}", pub_id)):
        raise HTTPException(422, "Identificativo dell'avviso non valido.")
    try:
        if reply is not None:
            allowed = {"replJoin", "replText", "replFile", "replSign"}
            if not all(key in allowed for key in reply):
                raise HTTPException(422, "Contenuto della risposta non valido.")
            if "replJoin" in reply and not isinstance(reply["replJoin"], bool):
                raise HTTPException(422, "La conferma deve essere booleana.")
            if "replSign" in reply and not isinstance(reply["replSign"], bool):
                raise HTTPException(422, "La firma deve essere booleana.")
            if "replText" in reply and (
                not isinstance(reply["replText"], str) or len(reply["replText"]) > 4000
            ):
                raise HTTPException(422, "La risposta testuale non è valida.")
            if "replFile" in reply and (
                not isinstance(reply["replFile"], str)
                or len(reply["replFile"]) > 15 * 1024 * 1024
                or not re.fullmatch(
                    r"data:[^;,\s]+;base64,[A-Za-z0-9+/]*={0,2}", reply["replFile"]
                )
            ):
                raise HTTPException(422, "Il file allegato non è valido o supera il limite.")
        return s["user"].leggiAvviso(evt_code, int(pub_id), reply)
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("noticeboard: errore nella lettura di un avviso")
        raise HTTPException(502, "Impossibile aprire l'avviso. Riprova più tardi.")


@app.get("/api/noticeboard/attachment/{evt_code}/{pub_id}/{attach_num}")
def download_notice_attachment(evt_code: str, pub_id: str, attach_num: str, request: Request):
    """Scarica un allegato della bacheca."""
    s = current_session(request)
    if (not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", evt_code)
            or not re.fullmatch(r"[0-9]{1,30}", pub_id)
            or not re.fullmatch(r"[0-9]{1,30}", attach_num)):
        raise HTTPException(422, "Identificativo dell'allegato non valido.")
    try:
        content = s["user"].downloadAttachment(int(pub_id), int(attach_num), evt_code)
        return Response(content=content, media_type="application/octet-stream")
    except (requests.RequestException, ValueError, TypeError):
        log.exception("noticeboard: errore nel download di un allegato")
        raise HTTPException(502, "Impossibile scaricare l'allegato. Riprova più tardi.")


@app.get("/api/absences")
def get_absences(
    request: Request,
    date_from: date | None = Query(default=None, alias="dateFrom"),
    date_to: date | None = Query(default=None, alias="dateTo"),
):
    """Restituisce gli eventi di assenza, ritardo e uscita."""
    s = current_session(request)
    if (date_from is None) != (date_to is None):
        raise HTTPException(422, "Indica entrambe le date dell'intervallo.")
    if date_from and date_to and date_from > date_to:
        raise HTTPException(422, "La data finale precede quella iniziale.")
    try:
        begin = date_from.strftime("%Y%m%d") if date_from else None
        end = date_to.strftime("%Y%m%d") if date_to else None
        data = s["user"].assenze(begin, end)
        if not isinstance(data, dict):
            raise TypeError("La risposta delle assenze non è valida.")
        return data
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("absences: errore nel recupero degli eventi")
        raise HTTPException(502, "ClasseViva non ha restituito dati validi per le assenze.")


@app.get("/api/absences/justifications/config")
def get_justification_config(request: Request):
    """Restituisce abilitazioni e causali per la giustificazione online."""
    s = current_session(request)
    try:
        data = s["user"].libretto_web_conf()
        if not isinstance(data, dict):
            raise TypeError("La configurazione delle giustificazioni non è valida.")
        return data
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("absences: errore nel recupero della configurazione")
        raise HTTPException(502, "ClasseViva non ha restituito una configurazione valida.")


@app.get("/api/absences/justifications")
def get_justifications(request: Request):
    """Restituisce le giustificazioni registrate nel libretto web."""
    s = current_session(request)
    try:
        data = s["user"].libretto_web()
        if not isinstance(data, dict):
            raise TypeError("La risposta del libretto web non è valida.")
        return data
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("absences: errore nel recupero delle giustificazioni")
        raise HTTPException(502, "ClasseViva non ha restituito dati validi per le giustificazioni.")


def validated_justification_body(body: JustificationIn) -> dict:
    if not body.causalCode.strip() or not body.reason.strip():
        raise HTTPException(422, "Causale e motivazione sono obbligatorie.")
    if body.dateEnd < body.dateStart:
        raise HTTPException(422, "La data finale precede quella iniziale.")
    if body.evtType != 0 and body.dateStart != body.dateEnd:
        raise HTTPException(422, "Ritardi e uscite devono riferirsi a un solo giorno.")
    if body.evtType != 0 and body.time is None:
        raise HTTPException(422, "L'orario è obbligatorio per ritardi e uscite.")
    payload = body.model_dump(mode="json", exclude_none=True)
    if body.evtType == 0:
        payload.pop("time", None)
        payload.pop("pickup", None)
    elif body.evtType == 1:
        payload.pop("pickup", None)
    else:
        payload["pickup"] = body.pickup
    return payload


@app.post("/api/absences/justifications")
def create_justification(body: JustificationIn, request: Request):
    """Crea una giustificazione per un'assenza, un ritardo o un'uscita."""
    s = current_session(request)
    payload = validated_justification_body(body)
    try:
        result = s["user"].crea_giustifica(payload)
        return result if result is not None else {"ok": True}
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("absences: errore nella creazione della giustificazione")
        raise HTTPException(502, "Impossibile creare la giustificazione. Riprova più tardi.")


@app.put("/api/absences/justifications/{evt_id}")
def update_justification(evt_id: str, body: JustificationIn, request: Request):
    """Modifica una giustificazione esistente."""
    s = current_session(request)
    if not re.fullmatch(r"[1-9][0-9]{0,29}", evt_id):
        raise HTTPException(422, "Id evento non valido.")
    payload = validated_justification_body(body)
    try:
        result = s["user"].modifica_giustifica(int(evt_id), payload)
        return result if result is not None else {"ok": True}
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("absences: errore nella modifica della giustificazione")
        raise HTTPException(502, "Impossibile modificare la giustificazione. Riprova più tardi.")


@app.delete("/api/absences/justifications/{evt_id}")
def delete_justification(evt_id: str, request: Request):
    """Elimina una giustificazione esistente."""
    s = current_session(request)
    if not re.fullmatch(r"[1-9][0-9]{0,29}", evt_id):
        raise HTTPException(422, "Id evento non valido.")
    try:
        result = s["user"].elimina_giustifica(int(evt_id))
        return result if result is not None else {"ok": True}
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("absences: errore nell'eliminazione della giustificazione")
        raise HTTPException(502, "Impossibile eliminare la giustificazione. Riprova più tardi.")


@app.get("/api/events")
def events(request: Request):
    """Restituisce tutti gli eventi dell'anno scolastico corrente.

    Agenda e compiti vengono unificati in un unico elenco e riutilizzati dalla
    home e dal calendario. La risposta viene memorizzata per dieci minuti;
    solleva HTTP 502 se il recupero da ClasseViva fallisce.
    """
    s = current_session(request)
    today = date.today()
    start, end = timetable.school_year_bounds(today)
    year = timetable.school_year(today)
    cached = s.get("events")
    if cached and cached["year"] == year and time.time() - cached["at"] < 600:
        return with_done(cached["data"], s["studentId"])
    try:
        found = build_events(s["user"], load_subjects(s), subject_names(s), schedule_by_weekday(s),
                             since=start, until=end)
        data = {"today": today.isoformat(), "start": start.isoformat(), "end": end.isoformat(),
                "events": overrides.apply(found, db.get_event_overrides(s["studentId"]))}
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("events: errore nel recupero dei dati")
        raise HTTPException(502, "ClasseViva non ha restituito i dati. Riprova più tardi.")
    s["events"] = {"at": time.time(), "year": year, "data": data}
    return with_done(data, s["studentId"])


class KindIn(BaseModel):
    kind: Literal["verifica", "interrogazione"] | None   # None = "non è una prova"


@app.put("/api/events/{event_id}/kind")
def set_event_kind(event_id: str, body: KindIn, request: Request):
    """Salva la classificazione manuale di un evento e invalida le cache dipendenti.

    `body.kind` può indicare una verifica, un'interrogazione o `None` per
    escludere l'evento dalle prove. L'ID deve essere composto da 12 cifre
    esadecimali; in caso contrario viene restituito HTTP 422.
    """
    s = current_session(request)
    if not re.fullmatch(r"[0-9a-f]{12}", event_id):
        raise HTTPException(422, "Id evento non valido")
    db.set_event_override(s["studentId"], event_id, body.kind or "none")
    s.pop("events", None)      # la cache contiene il vecchio `kind`
    return {"ok": True}


class DoneIn(BaseModel):
    done: bool


@app.put("/api/events/{event_id}/done")
def set_event_done(event_id: str, body: DoneIn, request: Request):
    """Salva se un evento è stato completato, senza ricostruire la cache eventi.

    L'ID deve essere composto da 12 cifre esadecimali; un formato non valido
    produce HTTP 422. Lo stato viene associato all'utente autenticato.
    """
    s = current_session(request)
    if not re.fullmatch(r"[0-9a-f]{12}", event_id):
        raise HTTPException(422, "Id evento non valido")
    db.set_event_done(s["studentId"], event_id, body.done)
    return {"ok": True}


@app.get("/api/grades")
def get_grades(request: Request):
    """Restituisce voti grezzi e medie annuali/per periodo."""
    s = current_session(request)
    cached = s.get("grades")
    if not cached or time.time() - cached["at"] >= 600:
        try:
            response = s["user"].voti()
            raw_grades = response["grades"]
            if not isinstance(raw_grades, list):
                raise TypeError("La lista dei voti non è valida.")
        except (requests.RequestException, KeyError, ValueError, TypeError):
            log.exception("grades: errore nel recupero dei voti")
            raise HTTPException(502, "ClasseViva non ha restituito i dati dei voti. Riprova più tardi.")
        s["grades"] = {"at": time.time(), "data": raw_grades}
        cached = s["grades"]

    options = db.get_options(s["studentId"])
    average_mode = options.get("grade_average_mode", grades.DEFAULT_AVERAGE_MODE)
    if average_mode not in grades.AVERAGE_MODES:
        average_mode = grades.DEFAULT_AVERAGE_MODE
    try:
        return grades.build_grade_data(
            cached["data"], average_mode,
            options.get("subject_config", {}), timetable.short_names(),
        )
    except (KeyError, TypeError, ValueError):
        log.exception("grades: errore nella normalizzazione dei voti")
        raise HTTPException(502, "ClasseViva non ha restituito dati dei voti validi.")


@app.get("/api/lessons")
def get_lessons(request: Request):
    """Restituisce le lezioni registrate nell'anno scolastico corrente."""
    s = current_session(request)
    today = date.today()
    start, end = timetable.school_year_bounds(today)
    year = timetable.school_year(today)
    cached = s.get("lessons")
    if cached and cached["year"] == year and time.time() - cached["at"] < 600:
        return cached["data"]
    try:
        response = s["user"].lezioni(start.strftime("%Y%m%d"), end.strftime("%Y%m%d"))
        lessons = response["lessons"]
        if not isinstance(lessons, list) or not all(isinstance(item, dict) for item in lessons):
            raise TypeError("La lista delle lezioni non è valida.")
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("lessons: errore nel recupero delle lezioni")
        raise HTTPException(502, "ClasseViva non ha restituito i dati delle lezioni. Riprova più tardi.")
    data = {"start": start.isoformat(), "end": end.isoformat(), "lessons": lessons}
    s["lessons"] = {"at": time.time(), "year": year, "data": data}
    return data


_subjects_lock = threading.Lock()


def load_subjects(s: dict) -> list[dict]:
    """Carica le materie di ClasseViva una sola volta per sessione.

    Il lock coordina le richieste concorrenti, ad esempio quelle simultanee di
    `/api/events` e `/api/timetable`, così non partono più caricamenti remoti.
    Il risultato viene conservato nel record della sessione.
    """
    with _subjects_lock:
        if "subjects" not in s:
            s["subjects"] = s["user"].subjects()["subjects"]
    return s["subjects"]


@app.get("/api/subjects")
def get_subjects(request: Request):
    """Restituisce le materie con nomi, docenti e colori configurati."""
    s = current_session(request)
    try:
        subjects = load_subjects(s)
        config = db.get_options(s["studentId"]).get("subject_config", {})
        names = subject_names(s)
        return {
            "subjects": [
                {
                    "id": subject["id"],
                    "name": names[subject["id"]],
                    "original_name": subject["description"],
                    "teachers": [
                        teacher["teacherName"] for teacher in subject.get("teachers", [])
                        if teacher.get("teacherName")
                    ],
                    "color": (config.get(str(subject["id"])) or {}).get("color"),
                }
                for subject in subjects
            ]
        }
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("subjects: errore nel recupero delle materie")
        raise HTTPException(502, "ClasseViva non ha restituito le materie. Riprova più tardi.")


def load_lessons(user, today: date) -> list[dict]:
    """Recupera le lezioni dall'inizio del periodo utile fino a `today`.

    Divide l'intervallo in richieste di circa un mese, usa il formato data
    richiesto dal wrapper ClasseViva e rimuove eventuali duplicati tramite
    l'identificativo dell'evento.
    """
    start, lessons, seen = timetable.lookback_start(today), [], set()
    while start <= today:
        end = min(start + timedelta(days=30), today)
        # il wrapper vuole le date come stringhe YYYYMMDD
        for l in user.lezioni(start.strftime("%Y%m%d"), end.strftime("%Y%m%d"))["lessons"]:
            if l.get("evtId") not in seen:
                seen.add(l.get("evtId"))
                lessons.append(l)
        start = end + timedelta(days=1)
    return lessons


@app.get("/api/setup/timetable")
def setup_timetable(request: Request):
    """Genera una proposta di orario da sottoporre alla verifica dell'utente.

    Riutilizza per dieci minuti il risultato già calcolato nella sessione;
    altrimenti carica materie e lezioni, rileva l'orario e arricchisce le materie
    con nomi suggeriti, indicazioni di laboratorio e docenti. Solleva HTTP 502
    se il recupero dei dati da ClasseViva fallisce.
    """
    s = current_session(request)
    cached = s.get("setup")
    if cached and time.time() - cached["at"] < 600:
        return cached["data"]
    today = date.today()
    try:
        subjects = load_subjects(s)
        lessons = load_lessons(s["user"], today)
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("setup: errore nel recupero di materie/lezioni")
        raise HTTPException(502, "ClasseViva non ha restituito i dati. Riprova più tardi.")
    data = timetable.detect(lessons, subjects, today)
    # materie per il menu a tendina, con i docenti per ordinarle in modo utile
    names = timetable.short_names()
    data["subjects"] = [
        {"id": x["id"], "name": x["description"],
         "short": timetable.default_name(x["description"], names),   # nome proposto
         "lab": x["id"] in data["lab_subjects"],                      # laboratorio suggerito
         "teachers": [t["teacherName"] for t in x.get("teachers", [])]}
        for x in subjects
    ]
    s["setup"] = {"at": time.time(), "data": data}
    return data


@app.get("/api/timetable")
def get_timetable(request: Request):
    """Restituisce l'orario dell'anno corrente arricchito con le preferenze utente.

    Include configurazione delle materie, nomi da mostrare e un'etichetta pronta
    per ogni ora, con il prefisso del laboratorio quando necessario. Se l'orario
    non è ancora configurato solleva HTTP 404; se ClasseViva non è disponibile,
    ricava i nomi dai dati già salvati.
    """
    s = current_session(request)
    saved = db.get_timetable(s["studentId"], timetable.school_year(date.today()))
    if saved is None:
        raise HTTPException(404, "Orario non ancora configurato.")
    saved["subjects"] = db.get_options(s["studentId"]).get("subject_config", {})
    # nome da mostrare per ogni materia (id -> nome)
    try:
        saved["names"] = {str(k): v for k, v in subject_names(s).items()}
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("timetable: errore nel recupero delle materie, uso i nomi salvati nell'orario")
        short = timetable.short_names()
        custom = saved["subjects"]
        saved["names"] = {
            str(c["subject_id"]): (custom.get(str(c["subject_id"])) or {}).get("name")
            or timetable.default_name(c["subject"], short)
            for c in saved.get("cells", []) if c.get("subject_id") is not None
        }
    # etichetta già pronta per ogni ora ("Matematica", "Lab TPSIT"): il frontend non ricostruisce nulla
    for c in saved.get("cells", []):
        name = saved["names"].get(str(c.get("subject_id"))) or c.get("subject") or "Lezione"
        c["label"] = f"Lab {name}" if c.get("lab") else name
    return saved


@app.post("/api/setup")
def save_setup(body: SetupIn, request: Request):
    """Convalida e salva insieme le preferenze delle materie e l'orario.

    Verifica i dati rispetto alle materie ClasseViva, poi li scrive in una
    transazione per l'anno scolastico corrente. In caso di dati non validi
    restituisce HTTP 422; dopo il salvataggio invalida le cache di setup, eventi
    e calendario che dipendono dalla configurazione.
    """
    s = current_session(request)
    try:
        subjects = load_subjects(s)
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("setup: errore nel recupero delle materie")
        raise HTTPException(502, "ClasseViva non ha restituito i dati. Riprova più tardi.")
    try:
        config, cells = timetable.validate_setup(
            {sid: c.model_dump() for sid, c in body.subjects.items()},
            [c.model_dump() for c in body.cells], subjects)
    except ValueError as e:
        raise HTTPException(422, str(e))
    year = timetable.school_year(date.today())
    with me_state_lock:
        db.save_setup(s["studentId"], year, {"version": 1, "cells": cells},
                      {"subject_config": config, "color_settings_configured": True})
        state = me_state_cache.get(s["studentId"])
        if state is not None:
            state["options"] = {
                **state["options"], "subject_config": config, "color_settings_configured": True,
            }
            state["timetables"][year] = True
    s.pop("setup", None)
    s.pop("events", None)   # gli eventi dipendono dall'orario
    s.pop("calendars", None)
    return {"school_year": year, "cells": len(cells)}


@app.put("/api/subjects")
def save_subjects(body: SubjectsIn, request: Request):
    """Convalida e salva le preferenze delle materie senza modificare l'orario."""
    s = current_session(request)
    try:
        subjects = load_subjects(s)
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("subjects: errore nel recupero delle materie")
        raise HTTPException(502, "ClasseViva non ha restituito i dati. Riprova più tardi.")
    try:
        config, _ = timetable.validate_setup(
            {sid: subject.model_dump() for sid, subject in body.subjects.items()}, [], subjects)
    except ValueError as e:
        raise HTTPException(422, str(e))
    with me_state_lock:
        options = db.update_options(s["studentId"], {"subject_config": config, "color_settings_configured": True})
        update_me_state(s["studentId"], options=options)
    s.pop("events", None)
    s.pop("calendars", None)
    return {"subjects": len(config)}


@app.put("/api/settings/color-prompt-dismissed")
def dismiss_color_prompt(request: Request):
    """Memorizza che l'utente preferisce configurare i colori più tardi."""
    s = current_session(request)
    with me_state_lock:
        options = db.update_options(s["studentId"], {"color_setup_dismissed": True})
        update_me_state(s["studentId"], options=options)
    return {"ok": True}


@app.put("/api/settings/grade-average-mode")
def set_grade_average_mode(body: GradeAverageModeIn, request: Request):
    """Memorizza la modalità di calcolo della media mostrata."""
    s = current_session(request)
    with me_state_lock:
        options = db.update_options(s["studentId"], {"grade_average_mode": body.mode})
        update_me_state(s["studentId"], options=options)
    return {"grade_average_mode": body.mode}


@app.post("/api/feedback")
def send_feedback(body: FeedbackIn, request: Request):
    """Inoltra il feedback a Telegram senza includere dati dell'account."""
    token = os.getenv("BV_TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("BV_TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        raise HTTPException(503, "Invio feedback non disponibile.")

    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Il feedback non può essere vuoto.")

    current_session(request)
    check_feedback_rate(client_ip(request))

    try:
        telegram_response = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": f"Nuovo feedback BetterViva:\n\n{message}"},
            timeout=10,
        )
        telegram_response.raise_for_status()
        telegram_data = telegram_response.json()
        if not isinstance(telegram_data, dict) or telegram_data.get("ok") is not True:
            raise ValueError("Telegram ha rifiutato il messaggio.")
    except (requests.RequestException, ValueError) as error:
        log.warning("Telegram feedback delivery failed (%s).", type(error).__name__)
        raise HTTPException(502, "Impossibile inviare il feedback. Riprova più tardi.")

    return {"ok": True}


@app.post("/api/logout")
async def logout(request: Request, response: Response):
    """Chiude la sessione corrente e rimuove il cookie dal browser.

    Se si tratta della sessione di prova, elimina anche i dati dell'utente di
    test dal database. Restituisce `{"ok": true}` al termine.
    """
    if current_session(request)["studentId"] == "testuser":
        with me_state_lock:
            db.delete_user("testuser")
            me_state_cache.pop("testuser", None)
    sessions.pop(request.cookies.get(COOKIE), None)
    response.delete_cookie(COOKIE)
    
    return {"ok": True}


@app.get("/")
async def index():
    """Serve il documento HTML principale dell'applicazione web."""
    return FileResponse(STATIC / "index.html")


@app.get("/sw.js", include_in_schema=False)
async def service_worker():
    """Serve il service worker dalla radice per abilitarne il controllo sul sito.

    Disabilita la cache HTTP del file così il browser può ricevere rapidamente
    gli aggiornamenti del service worker.
    """
    # dalla radice, così controlla tutto il sito; senza cache, così gli aggiornamenti arrivano subito
    return FileResponse(STATIC / "sw.js", media_type="application/javascript",
                        headers={"Cache-Control": "no-cache"})


app.mount("/static", StaticFiles(directory=STATIC), name="static")
