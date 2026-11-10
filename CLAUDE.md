# CLAUDE.md — XBRL Autopilot

**What we're building:** a standalone Windows desktop app (one installer `.exe`) for chartered accountants who file MCA **AOC-4 XBRL**. It is an AI-powered alternative to Webtel webXBRL:
- Excel financials appear on the left, the XBRL/XML on the right, with the cell↔tag linkage visible both ways.
- AI suggests the tags (auto-tagging).
- A deterministic engine validates the result, and an LLM agent (Groq) proposes fixes for the errors.
- Work is saved to `.axbrl` project files so it can be resumed later.

> **Start here → [`docs/README.md`](docs/README.md)** (doc index + "which doc for which task").
> **Current progress → [`docs/STATUS.md`](docs/STATUS.md).**

## Folder map
| Path | What | Language |
|---|---|---|
| `ui/` | Electron app: `electron/main` (window, IPC, sidecar manager, project I/O), `electron/preload` (typed bridge), `src/` (React renderer) | TS + React 19 + Tailwind 4 |
| `engine/` | `@xap/engine`: the deterministic XBRL core (model, generator, rules, calculation, gate, fixes). Port of `lagacy_js/` | TypeScript |
| `api/`, `src/` | Python sidecar (FastAPI): taxonomy knowledge base, AI auto-tagging, Groq fix agent | Python 3.12 (uv) |
| `knowledge_base/*.json` | Extracted taxonomies + raw MCA business rules (C&I, Ind AS, Costing). Rebuild with `make rebuild` | generated |
| `data/` | Official MCA taxonomies, business-rule workbooks, filing manuals, `sample_financials.xlsx`, MCA Validation Tool v5.1 | source data, read-only |
| `lagacy_js/` | Legacy browser-only C&I tool. **Reference only.** Port from it; don't extend it | JS |
| `docs/` | Living documentation. Keep it current | Markdown |

## Commands
```bash
pnpm install                         # JS deps (pnpm only, never npm/yarn)
pnpm dev                             # Electron app in dev (also starts the Python sidecar via uv)
pnpm test                            # all JS tests (engine + ui)
pnpm --filter @xap/engine compile:authority  # data/ → engine/authority/ci-2016.*.json (run once before engine tests)
pnpm --filter @xap/engine test       # engine tests only (vitest + ported legacy node:test suite)
pnpm typecheck
uv sync                              # Python deps
make dev                             # sidecar alone on :7860
make test                            # pytest
make rebuild                         # regenerate knowledge_base + Chroma index
```

**Gotchas:**
- **`ELECTRON_RUN_AS_NODE`:** when Claude launches Electron from inside VS Code, this variable is inherited and Electron runs as plain Node (`electron.app` is undefined). Launch with `env -u ELECTRON_RUN_AS_NODE pnpm dev`.
- **First sidecar start:** it takes ~60 s while Python compiles bytecode; later starts take ~6 s. The health timeout is 120 s.
- **pnpm build scripts:** pnpm blocks dependency build scripts. Approved: `electron`. Denied: `electron-winstaller` (we use NSIS). See `pnpm-workspace.yaml`.

## Non-negotiables
1. **Secrets:** never commit `.env`, keys or customer data. The Groq key in dev comes from `.env`. In the packaged app it comes from Settings (safeStorage). Never hard-code or bundle a key.
2. **Deterministic core:** XML generation and validation live in `engine/` and are pure and deterministic. **AI only proposes**: suggestions and patch lists that the user accepts. The AI never writes facts directly.
3. **Financial precision:** use the engine's decimal type for money. Never use JS floats for amounts.
4. **Electron security:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. All privileged work goes through typed IPC in `ui/electron/preload`.
5. **Sidecar is stateless:** the project state lives in Electron and `.axbrl`. The sidecar gets compact payloads per request.
6. **Docs discipline:** after finishing a feature, update the matching doc in `docs/` and add a dated line to `docs/STATUS.md`. Record architecture changes as an ADR in `docs/decisions/`.
7. **Clean code, SOLID, reusable:**
   - One responsibility per module.
   - Business logic lives in Electron-free services that depend on small interfaces (repositories, secret store, authority provider), passed in through the constructor. These services are unit-tested without Electron.
   - IPC handlers and React components stay thin: they validate, delegate and render.
   - Shared helpers go in `engine/src/basics.ts` (domain) or `ui/shared/` (app contracts). Never copy-paste.
8. **Taxonomy data comes from the FastAPI routes** (`/api/v1/taxonomies/{id}/…`, `id` = `ci_taxonomy` | `ind_as_taxonomy` | `costing_taxonomy`, see `src/constants.py`), backed by `knowledge_base/*.json`:
   - Everything the UI shows about a taxonomy goes through the `TaxonomyCatalog` port: statement list (`/elrs`), Form structure (`/elrs/{code}/tree`), element search and details.
   - Never hardcode taxonomy data. `lagacy_js/` is reference reading only.
   - The engine authority is used only for what the knowledge base can't do yet (facts, XML generation, validation), see [ADR-0008](docs/decisions/ADR-0008-taxonomy-data-via-routes.md).
9. **Scope:** v1 is C&I 2016 **and** Ind AS 2017 (AOC-4 XBRL). Keep code taxonomy-generic (Costing later). Real client fixtures are in `data/` (see `docs/12-reference-data.md`); never send them to an AI service.
