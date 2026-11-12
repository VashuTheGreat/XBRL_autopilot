# ADR-0013 · Complete end-to-end tagging: table blocks, figures reported twice, rule-driven zeros, filing details
- **Status:** accepted (2026-11-11), with the team's additions (marked *team*). Phase 11 (packaging follows as 11b; Costing stays Phase 12).
- **Context:** measured on all 2,666 facts of Dixon's MCA-accepted instance against the DGPL workbook
  (`src/evaluation/coverage_eval.py`, floors in `tests/test_coverage_eval.py`, LLM off):

  | kind | facts | zero | value in a statement / note sheet | only in a working paper | not in the workbook | produced today (right / near / wrong) |
  |---|---|---|---|---|---|---|
  | amount (no dimensions) | 638 | 363 | 244 | 2 | 29 | 186 (143 / 4 / 39) |
  | table amount | 1,548 | 1,260 | 270 | 1 | 17 | 0 |
  | text / date / Yes-No | 159 | – | 22 (115 are Yes/No) | 1 | 21 | 0 |
  | table text (directors, KMP, parties …) | 268 | – | 112 | 5 | 133 | 0 |
  | text block | 53 | – | 10 | 0 | 43 | 0 |

  Four findings decide the design:
  1. **Zeros are required by the rules, not padding.** 1,623 of 2,186 amounts are 0 (1,024 of the PPE table's 1,090). Removing Dixon's 1,260 zero table facts gives 73 ERRORs (ML-13 PPE ×44, ML-6, ML-22, ML-21 …); removing all 1,623 gives 233 (the SR mandatory items too). A zero can't be found in Excel by value, and Webtel writes them for every applicable slice.
  2. **Most non-zero table amounts are a figure the workbook already shows elsewhere:** 169 of 288 equal a non-dimensional fact of the same period (changes in equity 36/36, share classes 32/34, financial assets by category 44/56, loans 16/16, EPS 8/8). In those cases one Excel cell is reported as two facts: a statement line, and the same figure with a member.
  3. **Real note tables have their period and members in the rows as well as the columns.** In the DGPL PPE schedule (sheet FA), the columns are asset classes. The rows hold three things:
     - the carrying-amount group (Gross block / Accumulated depreciation / Net);
     - the movement (Additions, Disposals);
     - the period, from the row label: "Balance as at 31 March 2024" is the previous year's opening balance.
  4. **General information is mostly not in the workbook:** 31 of the 153 facts in the general / auditors' / directors' report / signatories ELRs are found. Of the text facts, 115 are Yes/No questions, not cells.

  Also found: the engine authority's ELR `group` is computed from the C&I code ranges (`_elr_group` in `src/services/engine_authority/builder.py`). For Ind AS it puts only the balance sheet in Statements, the P&L and cash flow in Notes, and the 400xxx notes in Disclosures. So `derived.js` (note → statement figures), `session.statementFigure` and `carry-forward.js` misread Ind AS. Table tagging depends on note → statement derivation.
- **Decision:**
  1. **ELR groups by title** in the engine authority (`classify_elr`, the same as the catalog routes, ADR-0008). C&I must stay identical (golden XML, HPL). Ind AS is re-checked on Dixon (0 ERRORs) and Rebel (7 known).
  2. **The mapping model gets dimensions and table blocks** (`mapping.json`, docs/03):
     - A cell entry's `fact.dims` may be non-empty. `MappingService.tag` writes through `Session.setTableValue`, so the engine checks the slice, dimensional validity and applicability as it does today for plain facts.
     - A **block** entry maps a rectangular range to one taxonomy table:
       `{ kind: 'block', tableId, cell: {sheet, ref: 'B10:G32'}, rows: [{ r, concept, preferredLabel?, scope?, members? }], cols: [{ c, members?, scope? }] }`.
       Each non-empty cell in it is one fact:
       - the concept and preferred label come from the row (an opening balance is the periodStartLabel row);
       - the dimensions are the row members ∪ the column members (explicit or typed);
       - the period comes from the row, else the column, else the column's period.

       A blank cell gives no fact; a 0 gives 0. *2026-11-11 (step 3c):* a row may be limited to some columns (`cols`: a related party under its own category), and one cell may file more facts of the same figure: `row.also` (other line items: a fair value equal to the carrying amount) and `col.alsoTotal` (the axis total when the column's member is the only one with figures). The expansion is a pure engine function (`engine/src/table-mapping.ts`): block + authority → planned facts with their cells, and per-cell problems. That way the UI preview, the apply step and the evaluation share it.
     - **One fact ← one cell stays; one cell → one fact is relaxed** to one main fact plus "also reported as" facts of the same figure (finding 2). *Team:*
       - the extra facts follow their cell on every value change: an edit, a reapply, a change of decimal places (a test proves it);
       - the inspector and the Form both show "also reported as";
       - untagging the cell removes all of them.
  3. **Zeros come from the rules, not from Excel** (finding 1). A new engine helper, `tableZeroPlan` / `fillTableMandatoryZeros`, is the table analogue of `mandatory-zeros.ts`. For each table column (slice) that has a value, it reports as 0 the line items that the executable mandatory rules (ML-*, SR-*) require and that are still empty. *Team:* it runs only as an explicit user action that lists what it filled, never on its own, and only for columns that already have a value. Golden: Dixon minus its zeros, plus the fill, gives 0 table ERRORs. The coverage scoreboard counts rule-filled zeros separately from figures found in Excel.
  4. **Table suggestions in the sidecar** (`/mapping/suggest` returns `blocks` next to `suggestions`). The detector is taxonomy-generic: candidate tables come from the authority's tables, by line-item and member labels, never by code. It works like this:
     - **Blocks:** a header row with 2+ value columns, with merged headers expanded.
     - **Columns → members:** column headers are matched to members with BM25 over the member labels.
     - **Rows → line items:** row labels are matched to the table's line items with the existing candidate generator, restricted to that table.
     - **Row groups → members:** a group heading ("Gross block") becomes a member on the table's other axis.
     - **Periods:** taken from the row label or the column header.
     - **Typed axes:** a row label becomes a typed member.
     - **Figures reported twice:** a statement cell whose element is the default-member total of a table with a single used member, or that equals a table's total column, gets an "also report as" suggestion.

     Measured on DGPL → Dixon (Ind AS) and on HPL → a hand-checked key from the Helmier PDF (C&I: share capital, PPE, borrowings).
  5. **Text:**
     - a text cell or range can be tagged as a text fact or a text block (rows joined into paragraphs through `richtext`);
     - Yes/No and dates can be tagged from cells.
     - **Filing details**, a form generated from the taxonomy's "Disclosure of general information …" / "Disclosures - …" ELRs (through the `TaxonomyCatalog` port, never hand-coded), covers company, auditors, directors / KMP (table rows), signing dates and the Yes/No questions. It is prefilled from last year's instance when the project was started from one (Phase 7).
  6. **Excel parsing:**
     - merged header cells are expanded for layout;
     - `.xls` number formats come from the BIFF XF records, so `.xls` amounts round like `.xlsx`. *Team:* xlrd, pinned, read-only and used for formats only: calamine keeps reading the values. Check it in the PyInstaller build (11b);
     - the 60k-cell cap applies to the grid only: the tagger gets every presentation sheet in full, and working papers are skipped by kind.
- **Consequences:**
  - The coverage evaluation is the scoreboard. Each producer (block suggestions, figures reported twice, the zero fill, text, filing details) adds produced facts, and the floors in `tests/test_coverage_eval.py` rise with them. Exit targets on Dixon, LLM off:
    - amounts right ≥ 160 and *wrong ≤ 25* (39 on 2026-11-11);
    - non-zero table amounts right ≥ 190 of 270, *wrong ≤ 10% of those produced*;
    - Dixon without its zeros + the fill → 0 ERRORs;
    - table text right ≥ 60 of 112;
    - text blocks right ≥ 8 of 10.

    C&I gets equivalent checks on HPL for the hand-checked tables. *Team:* the report gives right / near / wrong **per producer**.
  - The fix agent (ADR-0012) gains `setDims` / table values once block entries exist.
  - Costing stays out (Phase 12). Nothing keys on ELR codes or taxonomy ids: tables, members, sections and the filing-details form all come from the authority and the catalog.
