# 06 · AI auto-tagging (Excel → taxonomy)

**Goal:** for every figure in an imported workbook, propose *which taxonomy fact it is*: element, period (CY/PY), dimensions and sign. Each proposal carries a confidence, a one-line rationale and its runner-up elements. The accountant decides; nothing goes into the filing until a suggestion is accepted. Bulk "Accept all ≥ 90%" is allowed.

**Status:** Phase 8 (2026-11-11). It's a deterministic tagger with an optional LLM rerank. On DGPL ↔ Dixon it scores precision 0.738, recall 0.793, and suggestions at ≥ 0.9 are right 73 of 78 times (see [Evaluation](#evaluation)).

## Design in one paragraph
Retrieval does the tagging; the LLM only arbitrates. The tagger runs locally in the sidecar (`src/services/tagging/`) over the same engine authority the filing uses (`knowledge_base/<kb>_engine_authority.json`, [ADR-0010](decisions/ADR-0010-engine-authority-from-knowledge-base.md)). So every suggestion is an element MappingService can actually tag: reportable, numeric, and allowed without dimensions. The LLM (Groq) is off unless the user has given AI consent and a key is set. Even then it only sees the undecided rows: their label, headings and up to 10 candidate elements, never amounts. The old `GET /taxonomies/recommend` was top-1 embedding search over a Chroma index that was never built, with no filters. This tagger supersedes it. Embeddings can come back later as one more candidate source ([Embeddings](#embeddings--packaging)).

## Pipeline (`POST /api/v1/mapping/suggest`)
```
sheets ─▶ 1 layout ─▶ 2 candidates (memory → exact → BM25) + filters ─▶ 3 optional LLM rerank ─▶ 4 assemble
```
1. **Layout** (`layout.py`, `text.py`). Per sheet:
   - **Sheet kind:** `balance_sheet` / `profit_loss` / `cash_flow` / `equity` / `notes` / `other`, from the sheet name and its top text ("IND AS BS", "Notes of IND AS P&L"). `other` sheets (trial balances, working papers) are skipped and reported.
   - **Period columns:** header cells whose dates are the filing's CY / PY ends ("As at 31st March 2026", "31.03.2026", "March 31, 2026"). A header naming another date (the stale "30th September 2019") is never used. A later header row can move the columns (each note has its own).
   - **Period type of the header:** "As at" means instant, "Year ended" means duration.
   - **Note No. column**, from the header.
   - **Scale:** "(Rs. in Lakh …)" means Lakhs.
   - **Rows:** a row's label is its leftmost text left of the value columns; markers ("IV", "(A+B)") are skipped. Rows without figures are headings: an ALL-CAPS section, a "NOTE 8 : …" title, or a stack of sub-headings. A sub-heading's scope ends at:
     - a row further left;
     - a sibling at its column (another heading, or a line with its own note number);
     - a blank row once it has had lines (unless it carries a note number: "Trade Payables" + its MSME lines);
     - its total.
   - **Totals:** "TOTAL ASSETS" names itself. A bare "Total" (or "Total (unsecured, considered good)") takes the note's title in notes, or the innermost heading in statements. An unlabelled subtotal ("A", "(A+B)") takes its section's name ("Total non-current assets") and needs figures in every period.
   - **Not headings:** parenthetical qualifiers ("(Unsecured, considered good)").
   - **Signature block:** "As per our report…", "DIN-…" end the statement, so footing-check rows below it never become rows.
2. **Candidates** (`candidates.py`) per row, strongest evidence first:
   1. **Mapping memory:** a label the user tagged before → 0.97 (+0.005 per extra approval, max 0.99).
   2. **Exact label:** the row label equals a label role (standard / terse / total / net / period start-end / negated), compared by order-free word set, with a few Schedule III phrase aliases ("Other bank balances" → "Bank balance other than cash and cash equivalents") → 0.95. If the headings give a current / non-current qualifier the label lacks, "label + qualifier" is tried first: "Trade Receivables" under CURRENT ASSETS is *Trade receivables, current*, not the classless element. Generic labels ("Others", "Total") never match exactly. Several elements with the same label → −0.15. An element that isn't on this statement → −0.05.
   3. **Lexical BM25** (`bm25.py`) over every label word of each element. Row words weigh 1.0, heading words 0.35, the qualifier 1.0. The score uses label coverage and the margin over the runner-up, and is capped at 0.85.

   **Filters** (before scoring):
   - **Catalog:** non-abstract numeric items reportable without dimensions (port of the engine's `nondimAllowed`).
   - **Period type:** balance sheet / "As at" → instant only. P&L, cash flow / "Year ended" → duration, except opening / closing lines ("… at the end of the year").
   - **Data type from the label:** EPS → per share; "number of shares" → shares; else monetary.
   - **Qualifier:** under NON-CURRENT, never a *current* element, and vice versa.

   **Boosts:** elements presented on the statement the sheet is get ×1.3 (statements are found by ELR **title**, never by code). In notes, statement and note elements are both boosted.
3. **LLM rerank** (`rerank.py`, Groq, stdlib urllib, no new dependency):
   - **When:** only for rows whose best candidate is lexical and < 0.8, and only with `useLlm` + a key.
   - **Batches:** 30 rows per request, temperature 0, JSON mode.
   - **Constraints:** the model may only pick one of the offered candidates, or none (the row is then left untagged). Its confidence is capped at 0.9, and invented concepts are dropped. Any network error leaves the lexical suggestion in place.
4. **Assemble** (`suggest.py`):
   - CY and PY cells of a row share the element.
   - One fact ← one cell: rows are processed statements first, then notes, figures before zero lines, then by confidence. A row whose element is taken falls back to its next candidate.
   - A row equal in amount (within 0.01) to the row that took the element is the same figure shown twice (a note's total = the statement line) and gets no suggestion.
   - An opening balance in a year column reports the previous year-end instant (its CY cell → PY scope).
   - Suggestions under 0.5 are dropped: on DGPL only 4 of 25 were right. Under 0.6 they are flagged `needsReview`.

## Request / response
```jsonc
// POST /api/v1/mapping/suggest
{
  "taxonomy": "ind_as_taxonomy",                       // ci_taxonomy | ind_as_taxonomy
  "sheets": [{ "name": "IND AS BS ", "cells": [{ "r": 23, "c": 2, "v": "Trade Receivables" }, { "r": 23, "c": 8, "v": 672.3 }] }],
  "periods": { "cyEnd": "2026-03-31", "pyEnd": "2025-03-31" },
  "level": "Lakhs",                                    // the filing's rounding level (echoed back)
  "memory": [{ "label": "trade receivables", "concept": "ind-as:TradeReceivablesCurrent", "approvals": 3 }],
  "options": { "useLlm": false, "maxCandidates": 10 }
}
// → 200 (envelope data)
{
  "layout": [{ "sheet": "IND AS BS ", "kind": "balance_sheet", "scale": "Lakhs",
               "periodColumns": { "CY": "I", "PY": "L" }, "rows": 26, "note": null }],
  "suggestions": [{ "cell": { "sheet": "IND AS BS ", "ref": "I24" }, "label": "Trade Receivables",
                    "context": ["CURRENT ASSETS", "Financial Assets"], "sheetKind": "balance_sheet",
                    "concept": "ind-as:TradeReceivablesCurrent", "conceptLabel": "Trade receivables, current",
                    "scope": "CY", "dims": [], "sign": 1, "confidence": 0.95, "origin": "exact",
                    "rationale": "Same as its standard label with “current” from the heading above; instant; ELR 110000",
                    "needsReview": false,
                    "alternatives": [{ "concept": "ind-as:CurrentTradeReceivables", "label": "Current trade receivables", "score": 0.95 }] }],
  "llmUsed": false,
  "level": "Lakhs"
}
```
`origin`: `memory` | `exact` | `lexical` | `ai`. Dimensional (table) cells are not suggested yet; tables arrive in Phase 11 ([ADR-0013](decisions/ADR-0013-table-tagging.md), proposed).

## In the app (Electron)
- **`AutoTagService`** (Electron-free, `ui/electron/main/services/auto-tag-service.ts`):
  - **Dependencies:** the `MappingSuggester` port (adapter `SidecarMappingSuggester`) and the `MappingMemoryRepository` port (`AppDatabase`, table `mapping_memory`).
  - **Request:** sends each workbook's cell values (no formulas, formats or file name), the period ends, the rounding level and the memory. `useLlm` = the user's AI consent (Settings).
- **Suggestions are mapping entries** with status `suggested` (`MappingService.replaceSuggestions`):
  - They carry `origin`, `confidence`, `rationale` and `alternatives`, and **no fact**.
  - A run replaces the previous run's suggestions.
  - A run skips cells and facts already tagged, and (cell, element) pairs the user rejected.
- **Accept** = `MappingService.tag(…, provenance)`: the engine checks everything a manual tag gets checked for, and the entry keeps its origin and confidence. Picking an alternative is a manual choice. **Reject** sets status `rejected`. **Accept all ≥ 90%** accepts each in turn inside `ProjectHandle.batch()` (one view refresh at the end); a suggestion the engine refuses stays suggested and is reported.
- **Deterministic:** the same workbook, memory and taxonomy give the same suggestions (ties are broken by qname), as long as the LLM is off.
- **UI:**
  - "Auto-tag" in the Excel pane toolbar; amber cells = suggestions, red = rejected.
  - The inspector of a suggested cell shows the element, its confidence and origin (with the rationale as a tooltip), the period, "Other suggestions…", Accept and Reject.
  - "Accept all ≥ 90% (n)" in the toolbar.

## Learning loop (mapping memory)
- **When:** every approved tag, manual or accepted, upserts `mapping_memory(taxonomy_id, norm_label, concept, approvals++)` in app.db (`MappingService.tag`).
- **Scope:** memory is per installation and private. It is sent with each suggest request; the sidecar stays stateless and normalises the labels itself.
- **Not used yet:** `sheet_kind`, `period_hint` and `dims_json` stay at their defaults.

## Evaluation
- **Harness:** `src/evaluation/autotag_eval.py` (CLI: `uv run python -m src.evaluation.autotag_eval`) with `tests/test_autotag_eval.py` (floors). It runs with the LLM off: `data/` fixtures never go to an AI service.
- **Answer key, built from amounts, not by hand:**
  - Every DGPL value cell (CY or PY) is multiplied by the sheet scale (lakhs × 1,00,000).
  - It is matched to Dixon's non-dimensional INR facts of that period within the fact's `decimals` tolerance (decimals=-3 → ±500).
  - Any concept with the same amount counts as right.
  - Zero cells and cells under ₹1,000 are excluded (at decimals=-3 they match anything rounded to 0).
- **Precision** = suggestions on keyed cells whose element is in the key ÷ suggestions on keyed cells.
- **Recall** = keyed cells whose right element is suggested ÷ keyed cells. A cell also counts when the element is suggested on another cell with the same figure (one fact ← one cell).
- **2026-11-11:** 222 keyed cells; **precision 0.738, recall 0.793**; confidence ≥ 0.9: 73/78 right (0.936).
- **Floors in the test:** 0.70 / 0.75 / 0.90. Raise them when the tagger improves.
- **Typical misses** (the report lists them all):
  - The filer's lumping: Security deposit filed inside *Other non-current financial assets*.
  - Cash-flow lines with free wording ("Margin Money", "Interest on Fixed Deposit/others").
  - Revenue-disaggregation rows that Dixon files on in-ca elements.
  - Coincidental amount matches in the key itself (a sensitivity row equal to bank charges).

## End-to-end coverage (every filed fact)
The keyed-cell evaluation above only scores statement-level amounts. `src/evaluation/coverage_eval.py` scores **every fact** of the filed instance. CLI: `uv run python -m src.evaluation.coverage_eval [--tables]`; floors in `tests/test_coverage_eval.py`; LLM off.
- **Kinds** (`fact_kinds.py`, from the engine authority, so they work for any taxonomy):
  - `amount`: no dimensions;
  - `table_amount`: with dimensions;
  - `value`: text / date / Yes-No / code;
  - `table_value`;
  - `text_block`.

  Each is split into sections `statements` / `notes` / `general` by **ELR title** (`classify_elr`, as the catalog routes), never by code: general information is [400100] in C&I and [700300] in Ind AS.
- **In the workbook?** (`workbook_index.py`) A fact is located **by value only**:
  - **Amounts:** a cell × the sheet scale, within the fact's `decimals`.
  - **Text:** equal, or (12+ characters) part of a cell.
  - **Text blocks:** half covered by 30+-character cells.
  - **Dates:** a date cell, or a date written in text.
  - **Not locatable by value:** zero, nil and Yes/No facts (`not_by_value`).
  - **Sheet type:** statements and notes count as presentation; trial balances and rupee groupings are working papers, reported apart.
- **Produced / right:** producers turn our output into facts (concept, period end, dimensions, value). Today the only producer is `produced_from_suggestions`, which takes the statement tagger's suggestions, filed as the app would (ADR-0009: rounded once to the statement's places × scale). The verdicts are:
  - *right*: within the fact's `decimals`;
  - *near*: one unit in the last place, i.e. another rounding or a filer's adjustment;
  - *wrong*;
  - *extra*: a produced fact Dixon didn't file.
- **2026-11-11, DGPL → Dixon (2,666 facts):**

  | kind | facts | zero | in a presentation sheet | working paper only | absent | not by value | produced | right | near | wrong |
  |---|---|---|---|---|---|---|---|---|---|---|
  | amount | 638 | 363 | 244 | 2 | 29 | 363 | 186 | 143 | 4 | 39 |
  | table_amount | 1,548 | 1,260 | 270 | 1 | 17 | 1,260 | 0 | 0 | 0 | 0 |
  | value | 159 | 0 | 22 | 1 | 21 | 115 | 0 | 0 | 0 | 0 |
  | table_value | 268 | 0 | 112 | 5 | 133 | 18 | 0 | 0 | 0 | 0 |
  | text_block | 53 | 0 | 10 | 0 | 43 | 0 | 0 | 0 | 0 | 0 |

  There are 113 extra (all amounts), and 31 of the 153 general-section facts are in the workbook.
- **What it means** ([ADR-0013](decisions/ADR-0013-table-tagging.md), proposed):
  - **Zeros:** 1,623 of the 2,186 amounts are 0, and the mandatory rules need them (removing the zero table facts gives 73 ERRORs). They should come from a rule-driven fill, not from Excel.
  - **Figures reported twice:** 169 of the 288 non-zero table amounts are a statement figure reported again with a member.
  - **General information:** it mostly comes from a filing-details form.

## Tagging-quality review (later)
After mapping, an optional AI pass flags suspicious tags the MCA validator can't see:
- lumping into residual "Other…" tags;
- sign / balance contradictions (DTA vs DTL);
- a note line tagged to a statement-level concept;
- untagged material rows.

The output is INFO / WARNING issues with suggested remaps.

## Embeddings & packaging
- **Current:** the Chroma / sentence-transformers code (`src/services/embeddings`, `vectordb`) is unused by the tagger; its index was never built, and torch adds ~1 GB to a PyInstaller bundle.
- **Plan:** switch to an ONNX runtime (fastembed / onnxruntime, a small model such as bge-small) with a **prebuilt index** in resources. Then add it as a candidate source next to BM25 (`src/services/retrieval/hybrid.py`) for synonym-heavy rows.

## Groq
- **Endpoint:** OpenAI-compatible `https://api.groq.com/openai/v1/chat/completions`.
- **Model:** default **`openai/gpt-oss-120b`**; cheaper fallback `openai/gpt-oss-20b`. Configurable via `GROQ_MODEL` / Settings.
- **Data minimisation:** labels, headings, sheet kind and candidate elements (qname, label, period type, balance). Never amounts, company name, CIN or sheet names.
