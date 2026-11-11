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
`origin`: `memory` | `exact` | `lexical` | `ai`. Dimensional (table) cells are not suggested yet; tables arrive in Phase 11 ([ADR-0013](decisions/ADR-0013-table-tagging.md)).

## In the app (Electron)
- **`AutoTagService`** (Electron-free, `ui/electron/main/services/auto-tag-service.ts`):
  - **Dependencies:** the `MappingSuggester` port (adapter `SidecarMappingSuggester`) and the `MappingMemoryRepository` port (`AppDatabase`, table `mapping_memory`).
  - **Request:** sends each workbook's cell values (no formulas, formats or file name), the period ends, the rounding level and the memory. `useLlm` = the user's AI consent (Settings).
- **Suggestions are mapping entries** with status `suggested` (`MappingService.replaceSuggestions`):
  - They carry `origin`, `confidence`, `rationale` and `alternatives`, and **no fact**.
  - A run replaces the previous run's suggestions.
  - A run skips cells and facts already tagged, and (cell, element) pairs the user rejected.
- **Accept** = `MappingService.tag(…, provenance)`: the engine checks everything a manual tag gets checked for, and the entry keeps its origin and confidence. Picking an alternative is a manual choice. **Reject** sets status `rejected`. **Accept all ≥ 90%** accepts each in turn inside `ProjectHandle.batch()` (one view refresh at the end); a suggestion the engine refuses stays suggested and is reported.
- **Table and "also" suggestions (Phase 11 step 3b):**
  - The sidecar's `blocks` are kept by `TableSuggestionService` (Electron-free) in `mapping.json` `blockSuggestions` (status `suggested` / `rejected`). A run replaces the open ones. A rejected block (same range, same table) isn't suggested again, and neither is a range that already holds a table block.
  - **Accept** applies the block through `TableMappingService.apply` with origin `table` and the block's confidence. The engine re-plans every cell, and a cell it refuses stays untagged and is reported. **Review…** opens "Map as table" prefilled; **Map cells** then accepts it as edited (origin `manual`). If no cell can be tagged, nothing changes and the reasons are given (e.g. the changes-in-equity table stays closed until the balance sheet's Other equity is entered, SR-L694-1).
  - The planner refuses a block cell with no member at all (`NO_MEMBER`): that's the statement figure, e.g. a Total column's net row.
  - A statement suggestion's `also` items become the entry's `alsoSuggested`. They are kept when the suggestion is accepted and move with a change of year. Each is accepted (`MappingService.acceptAlso` → `addAlso`) or rejected one by one. **"Accept all ≥ 90%"** takes cell suggestions and blocks at or above the bar, **never** the "also" items.
- **Deterministic:** the same workbook, memory and taxonomy give the same suggestions (ties are broken by qname), as long as the LLM is off.
- **UI:**
  - "Auto-tag" in the Excel pane toolbar; amber cells = suggestions, red = rejected.
  - The inspector of a suggested cell shows the element, its confidence and origin (with the rationale as a tooltip), the period, "Other suggestions…", Accept and Reject.
  - "Accept all ≥ 90% (n)" in the toolbar.
  - Suggested table blocks have a dashed amber outline; selecting a cell inside one shows the block bar (table, confidence, range, cells; Accept / Review… / Reject).
  - A suggested "also" fact is an amber dashed chip, "also: Equity shares 1 (suggested)", with ✓ / ✗ once the cell is tagged.

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
- **What it means** ([ADR-0013](decisions/ADR-0013-table-tagging.md)):
  - **Zeros:** 1,623 of the 2,186 amounts are 0, and the mandatory rules need them (removing the zero table facts gives 73 ERRORs). They should come from a rule-driven fill, not from Excel.
  - **Figures reported twice:** 169 of the 288 non-zero table amounts are a statement figure reported again with a member.
  - **General information:** it mostly comes from a filing-details form.

## Table suggestions (Phase 11 step 3a, [ADR-0013](decisions/ADR-0013-table-tagging.md))
`src/services/tagging/table_suggest.py`, called by `suggest()`. `POST /mapping/suggest` returns `blocks` next to `suggestions`. The modules:
- `table_catalog.py`: the taxonomy's tables, and label ↔ member / line-item matching;
- `tables.py`: blocks in a sheet, and the note-table producer;
- `party_tables.py`: the related-party producer;
- `table_also.py`: the figures a table reports twice;
- `table_suggest.py`: runs the producers in turn on every block (the first that recognises it wins), then `add_also`.

A new kind of note table is a new producer `(Block, TableContext) → suggestion | None`, not a change to the others.
- **Catalog** (`TableCatalog`, from the engine authority, so any taxonomy works):
  - each table with axes;
  - its numeric line items, in presentation order with their label roles (a port of `buildTableView`);
  - its axes' members, with default / usable.

  The table's **subject words** (shared by 40%+ of its line items, e.g. "property plant equipment") are left out when rows are matched.
- **Blocks** (`find_blocks`):
  - figure rows with 2+ numeric cells, grouped while the columns overlap (gaps of ≤ 3 rows);
  - value columns that hold numbers in at least half the rows;
  - the header is the text up to 8 rows above, stopping at a row with figures in the block's columns. A merged header cell names every column it spans ("Holding Company" over its two year columns), when the merge starts in a figure column (a sheet title merged from the label column does not). The app sends the sheets' merges with `/mapping/suggest`;
  - at least one column must name something other than a year (plain CY / PY notes stay with the statement tagger);
  - heading rows just above belong to the block.
- **Matching** (`match_block`): the best (table, column axis) pair, scored 0.55 × column headers ↔ members of that axis + 0.45 × row labels ↔ line items or members of another axis.
  - A dated balance row counts as matched when the table rolls a balance forward.
  - Two columns of one year can't be the same member.
  - The minimum score is 0.45.
- **Assignment:**
  - **Columns:** each column takes its member; a "Total" column is the class total (no column member).
  - **Group headings:** a heading, or a label containing a member of another axis, sets a group member. "Gross Block …" is the gross carrying amount, and the longest contained member wins. "Net carrying amount" is the default, so it gives no member.
  - **Balance rows:** a balance row's date gives its period role. Year-end dates: 31 March 2024 is the PY opening, 31 March 2025 the PY closing, 31 March 2026 the CY closing. Year-start dates ("1 April 2024") work too.
  - **Movement rows:** each takes the year of the next closing balance below it.
  - **Cells:** a cell with no member at all is left out; that's a statement figure.
  - **Phrases:** "gross block", "net block", "charge for the year" and "profit/(loss) for the year" are mapped to the taxonomy's wording.
- **Step 3b.4 (2026-11-11), measured on Dixon, the HPL key and synthetic tests:**
  - **Column years from the statements' figures** (`Figures`): a column whose non-zero values are 2 or more of one year's balance-sheet, P&L or cash-flow figures (and more than the other year's) is that year, whatever its header says. DGPL's financial-instruments note is headed "As at March 31, 2025" over FY 2026 figures. Only the main statements count as evidence: notes next to a stale one often carry the same stale header.
  - **Sections** (`sections`): a block is split where a heading follows a total row ("Total of financial assets", then "Financial liabilities"). Each part can be another table.
  - **Rows that are members** (`_member_rows`): once a row label names a member of another axis exactly ("Trade receivables"), the block's rows are members. The other rows with figures take the next **numbered placeholder** of the family the column members name ("Other financial assets at amortised cost, class 1 …" under "Amortised cost"), in row order. Rows of zeros take none, and total rows are left to the engine's parent-member roll-ups. The line item is the one the section heading names.
  - **Member matching** ignores the axis's domain words ("financial assets"). A header that contains all of a member's own words (2+) names it. "FVTPL" / "FVTOCI" are expanded.
  - **No zeros from Excel:** a column holding only zeros gives no cells (zeros come from the rules).
  - **Guards against false matches:** years side by side must repeat a group of 2+ different members ("<12 months" and ">12 months" are not both the 12-month expected credit losses). The minimum table score is now 0.6 (every DGPL block under it was noise; real ones score 0.76+).
  - **"Also" vs blocks:** an "also" item into a table that a suggested block maps is dropped. The block reports that table, and the roll-ups would count the figure twice (profit under Retained earnings and under "Other equity other 1").
  - **Evaluation:** numbered members are placeholders (MCA accepts any numbering), so both scoreboards compare ours with the filer's by value within the same family, element, period and other members (`align_placeholders`; `fact-scoreboard.ts`).
- **Step 3c (2026-11-11): related parties, and one cell → more facts**, measured on Dixon, the HPL key and synthetic tests:
  - **Related parties** (`party_tables.py`). The note is recognised by its shape: a transaction row whose figures are the sum of the contiguous rows right below it (its parties).
    - The table is one with a typed axis (the party) whose other axis's members name the columns. "Holding Company" is read as Parent, "KMP" / "Key management person" as key management personnel.
    - A transaction's label names the line item: "Purchase including taxes" → purchases of goods ("including / inclusive of taxes" is dropped). Under an "outstanding balances" heading, only the instant items count, and one shared word is enough when no other item scores the same ("Trade receivables" → amounts receivable).
    - Each party is numbered 1, 2 … on the typed axis in order of first appearance with a figure ("Dr. Manuji Zarabi" = "Mr. Manuji Zarabi"). It reports only under its own category's columns and only its non-zero figures (`row.cols`). The transaction's own row is a total and files nothing.
    - Not matched (filer's choice in Dixon): interest received → other income, sitting fees → other expense, consultancy → services received. The parties' names, countries and nature (ML-39) are text: step 5.
  - **Fair-value twins** (`table_also.py`, `row.also`): when every column the block maps says "Fair value …" (DGPL: "Fair Value at Amortised Cost") and none says "carrying", a row whose line item has a twin "<label>, at fair value" also reports it. A plain "Amortised cost" column is a carrying amount and gets none.
  - **Sole-member totals** (`col.alsoTotal`): when the columns repeat an axis's members (FVTPL, FVOCI, amortised cost under each year) and only one of a group has figures, that column is also the axis total (its default). Dixon files every class with and without the category.
  - Each cell lists its extra facts (`cells[].also`); the app re-plans them with the engine (docs/04).
  - **Not done, filer conventions:** Dixon files every PPE class again under "Owned assets" (no rule asks for it; DGPL doesn't say), and DGPL's "Fan, cooler & air conditioner" under *Other plant and equipment*. Neither is suggested.
- **Sub-classification "also"** (`subclass_also.py`, step 3d, 2026-11-11): a sure statement tag (≥ 0.9) is also filed in the table that sub-classifies it, as suggested "also" facts (0.7, never accepted in bulk):
  - **table and member** from labels: the statement element's label is a line item's label plus one member's ("Loans, current" = "Loans" + "Current"), in exactly one table;
  - **more members** from the note (`NoteEvidence`): a line of the note that shows the same figure, and whose heading names the line item ("NOTE 12 : LOANS"), names a member of another axis exactly ("(Unsecured, considered good)"). The financial-instruments note that lists the figure among others is not evidence;
  - **gross**: the table's "<label>, gross" item too, unless the note shows a non-zero allowance or impairment line.
  - Dixon: trade receivables 8 / 8, loans 8 / 16. Dixon also files the loan under *Loans given to other related parties* ("Loans given to holding company"), which no label names.
- **One class** (`one_class_also`): a statement suggestion of 0.9 or more whose element is a line item of a table with exactly one numbered "classes" axis (Equity shares 1), all other axes defaultable, gets `also: [{concept, tableId, dims, preferredLabel, confidence 0.7}]`.
- **Scoreboard** (2026-11-11, `coverage_eval`, per producer):

  | producer | right | near | wrong | extra |
  |---|---|---|---|---|
  | statement | 143 | 4 | 39 | 113 |
  | table | 117 (75 in 3b.4, 63 in 3a) | 0 | 0 | 7 |
  | also | 18 (2 in 3c) | 0 | 0 | 4 |

  - The table producer finds PPE (DGPL sheet FA), changes in equity, financial assets by category (with fair values and category totals: 48 of 52 non-zero) and related parties (6 of 14).
  - Ungated, the one-class producer gave 4 right / 6 wrong / 15 extra, which is why it now rides only on sure tags.
- **C&I hand-checked key** (`src/evaluation/table_key_eval.py`, `tests/fixtures/hpl_table_key.json`, from Helmier's PDF): 13 / 13 right, 0 wrong.
  - The filer put the workbook's "Computers" under *Plant and equipment*. Those 8 facts are listed apart (filer's choice).
- **Tests:** `tests/test_table_suggestions.py` covers synthetic roll-forwards on Ind AS and C&I, changes in equity, the plain-note exclusion, financial assets by category (category totals; fair-value twins only under "Fair value" headers), a related-party matrix with merged headers, the Dixon floors (table right ≥ 117, wrong ≤ 10%; also wrong 0) and the HPL key (13 / 13).

## Engine-side scoreboard (Phase 11 step 3b, [ADR-0013](decisions/ADR-0013-table-tagging.md))
`ui/test/scoreboard-dgpl.test.ts` runs the **real app pipeline** on DGPL: the real sidecar, LLM off, Electron-free services. The steps are:
1. auto-tag;
2. accept every suggestion: cells and blocks (`acceptAll(0)`), then every "also" fact;
3. parent-member roll-ups (automatic);
4. table zeros and statement zeros for every ELR, twice.

The filing it gives is compared with Dixon by (element, period, members) (`test/helpers/fact-scoreboard.ts`, pure). Verdicts use the filed `decimals`, as `coverage_eval`, and each fact is scored by origin: **excel** (a mapping's main or "also" fact), **derived** (calculated: totals, roll-ups, carrying amounts) or **zero** (added by the rule-driven fills). It takes about 11 s. Floors are in the test; raise them when a producer improves.

**2026-11-11, after step 3d** (sub-classification "also"): 22 "also" facts accepted. Filed non-zero table amounts right **131 of 305**: trade receivables 8 / 8, loans 8 / 16; the rule zeros of those tables now land right (zero table right 38, was 12). ERRORs 298.

**After step 3c:** 299 cells and 5 blocks (82 cells) accepted, 4 "also" facts.

| origin | kind | right | near | wrong | extra |
|---|---|---|---|---|---|
| excel | amount | 137 | 4 | 45 | 113 |
| excel | table | 119 | 0 | 0 | 5 |
| derived | amount | 31 | 1 | 23 | 36 |
| derived | table | 92 | 0 | 2 | 12 |
| zero | amount | 92 | 0 | 14 | 0 |
| zero | table | 12 | 0 | 24 | 13 |

- **Filed non-zero table amounts right: 115 of 305** (65 after 3b.4). Per table: financial assets 56 / 56, changes in equity 27 / 36, PPE 24 / 66 (the "Owned assets" duplicates and *Other plant and equipment*, filer conventions), related parties 6 / 14, share classes 2 / 34, loans 0 / 16, EPS 0 / 8 (its statement tag is 0.75, under the 0.9 bar for "also"). The report prints this per table (`groupOf` = the fact's table) and lists every missed filed fact.
- **ERRORs 302** (299 after 3b.4): ML-39 ×3 asks the related parties now reported for their name, country and nature, which are text facts (step 5).

**After step 3b.4:** 299 cells and 4 blocks (76 cells) accepted, 4 "also" facts.

| origin | kind | right | near | wrong | extra |
|---|---|---|---|---|---|
| excel | amount | 137 | 4 | 45 | 113 |
| excel | table | 77 | 0 | 0 | 2 |
| derived | amount | 31 | 1 | 23 | 36 |
| derived | table | 84 | 0 | 2 | 8 |
| zero | amount | 92 | 0 | 14 | 0 |
| zero | table | 10 | 0 | 36 | 16 |

- **Filed non-zero figures right:** amounts 116 of 275; table amounts 65 of 305 (47 before step 3b.4). The filing has 299 ERRORs (309 before).
- **ADR exit targets:** amounts right 168 (target ≥ 160 ✓); wrong 68 (target ≤ 25 ✗); non-zero table amounts right 65 (target ≥ 190 ✗).
- **Zero table wrong (36):** the share-class column, whose counts are in the note's text, and "Financial assets, at fair value". Dixon reports the latter equal to the carrying amount; the ML rule's 0 there is wrong in substance.
- **Found by the pipeline, and fixed:**
  - **Sign from a negated label:** "Total expenses" matched only the negated-total role of Expenses, so it was suggested with `sign: -1` and filed negative. An exact match now takes the cell as shown: a negated role is the taxonomy's display, not the workbook's.
  - **Share capital zeroed by "Table zeros":** the fill wrote 0 into Paid-up value [Equity shares 1] (and its siblings), and the entered share capital "followed its empty note" to 0. Now the fill never zeroes an element a reported, non-zero statement figure is the sum of. A statement figure entered by the user no longer follows an empty note that sums to 0.
- **Full report:** `XAP_SCOREBOARD_OUT=<file>` writes every wrong fact with its cell.
- **Remaining misses:** the filer's lumping (security deposit inside other financial assets), cash-flow lines DGPL shows as deductions (interest income), stale tax splits, and the computed profit lines that follow them.

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
