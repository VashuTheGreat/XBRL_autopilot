# 17. Team direction (Vashu's calls)

> **Priority rule:** Vansh Sharma (Vashu, GitHub `VashuTheGreat`, remote `upstream`) sets the product and pipeline direction. Where this doc disagrees with [docs/16](16-target-architecture.md), [ADR-0016](decisions/ADR-0016-canonical-financial-package.md) or an older doc, **this doc wins**.
> It is a living log: add a dated entry whenever Vashu decides something. Newest first in the log; the "Current direction" section always shows the latest state.

## Current direction

### 1. Getting the client's Excel in (decided 2026-11-20)
There are three ways in, in this order:

| # | Path | What it means |
|---|---|---|
| 1 | **Our standard template** | We publish a downloadable template (the canonical sheets). The CA converts their own workbook into it, by hand or with any AI tool, and uploads it. It can be read exactly, without guessing. |
| 2 | **Heuristic transformation** | `POST /api/v1/indas/transform` → `src/transformation/indas.py` turns a raw client workbook into `CANONICAL_MASTER_<name>.xlsx` (BS, PL, CF, SOCIE, PPE schedule, financial notes). Heuristics for now. Vashu adds AI at individual decision points after studying 3–4 more workbooks. |
| 3 | **Template becomes the standard** | Long term, CAs prepare reports directly in our template, so path 2 is needed less. |

Canonical sheet columns are listed in [universal_parser.md](universal_parser.md) §5.

### 2. Sidecar routes (Vashu's `main`, PR #14, 2026-11-20)
All under `/api/v1/indas/`:

| Route | Does |
|---|---|
| `POST /transform` | Excel upload → canonical master workbook. Returns a download URL. |
| `POST /recommend/` | Tag suggestions for row keys (Qdrant dense + BM25, reranked). |
| `POST /generateXML` | Validates against `ind_as_knowledge_base.json` and writes the AOC-4 XML (contract: [doc 16-validation](16-validation-and-xml-generation-api-contract.md)). |
| `GET /download/{id}/{file}` | Serves generated files. They are deleted after `DELETE_FILE_AFTER` (15 min). |
| `GET /authority` | Ind AS knowledge-base JSON. |

### 3. What changes against our earlier plan
- **XML is generated in Python** (`src/pipeline/xml_generation_pipeline.py`), not only in the TS `engine/`. This overrides ADR-0016 decision 5 and the "no `/instances/generate`" line in docs/16.
- **The six canonical sheets are the pipeline stage** (not only an export view as in ADR-0016 decision 6).
- **Removed on Vashu's `main`:** `/taxonomies` and `/mapping` routes, the engine authority / engine rules builders and their `knowledge_base/*_engine_*.json` outputs, the Dixon and Rebel instances. The old UI and engine tests that use them will break; that is accepted during the rework (see CLAUDE.md → Branching).
- **Client workbooks in `notebooks/`** are accepted by the team; don't flag them.

### 4. Open items
- [ ] **Groq model switch on rate limit** — Sarthak asked to switch to another model mid-run on a 429. Vashu said done (2026-11-20), but it isn't in the pushed code: `src/services/llm_provider/groq.py` still uses one model. Confirm with Vashu or implement.
- [ ] **Template download** (path 1) — the template file and a route or UI button to download it.
- [ ] **AI at decision points in `indas.py`** (path 2) — Vashu's, after he reviews more workbooks.
- [ ] **UI wiring** to the `/indas/*` routes (the UI still calls the removed `/taxonomies` and `/mapping`).

## Log
- **2026-11-21** — Merged Vashu's `main` into branch `integrate/vashu-main` (`main` untouched). Sarthak: Vashu's calls take priority; record them here.
- **2026-11-20** — Vashu (chat): input via (1) our standard template, (2) heuristic transformation, (3) the template becoming the CA standard; heuristics for now, AI added at decision points over time. Says the rate-limit model switch is done. PR #14 (`client-server`) merged into his `main`: transform, recommend, generateXML, download routes.
