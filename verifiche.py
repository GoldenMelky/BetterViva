"""Riconoscimento delle verifiche e interrogazioni dal testo di un evento.

Funzione pura: classify(text) -> "verifica" | "interrogazione" | None.

Come ragiona, per ogni parola chiave trovata nel testo (italiano e inglese):
- guarda le parole subito prima: se è un'attività di preparazione
  ("esercitazione per la verifica", "ripasso in vista dell'interrogazione",
  "studiare per il test", "exercises to prepare for the exam") non è la prova;
  lo stesso per correzioni e risultati ("correzione della verifica");
- guarda prima e dopo: negazioni e rinvii ("niente verifica", "non ci sarà
  interrogazione", "verifica annullata/rinviata/spostata") non sono la prova;
- le frasi si separano con . ; : ! ? a capo e "ma/però/but", così una preparazione in una
  frase non cancella una verifica vera in un'altra.
Se resta almeno una parola chiave valida l'evento è una prova; il tipo è quello
della prima. Per aggiungere parole o eccezioni basta modificare le liste qui sotto.
"""
from __future__ import annotations

import re
import unicodedata

# (espressione, tipo). Le più lunghe prima: "oral testing" non deve diventare "test".
KEYWORDS: list[tuple[str, str]] = [
    # italiano
    (r"interrogazion[ei]", "interrogazione"),
    (r"interrogat[oaie]", "interrogazione"),
    (r"prova orale", "interrogazione"),
    (r"verific[ah]e?", "verifica"),
    (r"compit[oi] in classe", "verifica"),
    (r"prova (?:scritta|pratica|di verifica)", "verifica"),
    (r"esame", "verifica"),
    (r"compito","verifica"),
    (r"test|quiz", "verifica"),
    # inglese
    (r"oral (?:test(?:ing)?|exam(?:ination)?|assessment)", "interrogazione"),
    (r"(?:written|final|mid ?term) (?:test|exam(?:ination)?)", "verifica"),
    (r"exam(?:ination)?s?", "verifica"),
    (r"tests?|quizz?es|quiz", "verifica"),
]
_KEYWORD = re.compile(r"\b(?:" + "|".join(f"(?P<k{i}>{p})" for i, (p, _) in enumerate(KEYWORDS)) + r")\b")

# Cosa precede la parola chiave e la rende una preparazione ("<preparazione> ... per la verifica")
_PREP_WORDS = (r"esercitazion\w*|esercizi\w*|ripass\w*|stud\w*|prepar\w*|simulazion\w*|ripetizion\w*|"
               r"allenament\w*|ripet\w*|exercise\w*|practice|revis\w*|study\w*|review\w*|prepar\w*|training|finire|complete|finish|do|work on|prepare for|get ready for|ready for")
_LINKS = r"(?:per|in vista|in preparazione|for|ahead of|before|to prepare for)"
_ARTICLES = r"(?:la|il|lo|l|le|gli|i|alla|allo|all|al|della|dello|dell|del|di|a|of|the|your|our|an?)"
_BEFORE_PREP = re.compile(
    rf"\b(?:{_PREP_WORDS})(?:\s+\w+){{0,4}}?\s+{_LINKS}(?:\s+{_ARTICLES}){{0,3}}\s*$"
    rf"|\b(?:{_PREP_WORDS})(?:\s+{_ARTICLES}){{0,2}}\s*$")        # "esercitazione verifica", "ripasso della verifica"
# Correzioni e risultati: la prova c'è già stata
_BEFORE_DONE = re.compile(
    r"\b(?:correzion\w*|corregg\w*|esit\w*|risultat\w*|restituzion\w*|correction\w*|results?|grad(?:ed|ing)|marking)"
    rf"(?:\s+{_ARTICLES}){{0,3}}\s*$")
# Negazioni subito prima
_BEFORE_NEG = re.compile(r"\b(?:non|no|niente|nessuna|nessun|senza|without|cancel+ed|postponed)(?:\s+\w+){0,2}\s*$")
# Annullamenti e rinvii subito dopo
_AFTER_MOVED = re.compile(
    r"^\s*(?:\w+\s+){0,3}?(?:annullat\w*|rinviat\w*|rimandat\w*|spostat\w*|posticipat\w*|saltat\w*|"
    r"cancel+ed|postponed|moved|rescheduled|off)\b")

# anche "ma/però/but": "Nessuna verifica, ma interrogazione di storia" sono due frasi
_DELIMS = re.compile(r"[.;:!?\n]+|\b(?:ma|pero|tuttavia|invece|but|however)\b")


def _normalize(text: str) -> str:
    """Minuscolo, senza accenti, apostrofi e virgole come spazi (restano . ; : ! ? e a capo)."""
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"[’'`´,()\[\]\"“”]", " ", text)
    return re.sub(r"[ \t]+", " ", text)


def classify(text: str) -> str | None:
    """'verifica', 'interrogazione' oppure None se il testo non annuncia una prova."""
    for clause in _DELIMS.split(_normalize(text)):
        for m in _KEYWORD.finditer(clause):
            before, after = clause[:m.start()], clause[m.end():]
            if (_BEFORE_PREP.search(before) or _BEFORE_DONE.search(before)
                    or _BEFORE_NEG.search(before) or _AFTER_MOVED.search(after)):
                continue
            kind = next(KEYWORDS[i][1] for i in range(len(KEYWORDS)) if m.group(f"k{i}"))
            return kind
    return None
