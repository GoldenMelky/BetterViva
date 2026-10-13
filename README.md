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

Le credenziali sono salvate nella cache del browser e vengono mandate al backend ogni volta che il token scade.

Le uniche informazioni che vengono salvate sono la configurazione dell'orario e la rinominazione delle materie.

## Analittica

Per migliorare l'esperienza e correggere bug, potrei implementare un sistema di analittica completamente anonimo, trasparente e **opzionale**.

## TODO

- [ ] Migliorare l'interfaccia
- [ ] Bacheca
- [ ] Voti
- [ ] Assenze
- [ ] Note
- [ ] Altre funzioni di ClasseViva
- [ ] Renderlo serverless

