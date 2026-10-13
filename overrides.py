"""Applica le correzioni manuali al riconoscimento di verifiche e interrogazioni.

Le correzioni stanno nel database (db.get_event_overrides / db.set_event_override):
id evento -> "verifica" | "interrogazione" | "none".
- "none" è la blacklist: l'evento non è una prova, anche se il testo sembra dire il contrario;
- gli altri due segnano come prova un evento che l'algoritmo non aveva riconosciuto
  (o ne cambiano il tipo).
L'id dell'evento è quello calcolato da events.py (data + materia + testo).
"""
from __future__ import annotations


def apply(events: list[dict], mapping: dict[str, str]) -> list[dict]:
    """Sovrascrive `kind` dove c'è una correzione; `manual` dice se il valore viene dall'utente."""
    for e in events:
        o = mapping.get(e["id"])
        e["manual"] = o is not None
        if o is not None:
            e["kind"] = None if o == "none" else o
    return events
