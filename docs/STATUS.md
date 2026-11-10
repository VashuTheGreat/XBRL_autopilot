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
| 4 | **Editor**: Univer grid + tag overlay, inspector, XBRL Form, Monaco XML, taxonomy browser, two-way linkage, float-noise rounding, column → period per sheet | ✅ done |
| 5 | **Real-data readiness**: `.xls` import (python-calamine via the sidecar), HPL (C&I) hand-tagged end to end (BS + P&L match the filed instance, statements free of their own errors), fixes from that run: share capital exact, range sums, derived totals, mandatory zeros, decimal places editable, huge-sheet cap | ✅ done |
| 6 | **Ind AS 2017 + engine data via routes** (⏭ next) (ADR-0008): browsing already works for all 3 taxonomies through the routes. Move the **dimensional model** (tables, hypercubes, axis defaults, ELR applicability) into `knowledge_base` (Python ingestion) and add a route serving it; the engine loads its authority **from that route** for C&I and Ind AS, and the TS compiler is retired. Golden check: the route-built C&I authority gives identical XML to today's. Also the taxonomy choice in the wizard | ⏳ |
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
- **Possible legacy-test flake:** one run of `pnpm test` (while a dev Electron app was also running) failed a `golden-DIVERGENCES.json` assertion; the next three runs passed (220/0). Watch for it.
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
- **2026-11-10, Phase 4 done:**
  - **Float noise:** `mapping/cell-amount.ts` rounds numeric cells (engine decimals, half away from zero) to the number format's places (`formatPlaces`), else the filing's "decimal places as presented". Tagging uses the engine's strict path and refuses a shown digit the filing can't hold. The New Filing wizard now asks for decimal places (default 0 for Actual, 2 for scaled levels; `maxDisplayPlaces` in `engine/src/basics.ts`).
  - **Column periods:** `inferScope` returns `header` / `layout` / `outside`. A header naming another period is never guessed (HPL's 3rd year, DGPL's stale "30th September, 2019"). `ColumnPeriodService` remembers the user's choice per sheet column in `mapping.json` `columns`; `setScope` on a tag also sets its column. New IPC: `editor.cellInfo`, `editor.setColumnPeriod`. The inspector shows the amount (with a `rounded` badge) and the column period with CY/PY/auto.
  - **Fixes:** Univer creation and disposal are both deferred out of React's commit (no unmount warning; StrictMode's throwaway mount no longer creates a second instance). The Monaco highlight re-runs after mount. The import/sync race no longer duplicates a workbook. The main process creates `userData` before opening SQLite (a fresh profile crashed with "unable to open database file").
  - **Tests:** ui 100 (helpers +24, services +4), engine 16 + legacy 220/0 fail. **E2E `phase4-editor.mjs` green with real clicks**; it now asserts and exits non-zero on failure.
- **2026-11-10, Phase 5 started: `.xls` import:**
  - **Sidecar:** `POST /api/v1/workbooks/read` (`api/v1/routes/workbooks.py`, schema in `api/v1/schemas/workbooks.py`) → `src/services/workbook/reader.py` (python-calamine; pure, stateless). DGPL: 20 visible sheets, 6,657 cells, about 50 ms, 329 KB JSON. Hidden sheets are skipped and names are kept exactly ("IND AS BS "). Calamine exposes no number formats, so `.xls` amounts round to the filing's decimal places.
  - **Electron:** `infra/workbook-parser.ts` dispatches on the file signature (OLE2 → sidecar, ZIP → exceljs); `infra/sidecar-call.ts` unwraps the envelope for both sidecar adapters (the taxonomy catalog now uses it). Sources keep their real extension (`workbook-N.xls`).
  - **Tests:** pytest 34 (+2 route), ui `workbook-parser.test.ts` (+3, real sidecar on DGPL).
  - **Next:** hand-tag HPL (Balance Sheet + P&L) into valid C&I XML and fix what that run shows; a filing-properties panel for decimal places.
- **2026-11-10, Phase 5 done: HPL end to end ([ADR-0009](decisions/ADR-0009-amounts-from-excel.md)):**
  - **Real run:** `ui/test/hpl-real-data.test.ts` imports HPL (8 MB, 17 sheets), tags the Balance Sheet, the P&L and the Note 21 revenue split for 2026 and 2025, and checks the result against the filed instance. All 52 statement figures match (two filer hand-adjustments noted). Share capital is `417830`, `decimals="0"`. The BS (100100) and P&L (100200) have no errors of their own; what remains asks for note tables and note breakdowns (tables come later), plus the general-information pages for the whole filing.
  - **Fixes from the run:**
    - Share capital is filed at its actual value (engine `SHARE_CAPITAL`).
    - One-column ranges are tagged as a sum, by dragging in the grid (`mapping.json` `ref` may be `D22:D23`).
    - Tags recalculate, so empty totals follow their parts (Total fixed assets).
    - New engine `fillMandatoryZeros` and an "Empty mandatory → 0" button in the Form.
    - `statementPlaces` replaces the wizard's display places; `displayPlaces` is now paise. It can be changed in the Filing explorer, which re-pulls the figures (`FilingPropertiesService`, `MappingService.reapply`).
    - Sheets over 60,000 cells keep their first rows (HPL's 1.3 M-cell ledger), with a toast.
    - Invalid dates no longer abort an import.
    - **Grid:** the user's first clicks were not reported, because Univer's selection events start late. The grid now also listens to `CellPointerUp`, and the E2E requires a single click and checks a drag selection.
  - **Tests:** engine 17 (+1), legacy 220/0 fail, ui 116 (+HPL 6, ranges, range cap, sheet cap, decimal places), pytest 37 (+parent watch 3). E2E `phase4-editor.mjs` green with one real click per cell and a real drag.
  - **Known divergence:** "Empty mandatory → 0" also zeroes CSR expenditure, which HPL keeps inside Other expenses. The user reviews the toast list.  - **Black window during E2E (diagnosed):** the renderer was killed out of memory. Force-killing Electron in the test loop had left 11 Python sidecars running (about 1 GB, with 1.7 GB of 16 GB free). Fixes:
    - The sidecar now exits when the app's PID is gone (`src/core/parent_watch.py`, `XAP_PARENT_PID`; pytest +3).
    - Main logs `render-process-gone` and reloads the page.
    - Ranges are never expanded beyond 1,000 cells (`MAX_RANGE_CELLS`), and a block or whole-column selection means its first cell. This guards against a selection like `A1:XFD1048576`.

