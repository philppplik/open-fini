---
title: Datenschutz
description: Was diese Website und die App OpenFini erheben und senden. Die Website nutzt keine Cookies und keine Analyse; die App hat kein Konto und keine Telemetrie.
headline: Datenschutz
lead: >
  Kurz gesagt: Diese Website setzt keine Cookies und keine Analyse ein, und die App hat kein Konto, sendet keine
  Telemetrie und baut von sich aus keine Netzwerkverbindungen auf, solange Sie keine Funktion dafür einschalten.
---

## Diese Website {site}

- Die Website ist statisch und wird auf GitHub Pages gehostet. GitHub erhält dabei die üblichen Anfragedaten (etwa
  Ihre IP-Adresse und Ihren Browser), um die Seiten auszuliefern; siehe die Datenschutzerklärung von GitHub.
- Keine Cookies, keine Analyse, keine Zählpixel, keine Schriften oder Skripte von Dritten.
- Die Download-Seite fragt aus Ihrem Browser die GitHub-API (`api.github.com`) nach der neuesten Version, damit die
  Dateiliste aktuell bleibt. GitHub sieht diese Anfrage. Ohne JavaScript zeigt die Seite die Liste vom Zeitpunkt ihrer
  Erstellung und stellt keine Anfrage.
- Ihre Wahl zwischen hell und dunkel und ob Sie den Hinweis auf die deutsche Seite geschlossen haben, liegen im lokalen
  Speicher Ihres Browsers; die Versionsinformation wird eine Stunde im Sitzungsspeicher gehalten. Nichts davon
  verlässt Ihr Gerät.

## Die App {app}

- Dokumente liegen in Dateien, die Sie wählen. Wiederherstellungskopien, zuletzt geöffnete Dateien, Einstellungen und,
  falls Sie welche hinzufügen, KI-Schlüssel bleiben im Browser- oder App-Profil auf Ihrem Gerät.
- OpenFini baut von sich aus keine Netzwerkverbindungen auf, außer für das, was Sie einschalten: KI-Anbieter und
  MCP-Server, die Sie hinzufügen, Veröffentlichen, Erweiterungen mit Netzwerkzugriff, Update-Prüfungen, Anmeldung bei
  einem Anbieter und Räume für die Zusammenarbeit (Ende-zu-Ende-verschlüsselt; das Relay sieht nur verschlüsselte
  Daten).
- Der *Offline-Modus* sperrt alle ausgehenden Funktionen auf einmal. Eine App-Sperre kann lokale Daten verschlüsseln,
  und eine Übersicht zeigt, was gespeichert ist.

Details (englisch): [Security](site-en:docs/dev/security/) und [Security and privacy](site-en:docs/security-and-privacy/).

## Fragen {questions}

Öffnen Sie ein Issue auf [GitHub](https://github.com/philppplik/open-fini/issues), oder melden Sie ein
Sicherheitsproblem vertraulich über das
[Formular für Sicherheitshinweise](https://github.com/philppplik/open-fini/security/advisories/new).
