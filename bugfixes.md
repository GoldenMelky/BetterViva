# Checklist Bug Fixes e Miglioramenti

## Interfaccia Utente (UI) e Layout

- [ ] **Barra del Titolo:** Correggere l'aggiornamento dello stato sulla barra del titolo
- [ ] **Homepage:** Risolvere il problema dello scroll nella homepage
- [ ] **Pulsante Menu:**
  - [ ] Correggere la posizione e aggiungerlo nelle impostazioni dove è assente
  - [ ] Correggere la posizione in modalità orizzontale (landscape)
- [ ] **Tasto Indietro:** Garantire una posizione fissa/coerente e verificare il funzionamento sia del tasto fisico sia di quello a schermo
- [ ] **Colori:** Mostrare comunque un bordo visibile quando viene selezionato "nessun colore"

---

## Calendario e Vista Orario

- [ ] **Vista Orario:**
  - [ ] Correggere la posizione della verifica che appare nell'ora sbagliata per i prof di laboratorio
  - [ ] Corregger la visualizzazione degli eventi con più di 3 righe (la terza riga resta parzialmente visibile)
- [ ] **Navigazione e Calendario:**
  - [ ] Impostare il calendario con la settimana corrente in cima
  - [ ] Abilitare lo scorrimento verticale dei mesi
  - [ ] Risolvere il problema per cui, andando troppo avanti negli eventi, diventa impossibile tornare indietro
  - [ ] Risolvere la mancata visualizzazione degli eventi molto passati o molto futuri
  - [ ] Aggiungere il pulsante per tornare ad oggi

---

## Pop-up e Dettaglio Eventi

- [ ] Aggiungere il nome dell'autore in ogni pop-up di evento
- [ ] Verificare e correggere la comparsa di "Segna come fatto" nel pop-up quando l'evento ha `manual: true`

---

## Voti e Materie

- [ ] **Filtro Periodi:** Se è presente un solo periodo nei voti, mostrare solo "Tutto l'anno" senza far vedere i singoli periodi
- [ ] **Lista Materie:** Rendere le materie scrollabili nella sezione voti
