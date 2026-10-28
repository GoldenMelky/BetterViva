# Bugfix e miglioramenti

Backlog ricavato dalla lista originale e contestualizzato all’implementazione attuale di BetterViva. Le caselle sono lasciate non selezionate: indicano gli interventi da verificare o completare, non lo stato dedotto automaticamente dal codice.

## Home, navigazione e layout

- [ ] **Aggiornamento dello stato nell’intestazione:** verificare che lo stato di sincronizzazione (`#sync-status`, aggiornato dalle richieste API in `static/app.js`) rifletta correttamente caricamento, ultimo aggiornamento ed errori di connessione.
- [ ] **Scroll della home:** correggere lo scorrimento della home e verificare che funzioni con entrambe le viste, orario e lista eventi. La selezione dei giorni e i pannelli/lista si sincronizzano in `static/home.js`; controllare anche overflow, altezza e gesture in `static/style.css`.
- [ ] **Pulsante menu:** mantenere posizione e visibilità coerenti tra home, voti e impostazioni, compresa la modalità orizzontale. Verificare insieme l’intestazione (`#menu-button`, `#app-menu` in `static/index.html`), le regole di visibilità in `show()` (`static/app.js`) e il posizionamento responsive in `static/style.css`; il menu deve essere raggiungibile anche dalle impostazioni.
- [ ] **Tasto indietro:** garantire una posizione a schermo coerente e il comportamento atteso sia con il pulsante dell’interfaccia sia con il tasto indietro fisico/browser. Il flusso passa da `popstate`, `appBack()` e `Sheet.handleBack()` in `static/app.js` e `static/sheet.js`; verificare anche la navigazione interna dei voti e del setup.
- [ ] **Bordo senza colore materia:** mantenere un contorno distinguibile per eventi e materie a cui non è assegnato un colore. La classe `no-subject-color` viene applicata da `colorSubject()` in `static/home.js`; verificare che il bordo resti visibile su entrambe le viste e con i diversi sfondi.

## Eventi e vista orario

- [ ] **Ora delle verifiche per i docenti di laboratorio:** correggere l’associazione tra verifica e ora visualizzata quando l’evento riguarda un docente di laboratorio. In `static/home.js` l’ora deriva dalla materia associata all’evento e dalle celle dell’orario; verificare il caso anche con la risoluzione di materia/docente in `events.py` e con i dati di laboratorio dell’orario.
- [ ] **Azione “Segna come completato” negli eventi manuali:** verificare la regola di visualizzazione dell’azione nel popup. `EventSheet.showEvent()` (`static/sheet.js`) la mostra solo per compiti senza tipo e con `manual` falso; chiarire se `manual: true` debba invece consentirla e controllare che il salvataggio continui a usare l’endpoint di completamento.
- [ ] **Eventi molto passati o molto futuri:** fare in modo che siano reperibili anche eventi fuori dalla finestra iniziale caricata. `Home` usa una finestra mobile di 42 giorni e la sposta a blocchi; verificare i limiti e il recupero dei dati in `static/home.js`, insieme ai parametri temporali dell’API in `events.py`/`main.py`.
- [ ] **Ritorno indietro dopo essersi spostati molto avanti negli eventi:** correggere la navigazione della lista quando l’utente ha raggiunto date lontane. Verificare caricamento delle finestre precedenti, aggiornamento di `windowStart` e mantenimento della data selezionata in `shiftWindow()` e `render()` (`static/home.js`).
- [ ] **Testi lunghi nella vista orario:** quando un evento supera tre righe, evitare che la terza riga venga tagliata o resti visibile solo in parte. Controllare il limite a due righe della modalità compatta (`.ev-row-compact .ev` in `static/style.css`) e la disposizione/contenimento delle righe in `fillPanel()` (`static/home.js`).
- [ ] **Autore nei popup degli eventi:** mostrare il nome dell’autore in ogni popup di dettaglio pertinente, non solo quando è presente come `teacher`. Il dato viene normalizzato in `events.py` e visualizzato condizionalmente in `EventSheet.showEvent()` (`static/sheet.js`); verificare anche i popup aperti dal calendario.

## Calendario

- [ ] **Settimana corrente in cima:** aprendo il calendario, posizionare la settimana corrente all’inizio della porzione visibile, senza perdere la navigazione verso le altre settimane.
- [ ] **Scorrimento verticale dei mesi:** consentire di attraversare i mesi in entrambe le direzioni e caricare i mesi adiacenti mantenendo stabile la posizione di lettura. Il caricamento progressivo e la conservazione dello scroll sono gestiti da `static/calendar.js`; verificare anche il contenitore `#cal-scroll` in `static/index.html` e `static/style.css`.
- [ ] **Pulsante “Oggi”:** rendere sempre possibile tornare rapidamente alla settimana corrente dal calendario. Verificare che `#cal-today` richiami il posizionamento corretto anche dopo aver caricato altri mesi (`static/calendar.js`).

## Voti

- [ ] **Un solo periodo:** se l’API restituisce un solo periodo, mostrare soltanto “Tutto l’anno”, senza la scheda del singolo periodo. La costruzione delle schede è in `renderTabs()` e i dati dei periodi arrivano da `grades.py`; verificare anche il ripristino della selezione dopo un aggiornamento.
- [ ] **Elenco materie scorrevole:** consentire di scorrere l’elenco delle materie nella schermata dei voti senza bloccare il resto della pagina. L’elenco è `.grade-subject-list` in `static/grades.js`; verificare altezza e overflow in `static/style.css` su schermi piccoli e grandi.
