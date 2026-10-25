"""BetterViva - backend minimo: login, sessione, logout.

Usa il wrapper ClasseViva (classeviva.py). Il server NON conserva la
password: la usa solo per il login e tiene in memoria l'istanza `Utente`
(con il token), legata a un cookie di sessione opaco.
Se il server si riavvia le sessioni si perdono: il frontend rifà il login
in silenzio con le credenziali cifrate custodite nel browser.
"""
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
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import db
import overrides
import timetable
from classeviva import Utente
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


class Credentials(BaseModel):
    username: str
    password: str


class SubjectIn(BaseModel):
    name: str | None = Field(default=None, max_length=timetable.MAX_NAME)  # None/"" = nome originale
    lab: bool = False                       # la materia ha laboratorio


class CellIn(BaseModel):
    weekday: int = Field(ge=0, le=6)        # 0 = lunedì
    hpos: int = Field(ge=1, le=12)          # ora di lezione, da 1
    subject_id: int | None = None           # None = nessuna lezione
    lab: bool = False                       # questa ora è di laboratorio


class SetupIn(BaseModel):
    subjects: dict[int, SubjectIn] = Field(default_factory=dict, max_length=60)  # id materia -> config
    cells: list[CellIn] = Field(max_length=84)


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
    except (requests.RequestException, KeyError, json.JSONDecodeError) as e:
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
    return {"name": s["name"], "first_name": s.get("first_name", ""), "school_year": year,
            "setup_needed": db.get_timetable(s["studentId"], year) is None}


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
    done = db.get_done_events(username)
    for event in data["events"]:
        event["done"] = event["id"] in done
    return data


@app.get("/api/events")
def events(request: Request, days: int = 14, start: date | None = None):
    """Restituisce gli eventi scolastici nell'intervallo richiesto.

    `start` indica il primo giorno incluso e, se omesso, corrisponde a oggi;
    `days` indica lo scarto in giorni fino all'ultimo giorno incluso ed è limitato
    all'intervallo 1-60. Riutilizza per dieci minuti la cache della sessione se
    data iniziale e scarto coincidono; altrimenti recupera i dati da ClasseViva,
    applica le correzioni manuali e aggiunge lo stato di completamento. Solleva
    HTTP 502 se il recupero fallisce.
    """
    s = current_session(request)
    days = max(1, min(days, 60))
    start = start or date.today()
    cached = s.get("events")
    if cached and cached["start"] == start.isoformat() and cached["days"] == days and time.time() - cached["at"] < 600:
        return with_done(cached["data"], s["studentId"])
    try:
        found = build_events(s["user"], days, load_subjects(s), subject_names(s), schedule_by_weekday(s),
                             since=start, until=start + timedelta(days=days))
        data = {"today": date.today().isoformat(),
                "events": overrides.apply(found, db.get_event_overrides(s["studentId"]))}
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("events: errore nel recupero dei dati")
        raise HTTPException(502, "ClasseViva non ha restituito i dati. Riprova più tardi.")
    s["events"] = {"at": time.time(), "start": start.isoformat(), "days": days, "data": data}
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
    s.pop("events", None)      # le cache contengono il vecchio `kind`
    s.pop("calendar", None)
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


@app.get("/api/calendar")
def calendar(request: Request):
    """Restituisce le prove del mese corrente in una griglia di settimane complete.

    L'intervallo parte dal lunedì della settimana che contiene il primo giorno
    del mese e termina la domenica della settimana che contiene l'ultimo giorno;
    include quindi anche i giorni passati del mese. La risposta è memorizzata per
    dieci minuti al giorno e contiene solo eventi classificati come prove.
    Solleva HTTP 502 se ClasseViva non fornisce i dati necessari.
    """
    s = current_session(request)
    today = date.today()
    cached = s.get("calendar")
    if cached and cached["day"] == today.isoformat() and time.time() - cached["at"] < 600:
        return cached["data"]
    first = today.replace(day=1)
    last = (first + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    start = first - timedelta(days=first.weekday())
    end = last + timedelta(days=6 - last.weekday())
    try:
        events = build_events(s["user"], 0, load_subjects(s), subject_names(s), schedule_by_weekday(s),
                              since=start, until=end)
        overrides.apply(events, db.get_event_overrides(s["studentId"]))
    except (requests.RequestException, KeyError, ValueError, TypeError):
        log.exception("calendar: errore nel recupero dei dati")
        raise HTTPException(502, "ClasseViva non ha restituito i dati. Riprova più tardi.")
    data = {"today": today.isoformat(), "start": start.isoformat(), "end": end.isoformat(),
            "events": [e for e in events if e["kind"]]}
    s["calendar"] = {"at": time.time(), "day": today.isoformat(), "data": data}
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
    db.save_setup(s["studentId"], year, {"version": 1, "cells": cells}, {"subject_config": config})
    s.pop("setup", None)
    s.pop("events", None)   # gli eventi dipendono dall'orario
    s.pop("calendar", None)
    return {"school_year": year, "cells": len(cells)}


@app.post("/api/logout")
async def logout(request: Request, response: Response):
    """Chiude la sessione corrente e rimuove il cookie dal browser.

    Se si tratta della sessione di prova, elimina anche i dati dell'utente di
    test dal database. Restituisce `{"ok": true}` al termine.
    """
    if current_session(request)["studentId"] == "testuser":
        db.delete_user("testuser")
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
