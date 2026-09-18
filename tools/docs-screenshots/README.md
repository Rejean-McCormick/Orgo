# Orgo documentation screenshots

This tool creates **documentation screenshots only**. It does not perform visual-regression assertions and its output is not acceptance evidence.

## One-time setup

From the Orgo repository root:

```text
npm run docs:screenshots:setup
```

This installs the isolated Playwright tooling under `tools/docs-screenshots/` and installs Chromium for Playwright.

## Capture

Start Orgo locally, then run:

```text
npm run docs:screenshots
```

By default screenshots are written to:

```text
docs/screenshots/YYYY-MM-DD/
```

The generated folder contains the PNG files, a `README.md` gallery, and `manifest.json`.

## Authentication

The tool first tries the current HttpOnly session / local auto-login.

If the login screen appears, it reads credentials without printing them, in this order:

- `ORGO_DOCS_ORGANIZATION`, then `ORGO_ORGANIZATION`;
- `ORGO_DOCS_EMAIL`, then `ORGO_ADMIN_EMAIL`;
- `ORGO_DOCS_PASSWORD`, then `ORGO_ADMIN_PASSWORD`.

Values can come from the process environment or the repository `.env`.

The password is never written into the screenshot manifest or generated Markdown.

## Optional variables

```text
ORGO_DOCS_URL=http://127.0.0.1:3000
ORGO_DOCS_DATE=2026-09-17
ORGO_DOCS_OUTPUT=docs/screenshots/custom
ORGO_DOCS_WORKROOM_ID=<case-id>
ORGO_DOCS_VIEWPORT_WIDTH=1440
ORGO_DOCS_VIEWPORT_HEIGHT=1000
ORGO_DOCS_FULL_PAGE=1
```

Remote capture is refused by default to reduce the risk of accidentally committing real/sensitive production data. To intentionally capture a remote instance, set:

```text
ORGO_DOCS_ALLOW_REMOTE=1
```

Only use documentation-safe/demo data when generating committed screenshots.
