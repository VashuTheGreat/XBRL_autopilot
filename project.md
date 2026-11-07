# MCA XBRL Autopilot: Production Architecture & System Specification

**Document Version:** 3.0 (Commercial Desktop-Ready Specification)  
**Last Updated:** 2026-11-07  
**Status:** Production Desktop Ready / Stable  
**Test Suite:** 89 Passed / 89 Total (100% Pass Rate)

---

## 1. Mission & System Overview

**XBRL Autopilot** is an enterprise-grade financial preparation, taxonomy tagging, validation, and filing application designed for Company Secretaries (CS), Chartered Accountants (CA), and corporate compliance professionals preparing official Ministry of Corporate Affairs (MCA), Government of India XBRL instance documents (`.xml`).

The application provides a desktop productivity experience inspired by **Microsoft Excel**, **Microsoft Word**, and commercial reference tools such as WebXBRL, paired with a robust Python 3.12 + FastAPI backend, high-dimensional semantic vector search, standardized multi-taxonomy knowledge bases, schedule linking, dirty-state recovery caching, and a unified 4-step XML validation gate.

---

## 2. Core Architectural Pillars

### A. Standardized Multi-Taxonomy Knowledge Bases (`Knowlege_base/`)
The system eliminates direct re-parsing of raw XML linkbases during runtime. All three official MCA taxonomies are compiled into standardized intermediate JSON knowledge bases:

| Taxonomy | Knowledge Base Artifact | Concepts | ELRs | Rules | Filing Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MCA C&I 2016** *(Default)* | `Knowlege_base/ci_knowledge_base.json` | **3,660** | **47** | **1,164** | Standard Indian GAAP Commercial & Industrial filings (`AOC-4 XBRL`) |
| **MCA Ind AS V1.2** | `Knowlege_base/ind_as_knowledge_base.json` | **5,647** | **246** | **79** | Indian Accounting Standards compliant filings |
| **MCA Costing 2019** | `Knowlege_base/costing_knowledge_base.json` | **459** | **25** | **78** | Cost Audit & Compliance Report (`CRA-2 / CRA-4`) |

- **Taxonomy Isolation**: Enforced via `src.core.authority.get_authority(taxonomy)`. Switching taxonomies cleanly swaps the active taxonomy engine without mixing QNames, namespaces, or calculation networks.
- **ChromaDB Vector Store**: Each taxonomy corresponds to a dedicated collection (`ci_taxonomy`, `ind_as_taxonomy`, `costing_taxonomy`) ingested directly from the compiled JSON intermediate artifacts.

---

### B. Microsoft Office Desktop Productivity Shell
The UI is built as a desktop-first professional workspace:

1. **Top Application Menu Bar** (`partials/app_menu.html`):
   - **File**: `New Filing` (<kbd>Ctrl+N</kbd>), `Open Project` (<kbd>Ctrl+O</kbd>), `Save Project` (<kbd>Ctrl+S</kbd>), `Save to PC (.wxbrl)`, `Preferences & Auto-Save`, `Close / Discard`.
   - **Tagging**: `AI Auto-Tagging Assistant` (<kbd>Ctrl+Shift+T</kbd>), `Map Selected Tag` (<kbd>Enter</kbd>), `Remove Tag` (<kbd>Del</kbd>), `Link to Schedule Sheet`, `Reset Column Mappings`.
   - **View**: `Toggle Presentation Tree`, `Expand All Hierarchy`, `Collapse All`, `Filter Mapped Only`, `Filter Unmapped Rows`.
   - **Tools**: `Verify Balance Sheet Calculations`, `Recalculate Subtotals`, `Audit Log`, `Sample XBRL Ltd Demo`.
   - **Generate XML**: `Pre-Validation & XML Wizard` (<kbd>Ctrl+G</kbd>), `Quick Export XML`, `Export PDF/HTML Preview`.
2. **Desktop Action Toolbar** (`partials/app_toolbar.html`):
   - Live editable fields: `Particulars Col`, `CY Col`, `Col Diff (Gap)`, `Diff Tolerance`, and `Level of Rounding`.
   - Action controls: `✨ AI Suggestions`, `🔍 Jump to Tagged`, `🛡️ Validate`, `⚡ XML Wizard`.
3. **Live Difference & Status Monitor**:
   - Instant calculation: $\text{BS Difference} = \text{Total Assets} - (\text{Equity} + \text{Total Liabilities})$.
   - Instant calculation: $\text{P\&L Difference} = \text{Total Revenue} - \text{Total Expenses} - \text{Tax}$.
4. **Keyboard Shortcuts**:
   - <kbd>Ctrl+S</kbd>: Authoritative Save.
   - <kbd>Ctrl+O</kbd>: Open project modal.
   - <kbd>Ctrl+N</kbd>: Initialize new filing.
   - <kbd>Ctrl+G</kbd>: Launch XML Wizard.
   - <kbd>Ctrl+Shift+T</kbd>: Launch AI Auto-Tagging modal.
   - <kbd>Del</kbd>: Delete selected row mapping.
   - <kbd>F5</kbd>: Jump to linked cell.
   - <kbd>Enter</kbd>: Map highlighted concept to Excel row.

---

### C. Document Persistence & Recovery Cache Engine (`src/services/project_service.py`)
- **Authoritative `.wxbrl` Portable Project Package**:
  Stored in `saved_projects/<project_id>/` and exportable as a compressed `.wxbrl` archive:
  - `manifest.json`: Project metadata, company name, CIN, period, taxonomy type, tagged count, timestamps.
  - `filing_facts.json`: Canonical filing facts, contexts, values, and decimals.
  - `workbook.xlsx`: Original binary Excel workbook.
  - `tag_mappings.json`: Exact row-to-concept bindings, labels, and confidences.
  - `schedule_links.json`: Parent-child schedule links and note cross-references.
  - `ui_state.json`: Active sheet, column selections, scroll positions.
  - `settings.json`: Rounding level, col difference, autosave configuration.
- **Background Auto-Save Engine**:
  - Configurable interval (default: 60 seconds; customizable via `File -> Preferences & Auto-Save`).
  - Periodically snapshots the active session to `saved_projects/.recovery_<project_id>/`.
- **Automatic Recovery Cache Lifecycle**:
  - **Authoritative Save**: When the user explicitly saves to disk (<kbd>Ctrl+S</kbd>), the temporary recovery cache is automatically deleted.
  - **User Discard**: When the user closes or discards changes, `/api/projects/discard-recovery` automatically purges `.recovery_<project_id>/`.
- **Unsaved Changes Prompt**:
  - Intercepts file switching or tab exit when `isDirty` is True, prompting `Save & Proceed`, `Discard Changes`, or `Cancel`.

---

### D. Visual Color-Coding & Semantic Indicators Reference
XBRL Autopilot adheres to a unified visual color language across the spreadsheet grid, presentation tree, difference monitors, and dialogs:

#### 1. 7-State Tagging Status Model
| State | Badge / Swatch | Hex Code | Visual Meaning & When It Appears |
| :--- | :---: | :---: | :--- |
| **`UNTAGGED`** | ⚪ Gray | `#6c757d` | Plain Excel row with **no MCA taxonomy tag assigned**. |
| **`AI_RECOMMENDED`** | ✨ Indigo | `#4f46e5` | Staged AI recommendation awaiting user approval in Auto-Tag modal. |
| **`MAPPED_INCOMPLETE`** | ⚠️ Amber | `#f59e0b` | Concept mapped, but **CY or PY financial amount is missing or empty**. |
| **`SCHEDULE_REQUIRED`** | 🔴 Red | `#ef4444` | Concept mapped, but **mandates schedule/notes breakdown** under MCA rules. |
| **`SCHEDULE_LINKED`** | 🔗 Blue | `#2563eb` | Primary concept is **linked to its detailed schedule sheet breakdown rows**. |
| **`COMPLETE`** | ✅ Green | `#16a34a` | Concept is valid, amounts populated, and all mathematical rules pass. |
| **`INVALID`** | ❌ Crimson | `#dc2626` | Concept QName **does not exist in active MCA taxonomy**. |

#### 2. Spreadsheet Grid Cell Highlights (Left Pane)
- 🟢 **Mint Green (`#dcfce7` / `#166534`)**: `.cell-tagged` — Applied to row particulars cell when successfully mapped to a taxonomy tag.
- 🔵 **Classic Excel Blue (`#0078d7` / `#2563eb`)**: Active highlighted row / selected cell.

#### 3. Taxonomy Presentation Tree Highlights (Right Pane)
- 🔴 **Bold Crimson Red (`#c53030`)**: Applied to **tagged leaf concepts AND all parent abstract headings** (e.g. *Equity and liabilities [Abstract]*, *Shareholders' funds [Abstract]*), visually highlighting the active branch hierarchy.
- ⚫ **Dark Slate (`#0f172a`)**: Untagged taxonomy concepts.

#### 4. Live Difference Monitor
- 🟢 **Green Pill (`#16a34a` on `#f0fdf4`)**: **Difference = 0** (Balance Sheet parity achieved or P&L balanced).
- 🔴 **Red Pill (`#dc2626` on `#fef2f2`)**: **Difference $\neq$ 0** (Imbalance detected, e.g. `BS Diff: -2822434`).

#### 5. Validation Wizard Cards
- 🚫 **Rose / Red (`#be123c` on `#fff1f2`)**: **Blocking Errors** (must fix before XML can be exported).
- ⚠️ **Amber / Yellow (`#b45309` on `#fffbeb`)**: **Non-Blocking Warnings** (advisory disclosures).
- 🏷️ **Green (`#15803d` on `#f0fdf4`)**: **Gate Passed** (compliant for official XML generation).

#### 6. Document State
- 🟠 **Amber Dot (`●` `#f59e0b`)**: Dirty indicator displayed next to document title when unsaved changes exist.

**Supported Schedules**:
- Fixed Assets Schedule (ELR 200500): Tangible Assets, Capital WIP.
- Intangibles Schedule (ELR 200600): Intangible Assets, Amortisation.
- Share Capital Breakup (ELR 200100): Authorised, Issued, Subscribed, Shareholder details.
- Borrowings Schedule (ELR 200200): Long-term & short-term debt, term loans.
- Trade Payables & Receivables (ELR 200600): MSME classification and aging schedules.

---

### E. Unified 4-Step XML Generation & Pre-Validation Wizard (`src/web/routes/filing.py`)
Accessible via `Generate XML -> Pre-Validation & XML Wizard` (<kbd>Ctrl+G</kbd>):
1. **Pre-Validation Checks**:
   - Company CIN syntax and validity.
   - Reporting fiscal periods (start date, end date, order).
   - Balance Sheet equation balance within configured tolerance.
   - Mandatory disclosures (directors, auditor, cash flow, core balance sheet line items).
2. **Review Discrepancies**:
   - Visual breakdown of **Blocking Errors** (must resolve) vs **Non-Blocking Warnings**.
   - 1-click **Jump to Discrepancy** links to the invalid cell.
3. **Gate Enforcement**:
   - XML export button remains locked until zero blocking errors remain.
4. **Compliant XML Generation**:
   - Generates compliant XBRL instance XML (`in-ci-ent-2016-03-31.xsd` entry point) with ISO currency units and context references.

---

## 3. Complete API Endpoint Reference

| Category | Endpoint | Method | Description |
| :--- | :--- | :---: | :--- |
| **Projects** | `/api/projects` & `/api/projects/list` | GET | List all saved persistent filings on the server |
| | `/api/projects/save` | POST | Authoritative save to disk (purges recovery cache) |
| | `/api/projects/autosave` | POST | Periodic snapshot to `.recovery_<project_id>/` |
| | `/api/projects/discard-recovery` | POST | Purges local recovery cache on user discard or clean exit |
| | `/api/projects/load/{project_id}` | POST | Restores project state, workbook, mappings, and facts |
| | `/api/projects/export/{project_id}` | GET | Downloads portable `.wxbrl` project bundle |
| | `/api/projects/import` | POST | Uploads and restores a `.wxbrl` project bundle |
| | `/api/projects/new` | POST | Initializes a new filing with metadata & optional workbook |
| **Taxonomies** | `/api/taxonomies/catalog` | GET | List available MCA taxonomies (C&I, Ind AS, Costing) |
| | `/api/taxonomies/switch` | POST | Dynamically switch active taxonomy engine |
| | `/api/taxonomies/recommend` | POST | AI vector recommendation for workbook particulars |
| | `/api/taxonomies/tree` | GET | Expandable presentation tree hierarchy for ELR/scope |
| | `/api/taxonomies/search` | GET | Instant concept lookup across authority model |
| | `/api/taxonomies/tag-row` | POST | Maps single Excel row to taxonomy concept |
| | `/api/taxonomies/map-row` | DELETE | Clears tag mapping from an Excel row |
| | `/api/taxonomies/batch-apply` | POST | Batch commits approved AI tag recommendations |
| | `/api/taxonomies/settings` | POST | Updates column gap, particulars col, and rounding settings |
| | `/api/taxonomies/differences` | GET | Returns live Balance Sheet and P&L differences |
| **Spreadsheet** | `/api/tools/workbook/upload` | POST | Uploads and parses multi-sheet Excel workbook |
| | `/api/tools/workbook/sheet` | GET | Retrieves active sheet matrix and tagging annotations |
| | `/api/tools/workbook/link-schedule`| POST | Links schedule sheet rows to parent statement concept |
| **Filing & Wizard**| `/api/filing/wizard/status` | GET | Evaluates 4-step pre-validation gate for XML generation |
| | `/api/filing/overview` | GET | Retrieves filing metadata, summary, and revision |
| | `/api/filing/meta` | POST | Updates company info, CIN, and fiscal periods |
| | `/api/filing/export/xml` | GET | Downloads MCA-compliant XBRL XML instance document |
| | `/api/tools/preview/html` | GET | Printable HTML/PDF preview of financial statements |
| **Validation** | `/api/validation` | GET | Runs full MCA business rules & validation checks |
| | `/api/validation/fix` | POST | One-click auto-fix for common formatting/decimal errors |

---

## 4. Recent Issues & Technical Resolutions

1. **422 Unprocessable Entity on `/api/taxonomies/recommend`**:
   - *Problem:* Pydantic schema required strict literals (`"ci_taxonomy"`), rejecting frontend shorthand (`"ci"`).
   - *Resolution:* Relaxed schema to `str = CI_TAXONOMY` and added `COLLECTION_MAP` normalization in router.
2. **"0 tags applied" on Batch Apply**:
   - *Problem:* Syncing fact values threw unhandled `FactValueError: Reporting periods are not set` when tagging before filling company setup.
   - *Resolution:* Wrapped fact sync in `try...except FactValueError` to guarantee row tag mappings persist, and added default fiscal periods in `default_meta()`.
3. **Particulars Column Selection Flipping to 'A'**:
   - *Problem:* Duplicate DOM IDs in `financial_tagging.html` collided with desktop toolbar inputs, and `renderExcelGrid()` overwrote selections.
   - *Resolution:* Removed duplicate DOM elements and preserved user-selected column indexes across grid re-renders.
4. **Transparent Settings / Auto-Save Modal**:
   - *Problem:* Missing modal styling caused settings dialog to appear transparent.
   - *Resolution:* Added solid `#ffffff` card styles, dark blurred backdrop, office typography, and strict `hidden` attribute handling in `style.css` and `app.js`.

---

## 5. Verification & Test Execution

Run the complete test suite:
```bash
.venv/bin/pytest tests/ -v
============================== 89 passed in 8.26s ==============================
```

### Full Taxonomy & Vector Rebuild Pipeline
To verify taxonomy schemas or regenerate embeddings:
```bash
# Full rebuild (taxonomies + ChromaDB wipe and re-index)
make rebuild

# Fast rebuild (verifies and regenerates JSON knowledge bases without re-embedding)
make rebuild-fast
```
