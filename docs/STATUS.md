# STATUS

> Update this file at the end of every work session: move items between sections and add a dated log line.

## Phase overview
| # | Phase | State |
|---|---|---|
| 0 | Docs + `CLAUDE.md` + repo hygiene | ✅ done |
| 1 | Scaffold: pnpm workspace, Electron + React + Tailwind shell, sidecar manager + `/health` | ✅ done |
| 2 | Engine port (`lagacy_js` → `engine/` TS) + authority compiler for C&I 2016 | 🟡 step 1 done (core imported and green, compiler on `data/`); step 2 (JS→TS module by module) open |
| 3 | `.axbrl` project file, autosave/recovery, recents, new-filing wizard | ⏳ |
| 4 | Editor: Univer Excel pane, XBRL Form, Monaco XML, linkage, Inspector, Taxonomy browser | ⏳ |
| 5 | AI auto-tagging (`/mapping/suggest`), sidecar bug fixes, ONNX embeddings | ⏳ |
| 6 | Validation UI, quick fixes, MCA tool launcher + error import, rule-coverage diff | ⏳ |
| 7 | AI fix agent (`/fix/propose`) + patch review | ⏳ |
| 8 | Packaging: PyInstaller sidecar + electron-builder NSIS | ⏳ |
| 9 | Ind AS 2017, Costing CRA-4, masters prefill, Groq proxy, auto-update | ⏳ |

## Known issues / debt
- **Python `Authority`:**
  - `__init__` reads `self.SUPPORTED_TAXONOMIES`, but that name is defined at module level, so every `/api/v1/taxonomies/{id}/…` route returns 500.
  - `get_concept`, `get_role` and `get_business_rule` are missing.
  - `/rules` returns roles.
- `tests/test_taxonomy_integrity.py` imports `src.core.taxonomy_loader`, which doesn't exist.
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
