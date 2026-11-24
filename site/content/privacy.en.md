---
title: Privacy
description: What this website and the OpenFini app collect and send. The site uses no cookies or analytics; the app has no account and no telemetry.
headline: Privacy
lead: >
  Short version: this site sets no cookies and runs no analytics, and the app has no account, sends no telemetry and
  makes no network requests of its own unless you switch a feature on.
---

## This website {site}

- The site is static and hosted on GitHub Pages. GitHub receives the usual request data (such as your IP address and
  browser) to deliver the pages; see GitHub's privacy statement.
- No cookies, no analytics, no tracking pixels, no fonts or scripts from third parties.
- The Download page asks the GitHub API (`api.github.com`) from your browser for the latest release, so the file list
  stays current. GitHub sees that request. Without JavaScript the page shows the list from the time it was built and
  makes no request.
- Your theme choice and whether you dismissed the German-language hint are kept in your browser's local storage; the
  release information is cached for an hour in session storage. Nothing of it leaves your device.

## The app {app}

- Documents live in files you choose. Recovery copies, recent files, settings and, if you add them, AI keys stay in the
  browser or app profile on your device.
- OpenFini makes no network requests of its own except what you switch on: AI providers and MCP servers you add,
  publishing, extensions you grant network access, update checks, sign-in with a provider, and collaboration rooms you
  join (end-to-end encrypted; the relay only sees ciphertext).
- *Offline mode* blocks every outbound feature at once. An app lock can encrypt local data at rest, and a stored-data
  inventory shows what is kept.

Details: [Security](site-en:docs/dev/security/) and [Security and privacy](site-en:docs/security-and-privacy/).

## Questions {questions}

Open an issue on [GitHub](https://github.com/philppplik/open-fini/issues), or report a security problem privately
through the [security advisory form](https://github.com/philppplik/open-fini/security/advisories/new).
