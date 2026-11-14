# ADR-0015 · A fact can be the sum of several Excel sources
- **Status:** accepted (2026-11-14). docs/14 Step 3.
- **Context:**
  - webXBRL asks **Add / Replace** when a line that already has a value is tagged again. Add sums another cell into the same element (doc 13 §11.6). **View details** lists every cell summed into a line (§12.9).
  - Until now a mapping entry had one `cell`: a single cell or a one-column range ([ADR-0009](ADR-0009-amounts-from-excel.md)). Cells that aren't next to each other, or are on different sheets ("BS!C14 + Notes!D20"), could not make one fact, and re-tagging replaced silently.
  - Many consumers key on the entry's one cell: auto-tagging suggestions, table blocks ([ADR-0013](ADR-0013-table-tagging.md)), figures picked from a text cell (`pick`), AI patches (ADR-0012), the column-period memory, the Excel overlay and the Form chip.
- **Decision:**
  1. **`MappingEntry.sources: { cell, sign }[]`** lists every source of the figure. Each source is a cell or a one-column range with its own sign, on any sheet. The filed value is the **exact decimal sum** of the sources' amounts (engine `sumAmounts`, `engine/src/amounts.ts`, BigInt decimals, written to the finest stated places). Each source's amount is read exactly as a single tag reads it (statement precision, lost-digit refusal, share capital to the rupee).
  2. **`cell` / `sign` stay and always equal `sources[0]`** (the anchor). Suggestions, blocks, picks, AI patches and the column period keep working on one cell, unchanged. `MappingService` is the only writer and keeps them in step (`setSources`).
  3. **Only approved amount tags can have more than one source.** Text, dates, Yes/No, figures picked from a text cell, and values typed or imported (no tag) can be replaced, not added to. An "also reported as" fact can't be added to directly: you add to the cell's own tag, and its "also" facts follow the sum.
  4. **Invariants:**
     - one fact ← one tag;
     - a cell is a source of at most one tag (Add refuses a cell tagged elsewhere);
     - tagging a cell of a sum to another element takes it out of the sum, and the rest stay summed;
     - removing the last source untags;
     - every value change (Add, remove, reapply after decimal places change, change of year) re-sums from all sources into the main fact and every "also" fact.
  5. **Add / Replace is asked in the renderer, decided in main.** `MappingService.conflict(input)` says whether the fact already has a value, where it comes from, and why Add is impossible (`addBlocked`). One renderer helper (`tagWithConfirm` in `stores/editor.ts`) asks the question for every tagging path (Manual Tag dialog, Form double-click, Taxonomy panel double-click). Then it calls `addSource` or `tag`.
  6. **View details** (`MappingService.details`) lists the sources with their signed amounts and the filed total. **Save as footnote** (`SourceFootnoteService`) writes "Comprises 1,23,456 (BS C14) + 567 (Notes D20) = 1,24,023." on the fact through `core/footnotes.js` (now exported from the engine). The generator and `.axbrl` already carry footnotes.
  7. **File format 2.** `AXBRL_FORMAT_VERSION` 1 → 2, `mapping.json` `version` 1 → 2. A format 1 file is migrated in memory on open: each entry's one cell becomes `sources: [{ cell, sign }]` (`project/migrations.ts`). It is written as format 2 on the next save. Format 2 files open read-only in older apps (the existing rule).
- **Consequences:**
  - The Excel overlay, the store's cell index, `MappingService.byCell`, `cellInfo` and `approvedAt` look at every source. The Form chip shows "BS!C14 + Notes!D20" (`FormCell.sources`). The Taxonomy panel's "tagged at" lists all the sources.
  - Auto-tagging and table mapping still create one-source entries. Their behaviour and the DGPL / HPL scoreboards don't change.
  - Validation still points a problem at the anchor cell.
- **Alternatives rejected:**
  - Replacing `cell` with `sources` everywhere: this would touch every consumer (AI, blocks, patches) for no behavioural gain, at more risk.
  - Storing only the *extra* sources: two places to read the amount from. A list of one keeps one code path.
  - Summing as JS numbers: forbidden (CLAUDE.md rule 3).
