# BetterViva

Una webapp mobile-first, che mostra compiti, eventi e orario di ClasseViva in modo più chiaro e comodo dell'app ufficiale.

> **Nota:** BetterViva è un progetto indipendente e non è affiliato, approvato o supportato da Spaggiari. Usa le API non documentate di ClasseViva, che possono cambiare in qualsiasi momento.

## Perchè BetterViva?

Questo progetto è stato all'inzio concepito come "client desktop per ClasseViva", poi Spaggiari ha deciso di rompere completamente l'app mobile (2026), quindi il progetto si è trasformato in un client mobile che mira ad essere più comodo per gli studenti.

Oltre all'interfaccia rinnovata, BetterViva permette una rapida visione dell'orario scolastico integrata con i compiti.


## Come funziona?

Usa le API che Spaggiari usa nella sua app mobile, vengono riformattate unificando agenda e compiti, siccome molti docenti non li distinguono.


## Sicurezza e privacy

Giustamente per ottenere i dati del tuo account ClasseViva, servono le credenziali che sì, passerano per il backend, ma non verranno mai salvate, viene generato un token di accesso valido 90 minuti, che resta in memoria per un accesso veloce.

Le credenziali possono essere salvate cifrate nel browser e vengono mandate al backend ogni volta che il token scade.

Gli eventi di agenda e compiti vengono unificati in un singolo dataset per tutto l'anno scolastico; home e calendario lo condividono, filtrando nel calendario verifiche e interrogazioni. Il profilo e i dati (eventi, orario, voti e bacheca, inclusi i contenuti già aperti) vengono conservati in IndexedDB per account e mostrati subito alle aperture successive. Eventi, orario, voti e bacheca vengono aggiornati all'avvio dell'app, non entrando nelle singole viste; la cache locale resta immediatamente disponibile offline. Un confronto frontend degli snapshot alimenta la campanella con compiti/eventi aggiunti, modificati o rimossi e nuovi voti/avvisi: le notifiche si eliminano dopo 24 ore e si segnano come lette quando si apre la singola notifica. Il titolo identifica il tipo e l’elemento, mentre la data dell’evento, del voto o della comunicazione è mostrata a destra. Cliccando una notifica si apre la scheda del contenuto corrispondente. Con `?debug=1` è disponibile una sezione di debug che mostra lo stato degli snapshot e consente di aggiungere notifiche di prova a partire dall'ultimo compito, voto o avviso in cache. Se i dati cambiano, la vista aperta viene aggiornata immediatamente. Le modifiche invalidano solo gli aggiornamenti in corso delle risorse coinvolte, senza cancellare i dati offline non correlati. Il logout elimina i dati personali memorizzati localmente. Anche HTML, JavaScript, CSS e gli altri asset statici vengono serviti dalla cache mentre si aggiornano in background.

Sul server vengono salvate la configurazione dell'orario e le preferenze delle materie (nome, laboratorio e colore); la cache locale include anche i dati necessari a mostrare eventi e calendario senza attesa.

Il feedback inviato dall'app viene inoltrato a un bot Telegram. Configura sul server le variabili d'ambiente `BV_TELEGRAM_BOT_TOKEN` e `BV_TELEGRAM_CHAT_ID`; non inserirle mai nel codice frontend. Sono accettati messaggi fino a 2000 caratteri, con un limite di tre invii ogni dieci minuti per indirizzo IP. Il feedback non include dati dell'account.

## Analittica

Per migliorare l'esperienza e correggere bug, potrei implementare un sistema di analittica completamente anonimo, trasparente e **opzionale**.

## TODO

- [ ] Migliorare l'interfaccia
  - [ ] Interfaccia per tablet e desktop
- [x] Bacheca
- [x] Voti
  - [x] Calcolatore di voti
- [ ] Assenze
- [ ] Note
- [ ] Altre funzioni di ClasseViva
- [ ] Temi
- [x] Impostazioni
- [ ] Renderlo serverless
- [x] Sistema caching decente
- [x] Colori per materia
- [x] Feedback