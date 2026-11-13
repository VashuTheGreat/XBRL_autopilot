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
                                              │ ├ /conversations & /chat (in-memory)    │
                                              │ ├ /health & /ingest                     │
                                              │ └ Logfire observability spans           │
                                              └──────────────────┬──────────────────────┘
                                                                 │ HTTPS (AI / Vector DB)
                                                                 ├────────────────────────┐
                                                                 ▼                        ▼
                                                             Groq API           Qdrant Vector DB
                                                                                (4 Cloud Collections)
```

## Layer responsibilities
| Layer | Owns | Must NOT |
|---|---|---|
| **Renderer** (`ui/src`) | Presentation, interaction, view state | Touch the filesystem or network directly; hold the source of truth for facts |
| **Main** (`ui/electron/main`) | Files, DB, settings and secrets, process lifecycle, the engine host, routing IPC to the engine or sidecar | Do heavy synchronous work on the main thread (use a utilityProcess or worker) |
| **Engine** (`engine/`) | Filing model, authority (compiled taxonomy + rules), validation, XML generation/import, deterministic fixes | Make network calls, call the AI, or depend on Electron. It's a pure library that also runs in Vitest |
| **Sidecar** (`api/`, `src/`) | Knowledge-base queries, retrieval/embeddings, LLM calls (Groq), Excel layout heuristics for tagging | Hold project state; write to user files |

## Knowledge-base files: two per taxonomy, kept separate on purpose
Each taxonomy has two generated files in `knowledge_base/`, built from the same official files in `data/` by `make rebuild`:

| File | Built by | Used for | Shape |
|---|---|---|---|
| `<kb>_knowledge_base.json` (C&I, Ind AS, Costing) | `src/services/extractors/*.py` | Browsing routes (`/elrs`, `/elrs/{code}/tree`, search, concept detail), Qdrant vector index, raw MCA rule text | Labels incl. Hindi, raw arcs, raw business-rule rows: tuned for search and display |
| `<kb>_engine_authority.json` (C&I, Ind AS) | `src/services/engine_authority/` | The engine (`/{id}/authority`): facts, XML, validation | DTS from the entry points, prohibition/override applied, full definition-arc attributes, dimensional model, type facets, validator patches: exact enough to file |

- **Why separate:**
  - Each file has one job, and one consumer can change without breaking the other: AI/search tuning won't move a byte of the filed XML, and engine fixes won't change search results.
  - The engine file is golden-checked against MCA output, while the browsing file is free to evolve.
- **The cost:** concepts and labels are stored twice (about 15 MB).
- **Guard:** `tests/test_engine_authority.py::test_engine_and_browsing_see_the_same_taxonomy` fails if the two disagree on statements (ELRs) or concepts. The user can therefore never browse to an element the engine can't file.
- **Rule of thumb:** anything that decides what goes into the XML reads the engine file; anything that helps the user find or understand something reads the browsing file.

Decided 2026-11-10 ([ADR-0010](decisions/ADR-0010-engine-authority-from-knowledge-base.md)).

## Vector Database Architecture (Qdrant Cloud)
Local ChromaDB has been migrated to Qdrant Cloud (`fe6c821a-bb9f-4e84-b611-fa9f7236bd69.us-west-2-0.aws.cloud.qdrant.io:6333`). Four collections are maintained with 768-dimensional embeddings (`sentence-transformers/all-mpnet-base-v2`) and Cosine distance metric:
- `ci_taxonomy`: Corporate Insolvency taxonomy concepts.
- `cost_taxonomy`: Costing taxonomy concepts.
- `ind_as_taxonomy`: Indian Accounting Standards taxonomy concepts.
- `xbrl_agent`: Statutory MCA and XBRL guidelines (`data/agent/MCA.txt`) used for agent RAG.

`make rebuild` executes `python3 -m src.pipeline.rebuild_knowledge_base_pipeline`, which deletes and recreates all four collections fresh, runs extractors, compiles engine authorities and rules, and populates the vector stores.

## In-Memory Chatbot Architecture
The sidecar includes a dedicated XBRL assistant running on LangGraph:
- **State engine:** LangGraph `StateGraph` compiled with `InMemorySaver` (`src/services/memory/inmemory.py`).
- **Isolation:** Active threads are tracked in an in-memory dictionary; zero persistent database is required.
- **Endpoints:**
  - `POST /api/v1/conversations`: Create conversation.
  - `GET /api/v1/conversations`: List active threads.
  - `GET /api/v1/conversations/{id}`: Retrieve message history.
  - `DELETE /api/v1/conversations/{id}`: Delete conversation and purge thread memory.
  - `POST /api/v1/chat` and `POST /api/v1/conversations/{id}/messages`: Support Server-Sent Events (SSE) streaming and direct non-streaming JSON responses.
- **Execution graph:** Guardrails → Planner (route to retriever vs responder) → Retriever (queries Qdrant `xbrl_agent` + FlashRank TinyBERT reranker) → Responder (Groq LLM).

## Observability & Structured Logging
Informal debugging prints and emoji logging have been eliminated in favor of structured Logfire instrumentation:
- Execution paths are traced via spans: `API → Service → Pipeline → Retrieval → Reranker → Response`.
- All node events and parameters are logged with sanitized attributes (converting numpy types to native Python floats/ints).

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
  electron/main/
    index.ts          composition root: builds adapters, injects them into services, wires events + IPC
    services/         Electron-free use cases (ProjectService, SettingsService, AutosaveScheduler)
      ports.ts        the interfaces services depend on (AuthorityProvider, repositories, SecretStore, Clock)
      errors.ts       typed errors (ValidationError, NoSavePathError, …)
    infra/            adapters implementing ports (AppDatabase on node:sqlite, SafeStorageSecretStore,
                      DirAutosaveStore, FileAuthorityProvider)
    project/          .axbrl format (axbrl.ts, pure) + ProjectController (dialogs, "save changes?")
    ipc/              thin handlers: handleResult()/handleQuery() + register.ts
    util/             pure helpers (launch args, .env, window title)
    sidecar.ts, sidecar-utils.ts, menu.ts
  electron/preload/   index.ts (exposes window.xap), api.d.ts
  src/
    app/              App.tsx, layout (ActivityBar, Panels, StatusBar)
    features/         welcome/, excel/, xbrl-form/, xml/, preview/, problems/, ai/, taxonomy/, settings/
    components/ui/    shadcn-style primitives
    stores/           zustand stores (project, ui, sidecar)
    lib/              utils
engine/
  src/                library modules (see 04-xbrl-engine.md)
  compiler/           test-side Arelle XSD check only; taxonomy and business rules are built in Python (ADR-0010, ADR-0011)
  authority/          compiled rules JSON (+ assembled authority for tests)
  test/
```

## Tech stack (versions pinned 2026-11-10)
- **Desktop and UI:** Electron 45.2, electron-vite 6.0, Vite 8.3, React 19.3, TypeScript 7.0, Tailwind 4.3, Zustand 5.1, react-resizable-panels 4.21, lucide-react.
- **Editors and grids:** Monaco 0.57 (+ @monaco-editor/react 4.7), Univer presets 1.4.
- **Files and storage:** exceljs 4.4, jszip 3.10, better-sqlite3 13.
- **Tests and packaging:** Vitest 5.1, electron-builder 26.18.
- **Python sidecar:** Python 3.12 (uv), FastAPI, uvicorn, langchain-chroma, sentence-transformers (→ ONNX later), Groq through its OpenAI-compatible endpoint, PyInstaller.
- **Package manager:** **pnpm** workspaces (`engine`, `ui`).
