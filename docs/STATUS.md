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
| 6 | **Ind AS 2017 + engine data via routes** ([ADR-0010](decisions/ADR-0010-engine-authority-from-knowledge-base.md)): the Python ingestion builds the engine authority (DTS, prohibition/override, dimensional model) for C&I and Ind AS, served by `/{id}/authority`; the app assembles it with the compiled rules (`AuthorityService`); the TS DTS compiler is retired. Golden: identical C&I authority and byte-identical XML. Ind AS = union of the `in-ci-ent` + `in-ca-ent` DTS (66 ELRs, every Dixon element resolves). Taxonomy choice in the wizard | ✅ done |
| 7 | **Import an existing XBRL instance** (any vendor) into a project: golden test Dixon → regenerate → all 2,666 facts semantically equal (also after save → reopen); import report with the round-trip proof and Webtel's conventions vs ours; next year's filing started from last year's XML | ✅ done |
| 8 | **AI auto-tagging** (`/mapping/suggest`: layout → memory → exact label → BM25 with heading context, filtered by period type / dimensions / statement → optional Groq rerank) plus an **evaluation harness** on the DGPL ↔ Dixon answer key (precision 0.738, recall 0.793; ≥ 0.9 right 93.6%); suggestions → Accept / Reject / Accept all ≥ 90% in the app; mapping memory. Embeddings (ONNX) deferred | ✅ done |
| 9 | **Validation UI**: ✅ step 1 (rules): the executable rule ASTs are built in Python into `knowledge_base` and served by `/{id}/engine-rules` ([ADR-0011](decisions/ADR-0011-business-rules-from-knowledge-base.md)); C&I deep-equal to the retired TS compiler; **Ind AS formalized** (95.36% executable, Dixon 0 ERRORs); rule-coverage reports. ⏭ step 2 (UI): live gate/rules/calculation per taxonomy, Problems panel with locate, quick fixes, MCA Validation Tool v5.1 launcher + error import | 🟡 |
| 10 | **AI fix agent** (`/fix/propose`, patch review, audit log) | ⏳ |
| 11 | **Packaging**: PyInstaller sidecar + electron-builder NSIS, `.axbrl` association | ⏳ |
| 12 | Costing CRA-4, masters prefill, trial-balance mapping, Groq proxy, auto-update | ⏳ |

## Known issues / debt
- `src/services/retrieval/hybrid.py` and `reranking.py` are still empty: the Phase 8 tagger lives in `src/services/tagging/` and doesn't use embeddings. They become the embedding candidate source once an ONNX model and a prebuilt index exist (docs/06).
- **Auto-tagging gaps (Phase 8):** no dimensional (table) cells; free-worded cash-flow lines are weak; the memory ignores sheet kind; the Groq rerank has never been measured (the evaluation runs with the LLM off, by rule) — measure it on a non-client workbook.
- `pyproject.toml` `[project.scripts]` points at modules that don't exist; `huggingface` is a stray dependency.
- The `lagacy_js` compile step expects input file names that differ from `data/` and needs the Annexure txt + filing-manual pdf. Make those optional when porting.
- The Groq dev key was shared in chat. Rotate it before production.
- **Missing legacy evidence:** `golden-DIVERGENCES.json` was reconstructed from the legacy test assertions, and `APPROVED_LIMITATIONS.json` was recreated. The MCA-validated `golden-FILING-A/B_2024-25.xml` instances, the Annexure II text export and the Filing Manual pdf are not in the repo, so ~50 regression tests skip. **Ask the `lagacy_js` author for the originals** (see `docs/04-xbrl-engine.md`).
- **Arelle isn't installed** in the Python environment, so 7 XSD tests skip. Still open after Phase 6: add `arelle-release` (dev extra) when the XSD check is wired into Phase 9.
- **Ind AS rule gaps (Phase 9):** SR-L4235-1 ("yes is selected in above element": unnamed) and ML-39-b (outstanding balances, ambiguous in the MCA source) stay UNIMPLEMENTED. The Ind AS exempt parent/child member sheets are read, but Ind AS has no generic parent-member rule to consume them (C&I GR-3); confirm with the MCA tool whether it enforces parent members for Ind AS.
- **Rule ids count lines from the sheet's stored range** (SheetJS `!ref`, BIFF DIMENSIONS), not the worksheet row: kept so the C&I ids (`SR-L<line>-n`) stay stable; the coverage report's "Row" uses the same numbering.
- **Hardcoded C&I ELR codes left in the engine** (outside the rules): `carry-forward.js` disclosure tabs [400100]–[400500] and some importer comments. Applicability now finds cash-flow ELRs by title and general information by the rule's `elrCode`; review the rest when Ind AS next-year carry-forward is exercised.
- **Webtel's conventions** are reported by the Phase 7 import (descriptive context ids, `TAB…` fact ids, duplicate contexts). Dixon's amounts are rupees with `decimals="-3"`/`"2"` as filed; imported facts keep their own `decimals`, so the regenerated XML reports them unchanged.
- **E2E can't switch projects:** a dirty project triggers the native "Save changes?" box, which CDP can't click. The statement-list fix for switching taxonomies has no E2E yet.
- **Possible legacy-test flake:** one run of `pnpm test` (while a dev Electron app was also running) failed a `golden-DIVERGENCES.json` assertion; the next three runs passed (220/0). Watch for it.

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
- **2026-11-10, Phase 6 done: engine authority from the knowledge base ([ADR-0010](decisions/ADR-0010-engine-authority-from-knowledge-base.md)):**
  - **Python:** `src/services/engine_authority/` (`dts.py`, `dimensions.py`, `builder.py`, `specs.py`, `collation.py`, `store.py`) ports the TS DTS loader and tables compiler. `make engine-authority` (also part of `make rebuild`) writes `knowledge_base/ci_engine_authority.json` (5.3 MB) and `ind_as_engine_authority.json` (9.7 MB) in about 8 s.
  - **Route:** `GET /api/v1/taxonomies/{id}/authority`, which wraps the file without parsing it. Costing returns 404.
  - **Golden check:**
    - The Python C&I authority equals the TS compiler's in every section, in the same key and array order. `collation.py` mirrors JS `localeCompare`.
    - The rules compiled from it are identical.
    - The example filing's XML is byte-identical, now a fixture: `engine/test/fixtures/ci-2016-example.golden.xml`.
  - **Engine:**
    - `assembleAuthority` / `emptyRuleModel` (`src/core/authority-bundle.js`) refuse rules compiled against another taxonomy build.
    - `compile:authority` is now the rule compiler only (input: the KB authority); `dts.mjs` and `tables.mjs` are deleted.
    - `taxonomy-source.mjs` (Arelle working copy) reads the patches from `meta.validatorPatches`.
    - `SHARE_CAPITAL` includes Ind AS `EquityShareCapital`.
  - **Ind AS:**
    - The entry points `in-ci-ent` and `in-ca-ent` load as one DTS. Without `in-ca-ent`, the 700xxx general-information, auditor, director, signatory, KMP and secretarial ELRs were missing.
    - Result: 66 ELRs, 5,647 concepts and 205 tables, the same set the UI browses. All 627 elements of the Dixon instance resolve.
    - schemaRef: `https://www.mca.gov.in/V3XBRL/2017/07/16/Taxonomy/Ind/in-ci-ent-2017-03-31.xsd`.
  - **Electron:**
    - `AuthorityService` (ports `TaxonomyAuthoritySource`, `RuleBundleSource`; adapters `SidecarAuthoritySource`, `FileRuleBundleSource`) loads each taxonomy once and retries after a failure.
    - `AuthorityProvider.load(taxonomy)`; `NewFilingInput.taxonomy`; `ProjectSummary.taxonomy: TaxonomyId`.
    - Opening a `.axbrl` picks the taxonomy from its manifest.
  - **UI:** the wizard has a C&I 2016 / Ind AS 2017 choice (`FILING_TAXONOMIES`, `isFilingTaxonomy`, `taxonomyLabel` in basics), and the status bar names the filing's taxonomy.
  - **Tests:**
    - pytest 50 (+13: builder freshness and determinism, inventory, KB parity, Ind AS in-ca ELRs, SRN patch, route).
    - engine 23 (+6 golden / Ind AS / mismatch); legacy 220/0 fail.
    - ui 121 (+5 `authority-service.test.ts`, including an Ind AS create → save → reopen → XML).
    - **E2E `ui/e2e/phase6-taxonomy.mjs` green** (7 checks: wizard choice, Ind AS project, status bar, 66 ELRs, Ind AS schemaRef, in-ca fact, no renderer errors).
  - **Next:** Phase 7, XBRL instance import with the Dixon golden (Ind AS), plus Webtel conventions.
- **2026-11-10, knowledge files kept separate (team decision):** `<kb>_knowledge_base.json` (browsing, search, Chroma) and `<kb>_engine_authority.json` (filing) stay two files per taxonomy. The why and the guard test are in [02-architecture](02-architecture.md#knowledge-base-files-two-per-taxonomy-kept-separate-on-purpose) and ADR-0010.
- **2026-11-10, Phase 7 done: import an existing XBRL instance:**
  - **Engine:** `src/instance-import.ts`:
    - `importXbrl` wraps the legacy importer with xmldom. A `ReportingDOMParser` maps `onError` to xmldom's `errorHandler`, because malformed XML used to pass silently.
    - `canonicalFacts`, `compareInstanceFacts` and `verifyRoundTrip` compare facts by meaning: (concept, period, dimensions) → (unit, decimals, value). Ids, order and formatting are ignored.
    - `instanceConventions` summarises the vendor's choices.
    - The importer's messages no longer say "C&I 2016" for every taxonomy.
  - **Dixon golden:**
    - 2,666 of 2,666 facts imported, 28 footnotes, 0 unresolved; the periods and the Indirect cash-flow method are detected.
    - Regenerated: 2,666 of 2,666 facts are equal, decimals included.
    - Webtel's 2 duplicate contexts are merged (346 → 344).
    - Next-year mode: FY 2026-27 with 1,427 previous-year facts.
    - The C&I example filing also round-trips.
  - **Electron:**
    - `InstanceImportService` (Electron-free) picks the taxonomy from the schemaRef (V3, retired V2 or the entry-point file name).
    - It takes the company name from `NameOfCompany` (the legacy importer used the file name) and sets `displayPlaces` per ADR-0009.
    - It proves the round trip, then hands the result to `ProjectService.adoptImported`. `newFiling` and `adoptImported` share `startUnsaved`.
    - `.axbrl` gains `import/<name>.xml` + `.report.json` and `manifest.importedFrom`.
    - IPC `project:import-xbrl`; menu File → Import XBRL Instance…
  - **UI:**
    - Welcome-screen button "Import XBRL…".
    - `ImportXbrlDialog` (mode cards) and `ImportReportDialog` (summary, round trip, notes, their conventions vs ours).
    - New reusable `ChoiceCards` primitive (the wizard's taxonomy cards use it too).
  - **Fix:** the statement list was cached across projects, so switching from a C&I filing to an Ind AS one kept the old list. It is now keyed by project.
  - **Tests:**
    - engine 30 (+7 Dixon golden, conventions, next year, tamper detection, malformed XML, C&I round trip); legacy 220/0 fail.
    - ui 126 (+5 `instance-import-service.test.ts`, incl. save → reopen → still equal); pytest 50.
    - **E2E `ui/e2e/phase7-import.mjs` green** (7 checks; the Form shows Dixon's Total assets 1,904.45 lakhs = filed ₹190,445,000).
  - **Next:** Phase 8, AI auto-tagging with the DGPL ↔ Dixon evaluation harness.
- **2026-11-11, Phase 8 done: AI auto-tagging** ([06](06-ai-auto-tagging.md)):
  - **Sidecar** (`src/services/tagging/`, written from scratch; the old top-1 Chroma `/recommend` is superseded):
    - `layout.py`: sheet kind, CY/PY columns from header dates (stale headers ignored), "As at" / "Year ended", note column, scale, headings with scope rules. Fixed: "TOTAL ASSETS" keeps its own label; the signature block (DIN rows, footing checks) no longer leaks in; sub-headings stop at a sibling, a blank row or their total; "(Unsecured, considered good)" is a qualifier, not a heading.
    - `catalog.py`: the engine authority as the tagger sees it (numeric items reportable without dimensions, a port of `nondimAllowed`; statements by ELR title). `bm25.py`, `candidates.py` (memory → exact label with the current / non-current qualifier from headings → BM25; period-type, data-type and qualifier filters), `rerank.py` (Groq via urllib: labels only, offered candidates only), `suggest.py` (one fact ← one cell, same figure shown twice, opening balances → PY, drop < 0.5).
    - Route `POST /api/v1/mapping/suggest`.
  - **Evaluation** (`src/evaluation/`): answer key from DGPL amounts × 1,00,000 matched to Dixon's non-dimensional INR facts within `decimals`; LLM off. 222 keyed cells: **precision 0.738, recall 0.793**, ≥ 0.9 right 73/78. `tests/test_autotag_eval.py` keeps floors 0.70 / 0.75 / 0.90.
  - **Electron:** `AutoTagService` (Electron-free) behind the `MappingSuggester` port (`SidecarMappingSuggester`) and `MappingMemoryRepository` (`AppDatabase.mapping_memory`). Suggestions are `mapping.json` entries with status `suggested` and no fact (`MappingService.replaceSuggestions`); accept = `MappingService.tag` with origin + confidence; every approved tag teaches the memory; a tagged entry can't change status. IPC `autotag:run|accept|reject|accept-all`.
  - **UI:** "Auto-tag" and "Accept all ≥ 90% (n)" in the Excel pane; the inspector of a suggested cell shows element, confidence, origin, period, other suggestions, Accept / Reject.
  - **Tests:** pytest 70 (+20: layout, candidates, rerank parsing, route, evaluation floors); ui 132 (+6 `auto-tag-service.test.ts` against the real sidecar); legacy 220/0 fail.
  - **E2E `ui/e2e/phase8-autotag.mjs` green** (13 checks on DGPL): 299 suggestions and no fact before accepting; inspector Accept (I24 → Trade receivables, current, 95%, exact) and Reject; Accept all ≥ 90% tags 114; the Form shows Total assets 1,904.45 from I34.
  - **Fixes from the run:** "Accept all" refreshed the renderer once per tag (minutes on 114 tags) → `ProjectHandle.batch()` sends one change notification at the end (the run takes seconds). The tagger broke score ties by Python set order, so a run could give 299 or 300 suggestions → ties are broken by qname (identical output across hash seeds).
  - **Next:** Phase 9, validation UI.
- **2026-11-11, Phase 9 step 1 done: business rules from the knowledge base ([ADR-0011](decisions/ADR-0011-business-rules-from-knowledge-base.md)):**
  - **Python rule builder** `src/services/engine_rules/` (`workbook.py` + `sheet_origin.py`, `resolver.py`, `specific.py`, `specific_fallback.py`, `mandatory_items.py`, `exemptions.py`, `generic.py`, `generic_ind_as.py`, `coverage.py`, `report.py`, `builder.py`, `store.py`; `jsre.py` gives JS regex semantics). `make engine-rules` (also in `make rebuild`) writes `knowledge_base/<kb>_engine_rules.json`, `<kb>_rule_coverage.json` and `docs/generated/rule-coverage-<kb>.md` in about 1 s.
  - **Golden:** the TS compiler's C&I output was frozen first (`tests/fixtures/engine_rules/ci_*.ts-golden.json`); the Python port is deep-equal (rule model, exemptions, applicability, Yes/No dependencies, coverage ledger). The example filing's XML stays byte-identical. Then the TS compiler (`compile.mjs`, `rule-formalizer.mjs`, `rules-source.mjs`) and the `xlsx` dependency were deleted; `engine/scripts/assemble-authority.mjs` only joins the two KB files for tests.
  - **Route** `GET /api/v1/taxonomies/{id}/engine-rules`; the app's `SidecarRuleBundleSource` (404 → no rules) replaces `FileRuleBundleSource`. `sidecarCall` throws `SidecarCallError` with the HTTP status.
  - **Ind AS formalized:** reader for its layout (812 rule rows), wording normalization + further forms in a second pass that only sees clauses the C&I port leaves UNIMPLEMENTED, curated note sums (borrowings, loans/advances/provisions, trade receivables, PPE/IP/intangibles/goodwill/biological assets, other equity, share capital), the 16 generic rules (two new handlers: GR-6 closing = opening + change from sheet "formulas Linkbase", GR-16 first-time-adoption opening balance sheet). **Executable share 95.36%** (1273 / 1335; review-only 60, unimplemented 2); C&I 95.15% (962 / 1011). Share = EXECUTABLE ÷ (all − NOT_APPLICABLE).
  - **Engine runtime made taxonomy-generic:** generic rules are found by handler, not C&I rule number (`applicability.js`, `rules.js`, `fixes.js`, `session.js`); reasons carry the rule's own id; cash-flow ELRs by title; new AST options `exemptConcepts`, prior-year `tables`/`concepts`, `elrCode`, `memberMandatory.members`; curation `softFor` (`concepts` / `scopes` incl. `PYO`) for any rule. Ind AS Yes/No answers don't restrict availability (`yes_no_restricts: False`, Dixon evidence).
  - **Dixon acceptance: 0 ERRORs**; 6 curated exceptions in `curation/ind_as/divergences.json`, each with rule text, Dixon fact and why MCA accepted it, and each still shown as a warning. Fixed the Phase 7 known issue: next year's Ind AS filing now leaves the 207 GR-11 facts (directors'/auditors' report, general information, KMP …) out of the previous year (set aside).
  - **Tests:** pytest 98 (+28 `test_engine_rules.py`: golden, freshness, measure ≥ 95%, readers, curation, route); engine 33 (+3 `ind-as-rules.test.ts`); legacy 219/0 (the compiler-only corpus test moved to pytest); ui 132.
  - **Next:** Phase 9 step 2, the validation UI (ValidationService, Problems panel, locate, quick fixes, MCA tool launcher + error import).

