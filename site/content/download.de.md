---
title: Download
description: OpenFini für Windows, macOS und Linux herunterladen, oder die Web-App zum Selbsthosten. Alle Dateien mit Größe und SHA-256-Prüfsumme.
headline: OpenFini herunterladen
lead: >
  Installationsprogramme für sechs Plattformen und eine Web-App, für jede Version von GitHub Actions gebaut. Das
  Windows-Installationsprogramm installiert pro Benutzer und braucht keine Administratorrechte.
---

## Der erste Start {first-launch}

Die Builds sind noch nicht code-signiert, deshalb warnt das Betriebssystem beim ersten Start einmal. Die Dateien sind
nicht beschädigt.

- **Windows:** SmartScreen meldet *Der Computer wurde durch Windows geschützt*. Wählen Sie **Weitere Informationen**
  und dann **Trotzdem ausführen**.
- **macOS:** Die Builds sind ad hoc signiert, aber nicht notarisiert. Klicken Sie OpenFini im Ordner Programme mit
  gedrückter Ctrl-Taste an, wählen Sie **Öffnen** und bestätigen Sie. Meldet macOS, die App sei beschädigt, führen Sie
  einmal `xattr -cr /Applications/OpenFini.app` aus.
- **Linux:** Machen Sie das AppImage mit `chmod +x` ausführbar oder installieren Sie das `.deb`- oder `.rpm`-Paket.

Die Installationsprogramme werden in der CI gebaut und sind noch nicht auf jeder Art von Hardware getestet. Bitte
[melden Sie Probleme](https://github.com/philppplik/open-fini/issues).

## Systemvoraussetzungen {requirements}

| System | Mindestens | Web-Ansicht |
| --- | --- | --- |
| Windows x64 | Windows 10 oder 11 | WebView2 (Teil von Windows 11 und aktuellem Windows 10) |
| Windows ARM64 | Windows 11 on ARM | WebView2 |
| macOS | macOS 11 Big Sur, Apple Silicon oder Intel | WKWebView des Systems |
| Linux x64 und ARM64 | Ubuntu 22.04, Debian 12, Fedora und Arch derselben Zeit | WebKitGTK 4.1, auf den meisten Desktops vorinstalliert |

## Die Web-App {web}

Der PWA-Build ist ein ZIP mit statischen Dateien. Legen Sie es auf einen beliebigen statischen HTTPS-Host und öffnen
Sie es im Browser; es lässt sich installieren, funktioniert offline, und Ihre Dateien bleiben auf Ihrem Gerät. Details
stehen unter [Building](https://github.com/philppplik/open-fini/blob/main/docs/building.md) (englisch).

## Aus dem Quellcode bauen {source}

Sie brauchen Node.js 20 oder neuer und npm; Rust nur für die Desktop-App.

```sh
git clone https://github.com/philppplik/open-fini.git
cd open-fini
npm install
npm start
```
