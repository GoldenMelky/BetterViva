# Checklist Bug Fixes e Miglioramenti

## Interfaccia Utente (UI) e Layout

- [x] **Barra del Titolo:** Correggere l'aggiornamento dello stato sulla barra del titolo
- [ ] **Homepage:** Risolvere il problema dello scroll nella homepage
- [x] **Pulsante Menu:** Correggere la posizione inconsistente e aggiungerlo nelle impostazioni dove è assente
- [x] **Tasto Indietro:** Garantire una posizione fissa/coerente e verificare il funzionamento sia del tasto fisico sia di quello a schermo
- [x] **Colori:** Mostrare comunque un bordo visibile quando viene selezionato "nessun colore"
- [x] Colore del testo di descrizione deve richiamare il colore principale (es. voti)

---

## Calendario e Vista Orario

- [ ] **Vista Orario:**
  - [ ] Correggere la posizione della verifica che appare nell'ora sbagliata per i prof di laboratorio
  - [x] Corregger la visualizzazione degli eventi con più di 3 righe (la terza riga resta parzialmente visibile)
- [ ] **Navigazione e Calendario:**
  - [x] Impostare il calendario con la settimana corrente in cima
  - [x] Abilitare lo scorrimento verticale dei mesi
  - [x] Risolvere il problema per cui, andando troppo avanti negli eventi, diventa impossibile tornare indietro
  - [x] Risolvere la mancata visualizzazione degli eventi molto passati o molto futuri
  - [x] Aggiungere il pulsante per tornare ad oggi

---

## Pop-up e Dettaglio Eventi

- [x] Aggiungere il nome dell'autore in ogni pop-up di evento
- [x] Verificare e correggere la comparsa di "Segna come fatto" nel pop-up quando l'evento ha `manual: true`

---

## Voti e Materie

- [x] **Filtro Periodi:** Se è presente un solo periodo nei voti, mostrare solo "Tutto l'anno" senza far vedere i singoli periodi
- [x] **Lista Materie:** Rendere le materie scrollabili nella sezione voti
