# ADR-0004 · Univer for the editable Excel pane
- **Status:** accepted (2026-11-10)
- **Decision:** use Univer (Apache-2.0 core) for an Excel-like, editable multi-sheet view. Parse xlsx ourselves with exceljs in main, to avoid Univer's paid server-side import. Cell edits are stored in `.axbrl` `source/edits.json`.
- **Alternatives rejected:**
  - Handsontable: commercial licence.
  - Glide Data Grid: no formulas or editing UX.
  - FortuneSheet: smaller community.
