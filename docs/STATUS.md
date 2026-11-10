# STATUS

> Update this file at the end of every work session: move items between sections and add a dated log line.

## Phase overview
Re-planned on 2026-11-10 from the real client data ([12-reference-data](12-reference-data.md), [ADR-0007](decisions/ADR-0007-real-data-both-taxonomies.md)).

| # | Phase | State |
|---|---|---|
| 0 | Docs + `CLAUDE.md` + repo hygiene | ✅ done |
| 1 | Scaffold: pnpm workspace, Electron + React + Tailwind shell, sidecar manager + `/health` | ✅ done |
| 2 | Engine port (`lagacy_js` → `engine/`) + C&I 2016 authority from `data/` | ✅ step 1 done · step 2 (JS→TS by module) runs alongside the later phases |
| 3 | `.axbrl` project file, autosave/recovery, recents, New Filing wizard, settings | ✅ done |
| 4 | **Editor**: Univer grid + tag overlay, inspector, XBRL Form, Monaco XML, taxonomy browser, two-way linkage. Remaining: green E2E with real clicks, float-noise rounding, a "column not in this filing" message, remembering column → period per sheet | 🟡 in progress |
| 5 | **Real-data readiness**: `.xls` import (python-calamine via the sidecar), HPL (C&I) hand-tagged end to end into valid XML, fixes from that run | ⏭ next |
| 6 | **Ind AS 2017 + engine data via routes** (ADR-0008): browsing already works for all 3 taxonomies through the routes. Move the **dimensional model** (tables, hypercubes, axis defaults, ELR applicability) into `knowledge_base` (Python ingestion) and add a route serving it; the engine loads its authority **from that route** for C&I and Ind AS, and the TS compiler is retired. Golden check: the route-built C&I authority gives identical XML to today's. Also the taxonomy choice in the wizard | ⏳ |
| 7 | **Import an existing XBRL instance** (Webtel / any vendor) into a project; golden test: Dixon instance → regenerate → semantically equal 2,666 facts; diff report against Webtel conventions; previous-year carry-forward from last year's XML | ⏳ |
| 8 | **AI auto-tagging** (`/mapping/suggest`: memory → exact → hybrid retrieval → Groq rerank) plus an **evaluation harness** on the DGPL ↔ Dixon answer key (precision/recall on every change); sidecar `Authority` bug fixes; ONNX embeddings | ⏳ |
| 9 | **Validation UI**: the executable rule ASTs move into `knowledge_base` and are served by a route (the rule text already is); live gate/rules/calculation per taxonomy, Problems panel with locate, quick fixes, MCA Validation Tool v5.1 launcher + error import, rule-coverage report | ⏳ |
| 10 | **AI fix agent** (`/fix/propose`, patch review, audit log) | ⏳ |
| 11 | **Packaging**: PyInstaller sidecar + electron-builder NSIS, `.axbrl` association | ⏳ |
| 12 | Costing CRA-4, masters prefill, trial-balance mapping, Groq proxy, auto-update | ⏳ |

## Known issues / debt
- `src/services/retrieval/hybrid.py` and `reranking.py` are empty.
- `pyproject.toml` `[project.scripts]` points at modules that don't exist; `huggingface` is a stray dependency.
- The `lagacy_js` compile step expects input file names that differ from `data/` and needs the Annexure txt + filing-manual pdf. Make those optional when porting.
- The Groq dev key was shared in chat. Rotate it before production.
- **Missing legacy evidence:** `golden-DIVERGENCES.json` was reconstructed from the legacy test assertions, and `APPROVED_LIMITATIONS.json` was recreated. The MCA-validated `golden-FILING-A/B_2024-25.xml` instances, the Annexure II text export and the Filing Manual pdf are not in the repo, so ~50 regression tests skip. **Ask the `lagacy_js` author for the originals** (see `docs/04-xbrl-engine.md`).
- **Arelle isn't installed** in the Python environment, so 7 XSD tests skip. Add `arelle-release` to the sidecar deps in Phase 6.
- **`xlsx@0.18.5` (SheetJS, npm)** is the last npm release and has known advisories. It's used only at build time by the authority compiler, on the trusted MCA workbook. Never use it for user files; user Excel goes through exceljs.

## Log
- **2026-11-10:**
  - Research complete: webXBRL, competitors, MCA tool v5.1 internals; legacy JS and Python audits.
  - Plan approved.
  - Phase 0 docs written.
  - Groq models available to the key: `openai/gpt-oss-120b` (default), `openai/gpt-oss-20b`, `qwen/qwen3.8-27b`.
- **2026-11-10, Phase 1 done:**
  - **Workspace:** pnpm workspace (`engine`, `ui`).
  - **`engine/`:** skeleton with shared types, CIN check and Vitest (3 tests).
  - **`ui/`:**
    - electron-vite 6 + React 19 + Tailwind 4 shell: activity bar, side panel, Excel ⟷ XBRL split, bottom panel (Problems / AI Agent / Output with live sidecar log), status bar.
    - Typed preload bridge `window.xap`, sandboxed renderer, application menu with shortcuts.
    - `SidecarManager`: free port, per-launch token, `uv run python -m api` in dev, health wait, restart on crash, kill the process tree on quit.
    - Tests: 9 unit tests (`ui/test/sidecar-utils.test.ts`).
  - **Python:** `/health`, bearer-token middleware (active when `XAP_TOKEN` is set), Groq settings in `AppConfig`, `api/__main__.py` entry point. `make dev` now binds to 127.0.0.1.
  - **Verified:**
    - `pnpm test`, `pnpm typecheck`, `pnpm build`.
    - Built app and `electron-vite dev` launched through CDP: sidecar ready in about 4 s, status bar shows "Groq · openai/gpt-oss-120b", no renderer errors. Sidecar curl: 401 without the token, 200 with it.
  - **Lesson:** `scrollIntoView()` returns a Promise in Electron 45's Chromium. Never write expression-bodied `useEffect`s.
- **2026-11-10, Phase 2 step 1:**
  - **Imported:** `lagacy_js` core → `engine/src/core` (31 modules, unchanged except one JSDoc), compiler → `engine/compiler` (reads `data/` directly, with an explicit SRN validator patch), and the legacy tests → `engine/test/legacy` (82 files, paths rewired).
  - **Authority:** `pnpm --filter @xap/engine compile:authority` builds `ci-2016.authority.json` in about 2.4 s: 962 executable rules, 48 review-only, 153 not applicable, 1 unimplemented.
  - **Tests:** legacy suite 284 tests, 220 pass, 0 fail, 64 skipped. New vitest facade tests: the example filing validates with 0 errors; XML is deterministic, uses the V3 schemaRef and CIN scheme, and has no `precision`; save/load round trip is lossless.
  - **API:** typed public entry point `engine/src/index.ts`.
- **2026-11-10, Phase 3 done:**
  - **Format:** `.axbrl` zip with atomic save, `.bak`, unknown entries preserved, and newer formats opened read-only.
  - **ProjectService (Electron-free):** new, open, save, save as, close, exact dirty tracking, autosave + crash recovery, recent projects.
  - **App database:** SQLite through `node:sqlite` (recents, settings, `mapping_memory` schema ready for Phase 5).
  - **Settings:** the Groq key is stored encrypted with async safeStorage and never sent to the renderer; the sidecar restarts when the key or model changes.
  - **UI:** welcome screen (new, open, recent, recover), New Filing wizard with live CIN and period checks (defaults to FY 2025-26), filing explorer with 47 ELRs, settings panel, toasts, window title and status bar with save state.
  - **Code structure:** applied SOLID: ports/services/infra/ipc layers, composition root, reusable `handleResult` and `unwrap`, UI primitives.
  - **Tests:** ui 34 (axbrl, project service with a lossless save/reopen and byte-identical XML, settings, launch helpers); engine 13 + legacy 284.
  - **E2E (built app, CDP, isolated user data):** wizard → create → explorer/title/status, settings never contain the key, no renderer errors.
- **2026-11-10, re-plan from real data:** the team supplied the Dixon (Ind AS, Webtel v32.7) instance with its `.xls` workbook, plus the HPL (C&I) workbook. v1 now covers both taxonomies (ADR-0007), with XBRL import and an auto-tagging accuracy harness. Files are committed as fixtures (`docs/12-reference-data.md`).
- **2026-11-10, taxonomy data via the FastAPI routes (ADR-0008):**
  - **Python:** fixed `Authority` (all `/{id}/…` routes returned 500) and added `get_concept`, `get_role` and `get_business_rule`; `/rules` no longer returns roles.
  - **New routes:** `/elrs` and `/elrs/{code}/tree`; ranked `?summary=true` search; `?include_rules=true` on concept detail.
  - **Grouping:** ELRs are grouped by title (consistent across C&I, Ind AS and Costing), not by code.
  - **Tests:** added `taxonomy_loader`, so the integrity test runs: 31 pytest pass.
  - **Electron:** a `TaxonomyCatalog` port with a `SidecarTaxonomyCatalog` adapter. The statement list, Form structure and search now come from the routes; the engine supplies only values and table knowledge. Editor tests run against the real sidecar (11 pass).
- **2026-11-10, handover to a new chat:**
  - **Phase 4 remaining:**
    1. Re-run `ui/e2e/phase4-editor.mjs` green with real clicks (the click helper is fixed; see `ui/e2e/README.md`).
    2. Defer `univer.dispose()` to fix the React unmount warning.
    3. Confirm the XML line highlight.
    4. Round Excel float noise to the display precision (e.g. HPL `5443.466337358575` lakhs).
    5. Show "this column isn't part of the filing" for 3rd-year or stale-header columns.
    6. Remember the column → period choice per sheet.
  - **Then Phase 5:** `.xls` import through the sidecar (python-calamine), and hand-tag HPL end to end.
- **2026-11-10, phases adjusted for ADR-0008:** Phase 6 is now "move the dimensional model into `knowledge_base` + a route; the engine loads its authority from routes" (Ind AS browsing already works). In Phase 9 the rule ASTs move into `knowledge_base` too. Phases 4, 5, 7, 8, 10 and 11 are unchanged.
