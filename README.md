# Questionari per i pazienti

Pagina statica per compilare i questionari (VISA-A, VISA-P, HAGOS) inviati dallo studio.
Non contiene dati di pazienti: legge il questionario da compilare dall'archivio dello studio tramite il codice
personale presente nel link (dopo «#», che il browser non invia a questo sito) e consegna le risposte
**cifrate sul telefono del paziente** con la chiave pubblica dello studio (AES-GCM 256 + RSA-OAEP 2048/SHA-256).
Solo il gestionale dello studio può decifrarle.

Il codice sorgente è mantenuto nel gestionale (cartella `pagina_questionari/`); questa è la copia pubblicata con GitHub Pages.
