# Orgo UI screenshots

This directory contains dated screenshots used in Orgo documentation.

Generate the current set from the repository root:

```text
npm run docs:screenshots
```

One-time Playwright/Chromium setup:

```text
npm run docs:screenshots:setup
```

Output convention:

```text
docs/screenshots/
  YYYY-MM-DD/
    01-today.png
    02-my-work.png
    03-workrooms.png
    04-workroom-overview.png
    ...
    README.md
    manifest.json
```

The generator captures the OIM user surfaces and, when the local dataset contains a Workroom, its principal lenses. It also captures Supervisor surfaces and the Full Control Panel when the authenticated actor is authorized.

These images are **documentation artifacts only**. They do not replace browser tests or acceptance evidence. Generate them only from documentation-safe/demo data.
