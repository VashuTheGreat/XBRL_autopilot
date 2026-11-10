# 02 · Architecture

## Big picture
```
┌──────────────────────────── XBRL Autopilot.exe (Electron) ─────────────────────────────┐
│                                                                                        │
│  Renderer (React 19 + Tailwind 4)          Main process (Node)                         │
│  ├ Univer Excel pane                       ├ window/menu/shortcuts                     │
│  ├ XBRL Form / XML (Monaco) / Preview      ├ project I/O (.axbrl zip), autosave        │
│  ├ Problems, AI panel, Inspector           ├ app DB (SQLite: recents, mapping memory)  │
│  └ stores (Zustand)                        ├ settings + safeStorage (Groq key)         │
│        ▲  typed IPC (preload bridge)       ├ engine host (@xap/engine; utilityProcess) │
│        └──────────────────────────────────▶├ sidecar manager ──┐                       │
│                                            └ MCA tool launcher │                       │
└────────────────────────────────────────────────────────────────┼───────────────────────┘
                                                                 │ HTTP 127.0.0.1:<port>
                                                                 │ Authorization: Bearer <per-launch token>
                                              ┌──────────────────▼──────────────────────┐
                                              │ Python sidecar (FastAPI, PyInstaller)   │
                                              │ ├ /taxonomies (knowledge_base/*.json)   │
                                              │ ├ /mapping/suggest  (auto-tagging)      │
                                              │ ├ /fix/propose      (Groq agent)        │
                                              │ └ /health                               │
                                              └──────────────────┬──────────────────────┘
                                                                 │ HTTPS (only if AI enabled)
                                                                 ▼
                                                             Groq API
```

## Layer responsibilities
| Layer | Owns | Must NOT |
|---|---|---|
| **Renderer** (`ui/src`) | Presentation, interaction, view state | Touch the filesystem or network directly; hold the source of truth for facts |
| **Main** (`ui/electron/main`) | Files, DB, settings and secrets, process lifecycle, the engine host, routing IPC to the engine or sidecar | Do heavy synchronous work on the main thread (use a utilityProcess or worker) |
| **Engine** (`engine/`) | Filing model, authority (compiled taxonomy + rules), validation, XML generation/import, deterministic fixes | Make network calls, call the AI, or depend on Electron. It's a pure library that also runs in Vitest |
| **Sidecar** (`api/`, `src/`) | Knowledge-base queries, retrieval/embeddings, LLM calls (Groq), Excel layout heuristics for tagging | Hold project state; write to user files |

## Why hybrid (TS engine + Python AI)?
See [ADR-0001](decisions/ADR-0001-hybrid-engine.md).
- The legacy JS engine is already tested for C&I. In-process TS gives **live validation as the user types** and **offline XML generation**.
- The team's AI and retrieval work is in Python, and the Python ML/XBRL ecosystem (Arelle, embeddings) is stronger there.

## Data flow: the main loop
1. **New filing:** the wizard collects company, CIN, taxonomy, report type, FY and rounding. Main creates an in-memory project and the engine creates a `Filing`.
2. **Import Excel:** main parses the xlsx with exceljs → a sheet model (cells, values, styles) → the renderer shows it in Univer. A normalized row list is sent to the sidecar.
3. **Auto-tag:** sidecar `/mapping/suggest` returns `cellRef → {concept, period, dims, confidence, rationale}`. The renderer colours the cells. The user accepts, rejects or changes each one.
4. **Facts:** each accepted mapping becomes an engine fact (`session.setValue`). The value comes from the cell, after scale and sign handling.
5. **Validate (live):** the engine runs gate, rules and calculations, and the issues flow into the Problems panel, each with a location (cell / ELR / fact).
6. **Fix:** deterministic quick fixes come first. Then "Ask AI" sends the issue plus a context bundle to sidecar `/fix/propose`, which returns a patch list. The user reviews it, the engine applies it, and validation runs again.
7. **Generate XML:** `engine.generateInstance()` → the Monaco XML tab + `output/NNN.xml` inside the project.
8. **External check:** launch the MCA tool. The user pastes or loads its errors → parse → back to step 6.
9. **Save:** `.axbrl` (zip). Approved mappings are also written to the app DB as mapping memory.

## Processes and lifecycle
- **App start:**
  1. Main starts.
  2. The sidecar manager picks a free port and generates a random token.
  3. It spawns the sidecar: `uv run uvicorn api.app:app` in dev, `resources/sidecar/xap-sidecar.exe` in prod. The port and token go in as env vars.
  4. It polls `/health` (timeout 30 s) and pushes the status to the renderer.
- **Crash:** the sidecar is restarted with backoff (max 3 tries). The UI keeps working without AI.
- **Quit:** main sends SIGTERM to the sidecar, waits 2 s, then kills it.

## Directory conventions
```
ui/
  electron/main/      index.ts, ipc/*.ts (one file per domain), sidecar.ts, project/*.ts, db.ts, settings.ts
  electron/preload/   index.ts (exposes window.xap), api.d.ts
  src/
    app/              App.tsx, layout (ActivityBar, Panels, StatusBar)
    features/         welcome/, excel/, xbrl-form/, xml/, preview/, problems/, ai/, taxonomy/, settings/
    components/ui/    shadcn-style primitives
    stores/           zustand stores (project, ui, sidecar)
    lib/              utils
engine/
  src/                library modules (see 04-xbrl-engine.md)
  compiler/           authority compiler (Node scripts)
  authority/          compiled authority JSON
  test/
```

## Tech stack (versions pinned 2026-11-10)
- **Desktop and UI:** Electron 45.2, electron-vite 6.0, Vite 8.3, React 19.3, TypeScript 7.0, Tailwind 4.3, Zustand 5.1, react-resizable-panels 4.21, lucide-react.
- **Editors and grids:** Monaco 0.57 (+ @monaco-editor/react 4.7), Univer presets 1.4.
- **Files and storage:** exceljs 4.4, jszip 3.10, better-sqlite3 13.
- **Tests and packaging:** Vitest 5.1, electron-builder 26.18.
- **Python sidecar:** Python 3.12 (uv), FastAPI, uvicorn, langchain-chroma, sentence-transformers (→ ONNX later), Groq through its OpenAI-compatible endpoint, PyInstaller.
- **Package manager:** **pnpm** workspaces (`engine`, `ui`).
