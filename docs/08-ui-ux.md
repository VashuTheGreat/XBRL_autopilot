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
- **Selecting a cell** → the Inspector shows its mapping. The right pane scrolls to the fact in the XBRL Form, and in the XML tab the `<fact>` line is highlighted.
- **Amounts in the Inspector** are shown as they go into the filing. Excel float noise is rounded to the cell's number format, or to the filing's "decimal places as presented" when the cell has none. A `rounded` badge appears, and its tooltip shows the stored number (e.g. `5443.466337358575` → 5,443.47). A shown digit beyond the filing's decimal places is never rounded away: tagging is refused with a message.
- **Column period** (untagged cells): "Column C: CY" with the reason in the tooltip (header, layout, or your choice). The CY/PY buttons set the period for that column of that sheet, and the choice is remembered in `mapping.json`. "auto" goes back to the header. When a header names a period outside the filing (a 3rd-year column, or stale text like "As at 30th September, 2019"), the strip says "Column C isn't part of this filing" and never guesses. Changing a tagged cell's CY/PY also sets its column.
- **Selecting a fact (Form or XML)** → the source cell is selected and scrolled into view on the left.
- **Hovering a cell** → tooltip: concept label + qname, period, dimensions, confidence, rule status.
- **Drag** a taxonomy concept onto a cell → creates a manual mapping, `origin: manual`.

## Screens
1. **Welcome:** New filing · Open… · Recent projects (company, FY, last opened) · Recover unsaved work (if any).
2. **New filing wizard:**
   1. Taxonomy & form: C&I 2016 → AOC-4 XBRL.
   2. Company name and CIN, validated live against the CIN format.
   3. Report type: standalone / consolidated.
   4. FY dates; first financial year?
   5. Rounding level (Actual / Thousands / Lakhs / Millions / Crores).
   6. Import Excel (optional) → **Auto-tag now?**
3. **Workbench:** the main window above.
4. **Generate XML dialog:** blocking errors are summarised, with "Fix first" or "Generate anyway". Output path; option to open the MCA tool.
5. **Settings.**

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
