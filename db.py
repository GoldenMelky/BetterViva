"""Database di BetterViva (SQLite): un record per utente, più l'orario per anno scolastico
e le correzioni manuali al riconoscimento di verifiche e interrogazioni.

Non contiene password né token: la chiave è il nome utente ClasseViva,
che arriva SEMPRE dalla sessione del server, mai dal client.
"""
from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(os.getenv("BV_DB", Path(__file__).parent / "data" / "betterviva.db"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    username   TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    options    TEXT NOT NULL DEFAULT '{}'      -- JSON: opzioni future, senza migrazioni
);
-- L'orario sta a parte perché si rifà ogni anno scolastico, mentre le
-- altre opzioni dell'utente restano.
CREATE TABLE IF NOT EXISTS timetables (
    username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    school_year TEXT NOT NULL,                 -- es. '2026-27'
    data        TEXT NOT NULL,                 -- JSON: {"version": 1, "cells": [...]}
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (username, school_year)
);
-- Correzioni manuali: l'id evento è quello calcolato da events.py.
-- 'none' = blacklist ("non è una prova"); gli altri segnano come prova un evento non riconosciuto.
CREATE TABLE IF NOT EXISTS event_overrides (
    username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    event_id   TEXT NOT NULL,
    kind       TEXT NOT NULL CHECK (kind IN ('verifica', 'interrogazione', 'none')),
    updated_at TEXT NOT NULL,
    PRIMARY KEY (username, event_id)
);
-- Compiti segnati come svolti: l'id evento è quello calcolato da events.py.
CREATE TABLE IF NOT EXISTS event_done (
    username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
    event_id   TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (username, event_id)
);
"""

MAX_OVERRIDES_PER_USER = 2000      # oltre, si scartano le correzioni più vecchie
MAX_DONE_PER_USER = 2000           # oltre, si scartano le segnature più vecchie


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db() -> None:
    with connect() as con:
        con.execute("PRAGMA journal_mode = WAL")   # letture e scritture non si bloccano
        con.executescript(SCHEMA)


def _ensure_user(con: sqlite3.Connection, username: str) -> None:
    con.execute("INSERT OR IGNORE INTO users (username, created_at) VALUES (?, ?)",
                (username, now()))


def get_options(username: str) -> dict:
    with connect() as con:
        row = con.execute("SELECT options FROM users WHERE username = ?", (username,)).fetchone()
    return json.loads(row["options"]) if row else {}


def update_options(username: str, patch: dict) -> dict:
    """Unisce `patch` alle opzioni esistenti (crea l'utente se non c'è)."""
    with connect() as con:
        _ensure_user(con, username)
        row = con.execute("SELECT options FROM users WHERE username = ?", (username,)).fetchone()
        merged = {**json.loads(row["options"]), **patch}
        con.execute("UPDATE users SET options = ? WHERE username = ?",
                    (json.dumps(merged, ensure_ascii=False), username))
    return merged


def get_timetable(username: str, school_year: str) -> dict | None:
    with connect() as con:
        row = con.execute("SELECT data, updated_at FROM timetables WHERE username = ? AND school_year = ?",
                          (username, school_year)).fetchone()
    if not row:
        return None
    return {**json.loads(row["data"]), "school_year": school_year, "updated_at": row["updated_at"]}


def save_timetable(username: str, school_year: str, data: dict) -> None:
    with connect() as con:
        _ensure_user(con, username)
        con.execute(
            "INSERT INTO timetables (username, school_year, data, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(username, school_year) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (username, school_year, json.dumps(data, ensure_ascii=False), now()))


def save_setup(username: str, school_year: str, timetable_data: dict, options_patch: dict) -> None:
    """Salva orario e opzioni nella stessa transazione: o tutto o niente."""
    with connect() as con:
        _ensure_user(con, username)
        row = con.execute("SELECT options FROM users WHERE username = ?", (username,)).fetchone()
        merged = {**json.loads(row["options"]), **options_patch}
        con.execute("UPDATE users SET options = ? WHERE username = ?",
                    (json.dumps(merged, ensure_ascii=False), username))
        con.execute(
            "INSERT INTO timetables (username, school_year, data, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(username, school_year) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (username, school_year, json.dumps(timetable_data, ensure_ascii=False), now()))


def get_event_overrides(username: str) -> dict[str, str]:
    """id evento -> 'verifica' | 'interrogazione' | 'none'."""
    with connect() as con:
        rows = con.execute("SELECT event_id, kind FROM event_overrides WHERE username = ?", (username,)).fetchall()
    return {r["event_id"]: r["kind"] for r in rows}


def set_event_override(username: str, event_id: str, kind: str) -> None:
    """Salva (o sostituisce) la correzione di un evento. `kind` fuori dai tre valori: ValueError."""
    if kind not in ("verifica", "interrogazione", "none"):
        raise ValueError(kind)
    with connect() as con:
        _ensure_user(con, username)
        con.execute(
            "INSERT INTO event_overrides (username, event_id, kind, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(username, event_id) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at",
            (username, event_id, kind, now()))
        con.execute(
            "DELETE FROM event_overrides WHERE username = ? AND rowid NOT IN ("
            "SELECT rowid FROM event_overrides WHERE username = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?)",
            (username, username, MAX_OVERRIDES_PER_USER))


def get_done_events(username: str) -> set[str]:
    """Id degli eventi segnati come svolti."""
    with connect() as con:
        rows = con.execute("SELECT event_id FROM event_done WHERE username = ?", (username,)).fetchall()
    return {r["event_id"] for r in rows}


def set_event_done(username: str, event_id: str, done: bool) -> None:
    """Segna (done=True) o toglie (done=False) un evento come svolto."""
    with connect() as con:
        if not done:
            con.execute("DELETE FROM event_done WHERE username = ? AND event_id = ?", (username, event_id))
            return
        _ensure_user(con, username)
        con.execute(
            "INSERT INTO event_done (username, event_id, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(username, event_id) DO UPDATE SET updated_at = excluded.updated_at",
            (username, event_id, now()))
        con.execute(
            "DELETE FROM event_done WHERE username = ? AND rowid NOT IN ("
            "SELECT rowid FROM event_done WHERE username = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?)",
            (username, username, MAX_DONE_PER_USER))


def delete_user(username: str) -> None:
    """Cancella l'utente e (a cascata) orari, correzioni e compiti svolti."""
    with connect() as con:
        con.execute("DELETE FROM users WHERE username = ?", (username,))
