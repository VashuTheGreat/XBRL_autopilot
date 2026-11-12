# 08 · UI / UX

The layout is IDE-like, built for accountants: dense, keyboard-friendly and calm. The vocabulary is accounting's ("Statement", "Note", "Tag", "Problem"), never developer's.

## Main window
```
┌ Title bar: XBRL Autopilot — Acme Pvt Ltd · FY 2025-26 · Standalone •                         ─ □ ✕ ┐
├ Menu: File  Edit  View  Filing  Tools  Help                                                        ┤
├──┬───────────────────┬───────────────────────────────────┬─────────────────────────────────────────┤
│AB│ Side panel        │ LEFT: Excel (Univer)              │ RIGHT: [XBRL Form] [XML] [Preview]       │
│  │ (Filing explorer  │  sheet tabs: BS | PL | BS Sch     │  ELR grid / Monaco XML / MCA-like preview│
│📁│  / Taxonomy /     │  cells coloured by mapping status │  selected fact highlighted               │
│🔎│  Problems / AI /  │  ◀──── linked selection ─────▶   │                                          │
│⚠ │  Masters)         │                                   │                                          │
│✨│                   ├───────────────────────────────────┴─────────────────────────────────────────┤
│🏢│                   │ Mapping Inspector (selected cell → concept, period, dims, confidence, ✓ ✗ ✎)  │
│⚙ │                   ├──────────────────────────────────────────────────────────────────────────────┤
│  │                   │ Bottom panel: [Problems (12)] [AI Agent] [Output]                             │
├──┴───────────────────┴──────────────────────────────────────────────────────────────────────────────┤
│ Status: CIN U12345… │ C&I 2016 │ FY 25-26 │ ⛔ 3 ⚠ 9 │ Sidecar ● ready │ AI ● gpt-oss-120b │ Saved   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **AB** is the activity bar.
- All splits are resizable (`react-resizable-panels`). Sizes are remembered in `ui-state.json`.

## Activity bar → side panels
| Icon | Panel | Contents |
|---|---|---|
| 📁 | **Filing explorer** | ELR tree grouped Statements / Notes / Disclosures / General info, with status dots: ● complete, ◐ partial, ○ empty, ⛔ errors |
| 🔎 | **Taxonomy** | Search concepts (label/qname). Filters: ELR, type, period. Drag a concept onto an Excel cell to tag it |
| ⚠ | **Problems** | Same as the bottom panel, larger, grouped by ELR |
| ✨ | **AI** | Auto-tag the workbook, the tagging-quality review, the fix-agent chat and patch cards |
| 🏢 | **Masters** | Company / directors / auditor (General Information 400100 form) |
| ⚙ | **Settings** | Groq key, model, MCA tool path, theme, autosave interval, data-consent toggle |

## Mapping colours (Excel pane)
| Colour | Meaning |
|---|---|
| 🟩 green | Approved mapping |
| 🟨 amber | AI suggestion, not yet approved (darker = lower confidence) |
| 🟥 red outline | Mapped fact has an ERROR issue |
| ⬜ grey hatch | Numeric cell with no mapping |
| 🟦 blue outline | Linked to the selection on the right |

On the right, the XBRL Form shows the reverse: the source cell ref shows as a chip next to each fact, and clicking it selects the cell on the left.

## Linkage interactions
- **Selecting a cell** → the Inspector shows its mapping, and the right pane follows it (2026-11-11, `ui/e2e/linkage-follow.mjs`):
  - **XBRL Form:** if the open statement doesn't show the cell's element, the Form opens one that does (`MappingView.elrUris`, by code). If the open statement shows the element, it stays open.
  - The element's row scrolls into view, below the sticky column header, and is highlighted: blue for a tagged fact, amber for a suggestion.
  - Clicking the same cell again brings the row back after the Form was scrolled away.
  - **XML tab:** the `<fact>` line is highlighted and scrolled into view.
- **Amounts in the Inspector** are shown as they go into the filing. Excel float noise is rounded to the cell's number format, or to the filing's "decimal places as presented" when the cell has none. A `rounded` badge appears, and its tooltip shows the stored number (e.g. `5443.466337358575` → 5,443.47). A shown digit beyond the filing's decimal places is never rounded away: tagging is refused with a message.
- **Ranges:** dragging over cells in one column selects a range. The inspector shows "sum of N cells" and the total, and tagging files the sum as one figure (a line with no total cell, e.g. Trade payables = MSME + others). A cell inside a tagged range belongs to that tag.
- **XBRL Form → "Empty mandatory → 0"** reports the statement's mandatory amounts that are still empty as 0 and lists them in a toast. Text fields are left to the user, who reviews the list (a line the company has inside another line, e.g. CSR inside Other expenses, must be corrected).
- **Decimal places as presented** are chosen in the New Filing wizard and can be changed in the Filing explorer header ("2 dp"). Changing them re-reads every tagged figure from Excel.
- **Column period** (untagged cells): "Column C: CY" with the reason in the tooltip (header, layout, or your choice). The CY/PY buttons set the period for that column of that sheet, and the choice is remembered in `mapping.json`. "auto" goes back to the header. When a header names a period outside the filing (a 3rd-year column, or stale text like "As at 30th September, 2019"), the strip says "Column C isn't part of this filing" and never guesses. Changing a tagged cell's CY/PY also sets its column.
- **Selecting a fact (Form or XML)** → the source cell is selected and scrolled into view on the left.
- **Tables (Phase 11, [ADR-0013](decisions/ADR-0013-table-tagging.md)):**
  - **Map as table:** drag over a note table in Excel, then click "Map as table" in the Excel toolbar. Pick the taxonomy table by searching its title or statement. Then:
    - every row with figures gets a line item, with its opening / closing role, an optional year and members (e.g. "Gross carrying amount");
    - every column gets members (e.g. "Computer equipments") and an optional year.

    **Preview** lists what would be filed and the cells that can't be tagged, with the reason; it also counts the facts reported again ("12 cells ready (+24 facts reported again)": a fair value equal to the carrying amount, the one category as the total). **Map cells** tags the ready cells as one block. A block cell is an ordinary tag, linked both ways; its extra facts are its "also" facts.
    Opened on a suggestion, the dialog keeps what it doesn't edit as suggested: a row's own columns (a related party under its category), its other line items, a column's totals (the row label's tooltip lists them).
  - **The Form shows the statement's tables** under its rows:
    - one column per member combination and year that holds a value;
    - each value with its source-cell chip;
    - line items without a value are folded away.

    Selecting a table cell in Excel opens its table's note on that value; clicking a value selects and reveals its cell.
  - **Also reported as:** the inspector of a tagged cell shows "also: Equity shares 1" chips and an "Also as…" button. The dialog lists the tables that report the cell's element first (★), preselects the element and asks for the members. The extra fact follows the cell on every value change. In the Form its chip is marked "also reported from I39".
  - **Suggested tables (auto-tagging):** a block the tagger matched to a taxonomy table has a dashed amber outline. Selecting one of its cells shows a bar above the inspector: the table, its confidence, the range and the number of cells, plus **Accept** (tag as suggested), **Review…** ("Map as table" prefilled; Map cells accepts it as edited) and **Reject**. A suggested "also reported as" fact shows in the inspector as "also: … (suggested)", with ✓ / ✗ once the cell is tagged. "Accept all ≥ 90%" never files those.
  - **Table zeros → 0** (Form toolbar, for statements with tables): reports as 0 what the mandatory-line-items rules require, in columns that already have a value, and lists what it filled in a toast.
- **A failing Excel view** shows "The Excel view stopped working" with Try again (`ErrorBoundary`), never a white window. Reveal requests wait until Univer has rendered the sheet (2026-11-11: a reveal right after a sheet change threw and blanked the app).
- **Hovering a cell** → tooltip: concept label + qname, period, dimensions, confidence, rule status.
- **Drag** a taxonomy concept onto a cell → creates a manual mapping, `origin: manual`.

## Screens
1. **Welcome:** New filing · Open… · Import XBRL… · Recent projects (company, FY, last opened) · Recover unsaved work (if any).
2. **New filing wizard:**
   1. Taxonomy: C&I 2016 or Ind AS 2017 (cards; AOC-4 XBRL).
   2. Company name and CIN, validated live against the CIN format.
   3. Report type: standalone / consolidated.
   4. FY dates; first financial year?
   5. Rounding level (Actual / Thousands / Lakhs / Millions / Crores).
   6. Import Excel (optional) → **Auto-tag now?**
3. **Import XBRL instance** (welcome button, File → Import XBRL Instance…; Phase 7):
   - Choose *Open that filing* (every fact as filed) or *Start next year's filing* (its current year becomes the previous year), then the file.
   - The taxonomy, company and periods come from the file.
   - The **import report** follows: counts, the round-trip proof (every fact regenerated with the same element, period, dimensions, unit, decimals and value), anything not imported, and a "their conventions vs ours" table (generator, context-id style, duplicate contexts, fact ids, units, decimals, footnotes). The report is kept in the project (`import/`).
4. **Workbench:** the main window above.
5. **Generate XML dialog:** blocking errors are summarised, with "Fix first" or "Generate anyway". Output path; option to open the MCA tool.
6. **Settings.**

## Keyboard shortcuts
| Keys | Action |
|---|---|
| Ctrl+N / Ctrl+O / Ctrl+S / Ctrl+Shift+S | New / Open / Save / Save as |
| Ctrl+Shift+V | Validate |
| Ctrl+G | Generate XML |
| Ctrl+P | Quick-switch ELR / sheet |
| Ctrl+Shift+F | Search taxonomy |
| F8 / Shift+F8 | Next / previous problem |
| Ctrl+. | Quick fix for the selected problem |
| Enter / Delete (on suggestion) | Approve / reject mapping |
| Ctrl+J | Toggle bottom panel |
| Ctrl+B | Toggle side panel |

## Visual style
- Tailwind 4 with CSS-variable tokens; light and dark themes, following the system by default.
- Inter or Segoe UI at 13 px base; tabular numbers for amounts.
- Indian digit grouping (12,34,567.00) in the Form and Preview.
- Icons: lucide-react.
