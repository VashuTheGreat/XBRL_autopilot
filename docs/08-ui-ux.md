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
| ✨ | **AI Copilot** | Interactive MCA/XBRL filing copilot (`AiChatPanel`), conversation threads, prompt suggestions, expandable RAG citations, and rich GFM markdown preview |
| 🏢 | **Masters** | Company card, Auditor grid, Directors and signatories, Fill from master, master library (see below) |
| ⚙ | **Settings** | MCA tool path, theme, autosave interval, data-consent toggle (model and API keys configured securely backend/env-side) |

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
- **Column period & WebXBRL-style figure columns:**
  - **Sheet figure columns (Excel toolbar):** The active sheet's CY and PY columns are shown prominently on the toolbar (`CY: Col C · PY: Col D` or `Set CY / PY Columns`). Clicking it opens the configuration dialog to specify CY column, PY column (or CY-to-PY gap), with an option to apply across all sheets. The choice is remembered in `mapping.json` (`columns`).
  - **WebXBRL-style manual tagging:** When line-item particulars (e.g. column B) are selected, double-clicking an element in the Taxonomy browser tags both CY (column C) and PY (column D) together, or specific CY/PY buttons can be clicked on hover.
  - **Inspector column period:** The bottom inspector always shows the selected cell's column period status (`Column C: CY`, `Column B: period unknown`), with quick CY/PY override buttons.
  - **Auto-tag dialog:** Uses the sheet's configured CY & PY figure columns automatically, asking only for the line-item description column (with an expandable panel to adjust CY/PY if desired).
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
- **Statement ↔ note matching (XBRL Form, [14 Step 1](14-parity-build-plan.md#step-1--statement--note-matching)):** on a main statement, every line that a note supplies (share capital, borrowings, other current liabilities, revenue …) is coloured against its note:
  - **green:** every year adds up;
  - **red:** the note is still empty, or it differs;
  - no colour: nothing to compare (empty line, closed year, not applicable).

  The label's tooltip shows each year as "CY: statement 1,23,456 · note 1,20,000 · difference 3,456 (differs from the note)".
  - **Go to note:** the ⇥ button after the label, or **F7** on the selected line (selected in the Form or through its Excel cell). It opens the note and scrolls to its table, or to the element's row for a note total.
  - **Difference footer:** under a main statement, "Difference CY 0 · PY 0" is the gap of the statement's own totals (Σ |reported − computed|). It is green at 0 and red with "(n totals don't add up)" otherwise. Clicking it opens Problems filtered to that statement ("Only [100100] Balance sheet ✕"), validating first if needed. The model is `FormRow.note` / `FormView.difference`, filled by `EditorQueryService.form()` through `note-tie-view.ts`.
- **Statement tree marks (XBRL Form, [14 Step 2](14-parity-build-plan.md#step-2--statement-tree-markers-and-tagged-status)):**
  - **Markers** before the label, from taxonomy data (engine `form-marks.ts`): **E** = a text block shown in this ELR only; **L** = a linked text block, the same element presented in other ELRs (the tooltip names them); **T** = a dimensional table. Double-click **T** (badge or row) opens that table's grid and scrolls to it; double-click **E / L** opens Manual Tag preset to the element, for the selected Excel text.
  - **Colours** (one shared `rowTone`, also used for the note ties): **red** when a year is empty and the MCA rules require it now (engine `mandatoryCell`, conditional rules included, applicability respected) or when the note differs / is empty; **green** when the line is tagged from Excel or its note ties. The tooltip lists the empty years and the rule ids.
  - **Expand / collapse:** a ▸ / ▾ on every head with lines below it and on every table grid. **Ctrl+E** (while the Form has focus) opens everything if anything is closed, else closes every head and table. Selecting a cell, Go to note and T reopen whatever hides their target.
  - **Tagged elements in search results:** the Taxonomy panel and the Manual Tag dialog show ✓ "tagged at Balance Sheet!C14 (CY)" (+ n more; the tooltip lists all) on elements already used by an approved tag or an "also reported as" fact (`conceptUses`, from the store's mappings).
  - Model: `FormRow.marker` / `linkedElrs` / `tableId` / `mandatory` / `tagged`, filled by `EditorQueryService.form()` through `form-marks-view.ts`.
- **Mandatory items and Generate ([14 Step 5](14-parity-build-plan.md#step-5--mandatory-non-numeric--conditional-mandatory--generate-confirmation)):**
  - **Mandatory items** (Form toolbar): the text, date, Yes/No and list items the MCA rules require now and that are still empty, per year, grouped by statement (engine `mandatoryInputs` = `mandatoryGap` per non-numeric line, applicability respected). Inputs by data type: Yes / No buttons, a date picker, a list, a text field (Enter), a text area for text blocks (Ctrl+Enter). Values go through the engine fact patch (`setText`, source user), so a wrong value is refused with the reason. Tables an answer makes mandatory (C&I "auditor's report qualified = Yes" → the remarks table) are listed with **Open table**. Double-click an item → the Form at its row. Amounts stay with "Empty mandatory → 0".
  - **Conditional items:** CSR applicable = No drops the CSR items (C&I also closes them); auditor's report qualified = Yes adds the remarks. Items required by another answer say so; the Form's red markers follow the same rules.
  - **Generate XML** (Ctrl+G / menu): confirm the key Yes/No answers (holding company, subsidiaries, CSR applicable, auditor qualified; curated in `src/services/engine_rules/curation/<kb>/key_answers.json`, served in the rule bundle as `keyAnswers`). The tooltip shows what each answer requires. Then the count of mandatory items still empty (**Review…**) and validation errors. **Generate** needs every key answer given and confirmed and no error; with errors, **Fix first** opens Problems. Main also refuses (`GenerateService`: the export gate's `GateError`). The instance goes to the project's `output/NNN.xml`.
- **Several sources per fact: Add / Replace and View details ([14 Step 3](14-parity-build-plan.md#step-3--add--replace--view-details), [ADR-0015](decisions/ADR-0015-multi-source-mapping.md)):**
  - **Add / Replace / Cancel:** tagging a cell to a line that already has a value (from another cell, or typed / imported) asks first. **Add** makes the cell one more source: the line files the exact sum of its sources, on any sheet ("BS!C14 + Notes!D20"). **Replace** files the cell instead. Add is disabled, with the reason, for text / dates / Yes-No, for a typed or imported value, for a figure picked from a text cell, and for an "also reported as" fact. The same question comes from the Manual Tag dialog, a Form double-click and a Taxonomy panel double-click (`tagWithConfirm`, `AddReplaceDialog`).
  - **View details:** double-click a tagged value in the Form, or **Details** in the inspector. It lists every source with its signed amount, the total filed, ✕ to remove one source (the rest re-sum; removing the last one untags), and **Save as footnote (CY / PY)**, which writes "Comprises 1.23 (BS C3) + 0.1 (Notes B2) = 1.33." on the fact (`SourceDetailsDialog`).
  - **Shown everywhere:** the Excel overlay and the linked-fact outline cover every source. The Form chip reads "BS!C14 + Notes!D20". The inspector of any source shows "= BS!C14 + Notes!D20". The Taxonomy panel's "tagged at" lists the sum.
- **Preview + PDF ([14 Step 7](14-parity-build-plan.md#step-7--preview--pdf)):**
  - The **Preview** tab (right pane) shows the open filing rendered MCA-style: company and period header, one section per statement / note with "Unless otherwise specified …", statement rows with CY / PY, dimensional tables in blocks of columns, text blocks as "Textual information (n)", footnotes as "(A)", and Indian grouping. Main builds it (engine `buildPreviewHtml` through `PreviewService`). It shows in an `<iframe sandbox="">`: no scripts, no access to the app. It re-renders on every change of the filing.
  - **Format settings** in its toolbar: **Borders** (grid lines), **Bold headings** (headings, table titles and heading rows), **Spacing** (compact / normal / relaxed). They are saved with the filing (`.axbrl` `preview.json`) and the preview re-renders at once. The defaults match the MCA PDFs seen.
  - **Export PDF** opens a Save dialog ("Company 2025-26 preview.pdf") and prints the same document to A4 through Electron `printToPDF`, in a hidden window with no preload, sandboxed and with JavaScript off. It is marked "Preview — not the MCA rendering": the official PDF comes from the MCA tool.
- **Masters panel ([14 Step 9](14-parity-build-plan.md#step-9--masters-panel)):**
  - **What it shows:** the sections the knowledge base curates (`masters.json`, by ELR title): **Company** (every General information item, grouped by its taxonomy heading), **Auditor** (the auditors table), **Directors and signatories** (directors signing grid, company secretary / CFO, managers grid). All values are the filing's own CY facts: editing here edits the Form.
  - **Inputs:** by data type. Taxonomy enumerations are strict lists; the director's designation offers the taxonomy's KMP list and still accepts other text. Grid rows are cards (the panel is narrow); a new row appears in the filing once a field has a value.
  - **Live checks:** formats from the taxonomy type, a business rule's format, or the curation (PAN, DIN, SRN, ICAI membership number = 6 digits). The auditor's PAN is checked against the name for its category: holder type (firm F, individual P) and 5th character (the firm's name or the individual's surname). The auditor names always show "Enter it exactly as on the PAN".
  - **Fill from master:** library records into a grid; director rows into the directors' report signatories; **Load company name from master** fills the holding / subsidiary / associate companies table from saved companies. Rows already there are skipped.
  - **Master library:** "Save to master library" on a card or a row keeps it in app.db on this computer (values by element name, so it fills C&I and Ind AS filings). Remove from the list at the bottom.
- **Note editor and Word documents ([14 Step 6](14-parity-build-plan.md#step-6--note-editor-f2)):**
  - **F2** opens the editor on what was last pointed at: a Form row (its element), else the selected Excel cell (its element when tagged; an untagged text cell opens "Which text block is this?" with a text-block search, then the editor with the cell's text). Text blocks and text items only; table-only elements are refused ("edit it in the table").
  - **Editor:** text blocks get rich text limited to the MCA subset (bold, italic, underline, heading, lists, tables from paste); text items get a plain text area. **Paste** from Word / Excel goes through the engine's sanitiser in main (paragraphs and tables kept; styles, Office tags, `col`, spans removed). **Auto format** rebuilds pasted tables on a grid and drops empty rows, columns and paragraphs (text is never removed). The status line says "Will render in the MCA PDF" or lists what the MCA HTML schema rejects (Save is disabled then), plus what prints untidily (empty paragraphs, shaded runs, large headings, wide tables). Saved as the **CY** value.
  - **Parent text block:** a sub-item whose parent text block is empty shows a warning in the editor and after saving; the Problems panel lists it as info.
  - **Word documents:** **Open Word** (Excel pane header) converts a `.docx` (mammoth) into blocks in the MCA subset and shows them in place of the grid, one tab per document (Excel tab to go back). Click a block (Ctrl / Shift + click for more), then double-click a text block in the Taxonomy panel to tag them. Documents are kept for the session, not in the `.axbrl`.
- **A failing Excel view** shows "The Excel view stopped working" with Try again (`ErrorBoundary`), never a white window. Reveal requests wait until Univer has rendered the sheet (2026-11-11: a reveal right after a sheet change threw and blanked the app).
- **Hovering a cell** → tooltip: concept label + qname, period, dimensions, confidence, rule status.
- **Drag** a taxonomy concept onto a cell → creates a manual mapping, `origin: manual`.
- **Double-click manual tagging (`ManualTagDialog.tsx`):**
  - Double-clicking any financial statement line item, particulars row, or figure cell (in Univer grid or FormView) opens the Manual Tag dialog immediately.
  - Search taxonomy elements by label or technical QName with debounced queries.
  - Inspect element details (data type, period type, balance type, abstract status, documentation).
  - Period scope selector: tag both Current & Previous Year (`Both CY & PY`), `CY only`, or `PY only`.
  - Direct 1-click tagging: pressing Enter on search, double-clicking any taxonomy element card, or clicking the hover `[Tag]` button directly binds the tag without repetitive confirmation dialogs.
  - Coexists with AI suggestions: preserves AI candidate alternatives and displays clear visual distinction in the Mapping Inspector (green `[Manual]` vs amber `[AI Suggestion]`).

## AI Copilot Chatbot (`AiChatPanel.tsx`)
- Located in the left activity bar (`✨` icon).
- Connected to the sidecar FastAPI service (`/api/v1/conversations`, `/api/v1/conversations/{id}/messages`) backed by LangGraph's `InMemorySaver` and Qdrant hybrid retrieval over MCA rules and taxonomies.
- **Features:**
  - Thread switcher and multi-conversation management (`+ New Conversation`, delete thread, automatic titles).
  - Quick suggested prompt chips for common MCA/Ind AS compliance questions.
  - Expandable citations showing retrieved MCA rule and taxonomy context snippets.
  - **Rich GFM Markdown Preview:** Powered by the `marked` library with custom styling (`.markdown-body` in `ui/src/styles.css`), rendering GFM tables, headings (`h1`–`h4`), code blocks, bullet/numbered lists, bold/italics, and quotes.

## Model & API Configuration
- Preconfigured securely at the backend / environment level (`.env`).
- User-facing model selection dropdown and Groq API key configuration inputs removed from the Settings panel to prevent manual tampering and streamline the accountant workflow.

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
| Ctrl+G | Generate XML (key answers → mandatory items → errors → write) |
| Ctrl+P | Quick-switch ELR / sheet |
| Ctrl+Shift+F | Search taxonomy |
| F7 | Go to note (the selected statement line's note, at its table or row) |
| Ctrl+E (Form) | Expand / collapse the whole statement tree and its tables |
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
