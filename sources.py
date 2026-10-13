"""Collante tra BetterViva e il wrapper ClasseViva (classeviva.py).

È l'UNICO file da adattare: restituisce le liste grezze dell'API
(le stesse di lessons.json e subjects.json) usando l'istanza `Utente`.
"""
from __future__ import annotations

from datetime import date


def fetch_subjects(user) -> list[dict]:
    """Ritorna `subjects`: [{"id": 229210, "description": "INFORMATICA",
    "teachers": [{"teacherId": "A371349", "teacherName": "CARBONE VINCENZINA"}]}, ...]"""
    raise NotImplementedError("collega qui il metodo di Utente che legge le materie")


def fetch_lessons(user, start: date, end: date) -> list[dict]:
    """Ritorna `lessons` tra start e end inclusi: [{"evtId", "evtDate": "2026-10-06",
    "evtCode", "evtHPos", "authorName", "subjectId", "subjectDesc", "lessonType", ...}, ...]"""
    raise NotImplementedError("collega qui il metodo di Utente che legge le lezioni")
