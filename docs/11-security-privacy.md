# 11 · Security & privacy

The app handles unpublished company financial statements. Treat every workbook, filing and `.axbrl` file as confidential.

## Secrets
- **Groq API key:**
  - In development it's read from `.env` (gitignored, never committed). `.env.example` holds an empty placeholder.
  - In the packaged app the user enters it in Settings, and it's encrypted with Electron `safeStorage` (Windows DPAPI, tied to the user account). It's stored under `%APPDATA%/XBRL Autopilot/secrets.bin`.
  - The key is **never** sent to the renderer, logged, or written to a project file. Main passes it to the sidecar as an env var at spawn time.
  - **Never bundle a key in the installer**, because anyone with the exe could extract it. A licensed proxy server can hold the key later (see [ADR-0003](decisions/ADR-0003-groq-key.md)).
  - ⚠️ The development key was shared in chat on 2026-11-10. **Rotate it** before any customer-facing use.

## Data sent to the AI (Groq)
- Only when AI is enabled **and** the user has accepted the consent notice in Settings.
- **Sent:** row labels, sheet structure, taxonomy candidate definitions, validation messages, and amounts only when needed to resolve an arithmetic issue.
- **Never sent:** CIN, company name, director names/DIN/PAN, auditor details, file paths.
- Everything else (parsing, validation, XML generation) is fully offline.

## Electron hardening
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- A strict CSP in `index.html`: `default-src 'self'`, with `'unsafe-eval'` only if Monaco or Univer require it (document it if so). Remote origins are allowed only for dev HMR.
- A typed preload whitelist (`window.xap`). No generic `send(channel, …)`.
- Block navigation and `window.open` (`setWindowOpenHandler` → deny; external links go through `shell.openExternal` after validation).
- Validate every IPC payload in main. Never pass renderer-provided paths to `shell.openPath` or `spawn` without checking them.

## Sidecar hardening
- It binds to **127.0.0.1 only**, on a random port, and requires a per-launch random bearer token for every route except `/health`.
- It's stateless and never writes user files.
- CORS is off: requests come only from main, not the renderer.

## Logs
- `%APPDATA%/XBRL Autopilot/logs/` (rotating). Logs never contain amounts, labels or keys; they record ids and codes only.
- Logfire telemetry stays disabled unless `PYDANTIC_LOGFIRE_API_KEY` is set (dev only).
