---
title: Community
description: So tragen Sie zu OpenFini bei: Code, Übersetzungen, Erweiterungen, Fehlerberichte und gute erste Aufgaben. MIT-lizenziert und offen auf GitHub entwickelt.
headline: Offen entwickelt. Machen Sie mit.
lead: >
  OpenFini ist eine kleine, schnelle Kreativsuite mit wenigen Abhängigkeiten, und Beiträge halten sie so. Beheben Sie
  einen Fehler, fügen Sie einen Filter hinzu, übersetzen Sie die Oberfläche, schreiben Sie eine Erweiterung oder
  verbessern Sie die Dokumentation.
issues_title: Gute erste Aufgaben
issues_empty: >
  Zurzeit trägt kein offenes Issue das Label *good first issue*. Die [Roadmap](site:roadmap/) und die
  [bekannten Grenzen](site-en:docs/dev/known-limits/) zeigen, was fehlt, und der Entwicklerleitfaden nennt kleine erste
  Beiträge.
---

## Code beitragen {code}

1. Öffnen Sie für alles, was größer als eine kleine Korrektur ist, zuerst ein Issue, damit der Ansatz abgestimmt ist.
2. Legen Sie einen Branch wie `feat/kurzer-name` oder `fix/kurzer-name` an. `main` ist geschützt; Änderungen kommen
   über Pull Requests mit grüner CI.
3. Halten Sie sich an die Konventionen: ES-Module, JSDoc an exportierten Funktionen, reine Engines ohne DOM, jede
   Dokumentänderung rückgängig machbar.
4. Führen Sie `npm test`, `npm run build` und `npm run check:size` aus und öffnen Sie einen Pull Request, der Problem,
   Ansatz und Prüfung beschreibt.

Alles für Nutzer Sichtbare ist US-Englisch, und nur eigene Arbeit wird angenommen: siehe die
[Clean-Room-Richtlinie](site-en:docs/dev/clean-room/) (englisch).
[Leitfaden für Beiträge](https://github.com/philppplik/open-fini/blob/main/CONTRIBUTING.md)

## Gute Einstiegspunkte {start}

- Eine Korrektur oder einen Filter als `EffectModule` hinzufügen; er erscheint automatisch in Menüs und Bedienfeldern.
- Eine vorgefertigte Form für das Vector-Studio hinzufügen.
- Silbentrennung, Zeilenumbruch oder PDF-Ausgabe verbessern, mit Tests.
- Barrierefreiheitsprobleme finden und beheben.

## Übersetzen {translate}

Die Oberfläche gibt es auf US-Englisch und Deutsch, und eine neue Sprache ist nur eine Übersetzungsdatei entfernt.
Der [Leitfaden zur Internationalisierung](site-en:docs/dev/i18n/) erklärt Katalog, Prüfungen und das Hinzufügen einer
Sprache; das [Glossar](site-en:docs/dev/i18n-glossary/) hält die Begriffe einheitlich.

## Erweiterungen und SDK {extensions}

Isolierte `.ofext`-Erweiterungen fügen Befehle, Bedienfelder, Designs, Vorlagen und Vibe-Werkzeuge hinzu.
`npm run ext:create` legt eine neue aus einer Vorlage an, `npm run ext:pack` packt sie. Siehe den
[Erweiterungsleitfaden](site-en:docs/extensions/) und die [SDK-Referenz](site-en:docs/extension-sdk-reference/).

## Fehler melden {bugs}

Nutzen Sie die [Issue-Vorlagen](https://github.com/philppplik/open-fini/issues/new/choose). Geben Sie die
OpenFini-Version (*Hilfe ▸ Über*), Ihre Plattform, Schritte zum Nachvollziehen und das erwartete Verhalten an; hängen
Sie wenn möglich eine kleine `.ofini`-Datei an. **Sicherheitsprobleme** melden Sie bitte vertraulich über das
[Formular für Sicherheitshinweise](https://github.com/philppplik/open-fini/security/advisories/new), nicht als
öffentliches Issue.

## Verhaltenskodex {conduct}

Seien Sie freundlich. Wer mitmacht, stimmt dem
[Verhaltenskodex](https://github.com/philppplik/open-fini/blob/main/CODE_OF_CONDUCT.md) zu; Meldungen gehen vertraulich
an die Maintainer, über den in der Sicherheitsrichtlinie beschriebenen Weg.
