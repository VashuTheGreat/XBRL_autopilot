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
- Only when AI is enabled **and** the user has accepted the consent notice in Settings (and a key is set).
- **Auto-tagging rerank (Phase 8):** row labels, headings, sheet kind, candidate elements. No amounts.
- **Fix agent (Phase 10, [ADR-0012](decisions/ADR-0012-ai-fix-patches.md)):**
  - **Sent:** the problem (rule text, message, location), the related facts (values, needed to resolve arithmetic and missing amounts), and the Excel rows those facts came from (label + number cells).
  - **Built by `ContextBundleBuilder`:**
    - identity elements are left out (`IDENTITY_ELEMENT` in `ui/shared/privacy.ts`: names, PAN, DIN, CIN, addresses, contacts, membership / registration numbers);
    - text blocks are left out, except the problem's own fact;
    - text is cut to 200 characters;
    - the CIN and company name are scrubbed from free text, along with anything shaped like a CIN or PAN;
    - typed members that aren't sequence numbers are redacted;
    - fact keys are replaced by opaque ids.
  - **The sidecar checks the bundle again** (`src/services/fix_agent/privacy.py`, same pattern; a pytest compares them) and refuses with 422 before any LLM call.
  - **The exact payload sent** is appended to the project's `ai/history.jsonl` and shown under AI Agent → History, so the user can see what left the machine.
- **Never sent:** CIN, company name, director names/DIN/PAN, auditor details, file paths.

## Client fixtures never go to an AI service
- **The fixture guard** ([ADR-0012](decisions/ADR-0012-ai-fix-patches.md)): at startup, when `data/` exists (development), the app hashes the client files in `data/` (top-level `.xml`/`.xls`/`.xlsx`/`.xlsm`/`.pdf`, except the synthetic `sample_financials.xlsx`). A project whose workbook or imported instance matches one of them, by content or by original file name, gets no AI (AI panel: "repository client data").
- **The packaged app has no `data/`,** so there the guard is empty and never blocks.
- **Tests and the E2E** use scripted LLMs: fakes, or a local mock server through `GROQ_URL`. The live smoke test (`ui/e2e/phase10-live-groq.mjs`) uses only the synthetic sample workbook.
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
