# XBRL Autopilot: Production-Grade MCA Desktop-Ready Application

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com)
[![ChromaDB](https://img.shields.io/badge/ChromaDB-VectorStore-orange.svg)](https://www.trychroma.com/)
[![Tests](https://img.shields.io/badge/tests-89%20passed-brightgreen.svg)]()
[![Status](https://img.shields.io/badge/status-Production%20Desktop%20Ready-success.svg)]()

**XBRL Autopilot** is an enterprise-grade, desktop-ready financial preparation, taxonomy tagging, validation, and filing application designed for Company Secretaries (CS), Chartered Accountants (CA), and corporate compliance professionals preparing MCA (Ministry of Corporate Affairs, India) XBRL instance documents (`.xml`).

It combines a professional desktop productivity interface (inspired by **Microsoft Excel**, **Microsoft Word**, and commercial reference tools such as WebXBRL) with AI-powered semantic vector recommendation, unified multi-taxonomy knowledge bases, schedule linking, dirty-state recovery caching, and a 4-step XML validation gate.

---

## Key Highlights & Architectural Capabilities

```
+---------------------------------------------------------------------------------------------------------+
|                                      XBRL Autopilot Desktop Application                                 |
+---------------------------------------------------------------------------------------------------------+
| Top Menu:  File  |  Tagging  |  View  |  Tools  |  Generate XML  |  Help                               |
| Toolbar:   [Particulars: A]  [CY: C]  [Diff: 2 (PY: E)]  [Round: Thousands]  [Auto-Tag]  [Validate]   |
+----------------------------------------------------+----------------------------------------------------+
|               Left Pane: Spreadsheet Grid          |         Right Pane: Taxonomy Presentation Tree     |
| - Excel Multi-Sheet Navigation (BS, PL, Schedules) | - Expandable Presentation Hierarchy (+ / -)        |
| - 7-State Visual Status Tagging (Color-Coded)      | - Bold Red Tagged Ancestors & Leaf Concepts        |
| - Interactive Cell Highlighting & Column Gap Sync  | - Live Financial Values (CY / PY) & Formula Subtotals |
| - Context Menu: Map, Remove, Link Schedule, Sign  | - Multi-Scope Filter: Balance Sheet, P&L, Notes   |
+----------------------------------------------------+----------------------------------------------------+
| Status Bar: Difference in Balance Sheet: CY = 0, PY = 0  |  Net P&L: CY = 0, PY = 0  |  Taxonomy: C&I 2016|
+---------------------------------------------------------------------------------------------------------+
```

### 1. Microsoft Word & Excel Desktop Application Interface
- **Office Application Menu**: Top-level menu system featuring `File`, `Tagging`, `View`, `Tools`, `Generate XML`, and `Help`.
  - **File**: `New Filing` (<kbd>Ctrl+N</kbd>), `Open Project` (<kbd>Ctrl+O</kbd>), `Save Project` (<kbd>Ctrl+S</kbd>), `Save to PC (.wxbrl)`, `Preferences & Auto-Save`, `Close / Discard`.
  - **Tagging**: `AI Auto-Tagging Assistant` (<kbd>Ctrl+Shift+T</kbd>), `Map Selected Tag` (<kbd>Enter</kbd>), `Remove Tag` (<kbd>Del</kbd>), `Link to Schedule Sheet`, `Reset Column Mappings`.
  - **View**: `Toggle Presentation Tree`, `Expand All Hierarchy`, `Collapse All`, `Filter Mapped Only`, `Filter Unmapped Rows`.
  - **Tools**: `Verify Balance Sheet Calculations`, `Recalculate Subtotals`, `Audit Log`, `Sample XBRL Ltd Demo`.
  - **Generate XML**: `Pre-Validation & XML Wizard` (<kbd>Ctrl+G</kbd>), `Quick Export XML`, `Export PDF/HTML Preview`.
- **Desktop Action Toolbar**:
  - Direct controls for Particulars Column, Current Year (CY) Column, Column Gap Difference (`Col Diff`), Tolerance Limit, and Level of Rounding (Actual, Thousands, Lakhs, Millions, Crores).
  - Quick action buttons: `✨ AI Auto-Tag`, `🔍 Jump to Tagged`, `🛡️ Validate`, `⚡ XML Wizard`.
- **Comprehensive Keyboard Shortcuts**:
  - <kbd>Ctrl+S</kbd>: Authoritative Save to disk.
  - <kbd>Ctrl+O</kbd>: Open saved project modal.
  - <kbd>Ctrl+N</kbd>: Initialize fresh filing.
  - <kbd>Ctrl+G</kbd>: Launch 4-Step Pre-Validation & XML Wizard.
  - <kbd>Ctrl+Shift+T</kbd>: Launch AI Auto-Tagging assistant.
  - <kbd>Del</kbd>: Remove taxonomy tag from highlighted row.
  - <kbd>F5</kbd>: Jump to linked cell / schedule note.
  - <kbd>Enter</kbd>: Confirm selected taxonomy concept mapping.

---

### 2. Complete Multi-Taxonomy Support (C&I, Ind AS, Costing)
WebXBRL supports all three official MCA taxonomies independently via standardized, compiled JSON intermediate knowledge bases:

| Taxonomy | Knowledge Base Artifact | Concepts | ELRs | Rules | Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MCA C&I 2016** *(Default)* | `Knowlege_base/ci_knowledge_base.json` | **3,660** | **47** | **1,164** | C&I 2016 General Purpose Taxonomy (`MCA_AUTHORITY.json`) |
| **MCA Ind AS V1.2** | `Knowlege_base/ind_as_knowledge_base.json` | **5,647** | **246** | **79** | Ind AS Taxonomy V1.2 linkbases |
| **MCA Costing 2019** | `Knowlege_base/costing_knowledge_base.json` | **459** | **25** | **78** | Cost Audit & Compliance Taxonomy 2019 V1.1 |

- **Taxonomy Isolation**: Strict authority boundary enforcement via `src.core.authority.get_authority(taxonomy)`. Switching taxonomies cleanly swaps the active taxonomy engine without mixing QNames, namespaces, or calculation rules.
- **Unified Vector Embeddings**: ChromaDB vector stores (`ci_taxonomy`, `ind_as_taxonomy`, `costing_taxonomy`) ingest concepts directly from the compiled JSON knowledge bases.

---

### 3. Document Persistence & Local Recovery Cache Engine
- **Standardized `.wxbrl` Portable Project Package**:
  Every project is stored in a clean, reproducible multi-file directory under `saved_projects/<project_id>/` and can be exported as a `.wxbrl` ZIP archive containing:
  - `manifest.json`: Metadata, CIN, company name, periods, taxonomy type/version, total tagged rows, timestamps.
  - `filing_facts.json`: Canonical filing facts, values, contexts, and precision.
  - `workbook.xlsx`: The original binary Excel workbook uploaded by the user.
  - `tag_mappings.json`: Exact sheet row-to-concept bindings and match confidences.
  - `schedule_links.json`: Parent-child statement-to-schedule relationships.
  - `ui_state.json`: Active sheet, particulars column, CY/PY column indices, scroll positions.
  - `settings.json`: Gap settings, rounding levels, auto-save preferences.
- **Background Auto-Save Engine**:
  - Configurable auto-save interval (default: 60 seconds; customizable in `File -> Settings`).
  - Automatically captures snapshots while editing and persists them to `saved_projects/.recovery_<project_id>/`.
- **Automatic Recovery Cache Cleanup**:
  - **Authoritative Save**: When the user explicitly clicks **Save** (<kbd>Ctrl+S</kbd>), the temporary `.recovery_<project_id>/` cache is automatically deleted from disk.
  - **User Discard**: When the user chooses **Discard Changes** upon closing or navigating, the recovery cache is automatically purged to keep the disk clean.
- **Unsaved Changes Prompt Dialog**:
  - Prompts the user with `Save & Proceed`, `Discard Changes`, or `Cancel` whenever attempting to switch filings or close tabs with dirty state.

---

### 4. Complete Color Coding & Visual Indicator Reference

WebXBRL uses a strictly defined color language across the dual-pane workspace, status bars, and dialogs to ensure instant clarity on document health:

#### A. 7-State Tagging Status Model (Spreadsheet Rows & Tag Badges)
Every line item in your financial statements is evaluated against the active MCA taxonomy and assigned one of seven distinct status states:

| State | Badge / Swatch | Hex Code | Visual Meaning & When It Appears | Action Required |
| :--- | :---: | :---: | :--- | :--- |
| **`UNTAGGED`** | ⚪ Gray | `#6c757d` | Plain Excel line item that has **no MCA taxonomy tag assigned**. | Select the row and map it manually or run **AI Auto-Tag**. |
| **`AI_RECOMMENDED`** | ✨ Indigo | `#4f46e5` | Staged tag proposed by the AI vector recommendation engine with confidence score (e.g. `95% Match`). | Review the recommendation in the staging modal and click **Apply**. |
| **`MAPPED_INCOMPLETE`**| ⚠️ Amber | `#f59e0b` | An MCA concept is mapped to the row, but **Current Year (CY) or Previous Year (PY) amount is missing or empty**. | Enter the missing value or adjust column gap settings. |
| **`SCHEDULE_REQUIRED`**| 🔴 Red | `#ef4444` | Concept is mapped and populated, but **mandates supplementary notes/schedule breakdown** under MCA rules (e.g., Tangible Assets, Share Capital, Borrowings). | Right-click the row or click **Link Schedule** to connect with schedule breakdown rows. |
| **`SCHEDULE_LINKED`**  | 🔗 Blue | `#2563eb` | Primary concept has been **successfully linked to its detailed schedule sheet rows**. | Schedule linking complete; numbers reconcile with breakdown. |
| **`COMPLETE`**         | ✅ Green | `#16a34a` | Concept is valid, amounts are populated, and all applicability and calculation rules pass. | Ready for filing. |
| **`INVALID`**          | ❌ Crimson | `#dc2626` | Concept QName **does not exist in the active MCA taxonomy** (syntax error or cross-taxonomy mix-up). | Re-tag with an official concept from the presentation tree. |

---

#### B. Spreadsheet Grid Cell Colors (Left Pane)
- 🟢 **Mint Green (`#dcfce7` background / `#166534` text / `#8ce99a`)**: Mapped/Tagged cell (`.cell-tagged`). Indicates this spreadsheet row has been committed to a taxonomy concept.
- 🔵 **Classic Excel Blue (`#0078d7` / `#2563eb`)**: Active selected cell/row highlight when navigating the grid.
- ⚪ **White / Off-White (`#ffffff` / `#f8fafc`)**: Unmapped normal cells.

---

#### C. Taxonomy Presentation Tree Colors (Right Pane)
- 🔴 **Bold Crimson Red (`#c53030` / `#dc2626`)**: **Tagged Concepts & Active Ancestor Branches**. Whenever a leaf concept is tagged, both the concept and all its parent abstract headings (e.g. *Equity and liabilities [Abstract]*, *Shareholders' funds [Abstract]*) turn **bold red**, visually displaying the tagged branch hierarchy.
- ⚫ **Dark Slate (`#0f172a` / `#1e293b`)**: Regular untagged concepts and leaf items.
- 🔘 **Muted Gray (`#64748b`)**: Abstract section headers with no mapped child facts.

---

#### D. Difference Monitor & Status Bar Colors
- 🟢 **Green Pill (`#16a34a` text on `#f0fdf4`)**: **Difference = 0**. Balance Sheet parity achieved ($\text{Total Assets} = \text{Total Liabilities \& Equity}$) or Net P&L balanced.
- 🔴 **Red Pill (`#dc2626` text on `#fef2f2`)**: **Difference $\neq$ 0**. Imbalance detected (e.g. `BS Diff: -2822434`). Indicates unmapped rows or rounding discrepancies that must be reconciled.

---

#### E. Validation Wizard & Pre-Validation Gate Colors
- 🚫 **Rose / Red Card (`#be123c` on `#fff1f2`)**: **Blocking Errors (Must Fix)**. Critical filing discrepancies (missing CIN, invalid dates, BS imbalance). XML generation remains blocked until this count reaches 0.
- ⚠️ **Amber / Yellow Card (`#b45309` on `#fffbeb`)**: **Non-Blocking Warnings**. Advisory observations (e.g., zero values in optional notes). XML can still be generated.
- 🏷️ **Green Card (`#15803d` on `#f0fdf4`)**: **Gate Passed**. Ready to generate official MCA XBRL XML.

---

#### F. Document State & Dirty Tracking
- 🟠 **Amber Dot (`●` `#f59e0b`)**: Displayed in the top menu bar next to the document title when **unsaved changes are present**.
- ⚪ **Hidden / Clear**: Clean state (all changes saved to disk).

---

#### G. Supported Schedule Relationships
- `in-gaap:TangibleAssets` & `in-gaap:CapitalWorkInProgress` $\to$ Fixed Assets Schedule (ELR 200500).
- `in-gaap:IntangibleAssets` $\to$ Intangibles Schedule (ELR 200600).
- `in-gaap:ShareCapital` $\to$ Share Capital Breakup (ELR 200100).
- `in-gaap:LongTermBorrowings` & `in-gaap:ShortTermBorrowings` $\to$ Borrowings Schedule (ELR 200200).
- `in-gaap:TradePayables` & `in-gaap:TradeReceivables` $\to$ Aging Schedules.

---

### 5. Unified 4-Step XML Generation & Pre-Validation Wizard
Accessible via `Generate XML -> Pre-Validation & XML Wizard` (<kbd>Ctrl+G</kbd>):
1. **Step 1: Pre-Validation Gate Checks**:
   - Company Identification: Valid CIN structure and reporting entity metadata.
   - Reporting Fiscal Periods: Current year and prior year date consistency.
   - Balance Sheet Parity: $\text{Total Assets} = \text{Total Equity \& Liabilities}$ within configured tolerance.
   - Mandatory Core Elements: Validates required directors' report, auditor, and financial disclosure facts.
2. **Step 2: Review Discrepancies**:
   - Visual breakdown of **Blocking Errors** (must fix before generation) vs **Non-Blocking Warnings**.
   - 1-click **Jump to Discrepancy** links directly to the faulty cell or concept.
3. **Step 3: Validation Gate Enforcement**:
   - Strict gate: XML generation is blocked until zero blocking errors remain.
4. **Step 4: Compliant MCA XBRL XML Generation**:
   - Generates fully compliant XBRL instance XML referencing the official entry point (`in-ci-ent-2016-03-31.xsd`).
   - Generates proper context references (`CY`, `PY`), units (`iso4217:INR`, `pure`, `shares`), and precision decimals (`-3`, `0`, `2`).

---

## Directory & Architecture Layout

```
XBRL_autopilot/
├── main.py                          # Uvicorn server launcher
├── pyproject.toml                   # Project dependencies & build config
├── data/                            # Raw MCA taxonomy linkbase packages
│   ├── c&I taxonomy/                # C&I 2016 schemas and linkbases
│   ├── IND-AS taxonomy/             # Ind AS V1.2 schemas and linkbases
│   ├── Costing Taxonomy/            # Costing 2019 schemas and linkbases
│   └── validation_tool/             # MCA XBRL Validation Tool V5.1
├── Knowlege_base/                   # Compiled standardized authority JSON models
│   ├── ci_knowledge_base.json       # C&I 2016 compiled model (3,660 concepts)
│   ├── ind_as_knowledge_base.json   # Ind AS V1.2 compiled model (5,647 concepts)
│   ├── costing_knowledge_base.json  # Costing 2019 compiled model (459 concepts)
│   └── MCA_AUTHORITY.json           # Canonical C&I authority dictionary
├── chroma_langchain_db/             # Multi-taxonomy vector embeddings
├── saved_projects/                  # Persistent projects & local recovery caches
│   ├── <project_id>/                # Authoritative project package
│   │   ├── manifest.json            # Project manifest & metadata
│   │   ├── filing_facts.json        # Canonical filing facts
│   │   ├── workbook.xlsx            # Uploaded Excel workbook
│   │   ├── tag_mappings.json        # Row-to-concept mappings
│   │   ├── schedule_links.json      # Parent-child schedule links
│   │   ├── ui_state.json            # Layout & view state
│   │   └── settings.json            # Rounding & gap settings
│   └── .recovery_<project_id>/      # Active recovery cache (purged on Save/Discard)
├── src/
│   ├── constants.py                 # Taxonomy constants and collection mappings
│   ├── core/                        # Core XBRL models, authority, periods, decimal
│   ├── engine/                      # Rules engine, calculation, validation gate, generator
│   ├── ingestion/                   # Taxonomy compilation & vector store ingestion
│   ├── pipeline/                    # Vector recommendation pipeline
│   ├── services/
│   │   ├── project_service.py       # Persistence, .wxbrl bundling, recovery cache
│   │   ├── schedule_service.py      # Schedule linking & 7-state status model
│   │   ├── spreadsheet_service.py   # Multi-sheet Excel parsing & live difference tracking
│   │   ├── taxonomy_catalog.py      # Hierarchy presentation trees & catalog search
│   │   └── session.py               # Active filing session & reactive recalculations
│   └── web/
│       ├── app.py                   # FastAPI application factory
│       ├── routes/                  # API routers (filing, facts, taxonomies, projects, tools)
│       ├── templates/               # Jinja2 templates (app_menu, app_toolbar, modals)
│       └── static/                  # CSS styling (Office theme), JS controller
└── tests/                           # 89 automated tests (100% pass rate)
```

---

## Getting Started

### Prerequisites
- Python >= 3.12
- `uv` package manager (recommended) or `pip`

### 1. Installation
```bash
git clone https://github.com/VashuTheGreat/XBRL_autopilot.git
cd XBRL_autopilot

# Using uv (recommended)
uv sync

# Or using standard venv + pip
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

### 2. Ingest Taxonomy Data
Ingest all three taxonomies (C&I, Ind AS, Costing) into ChromaDB:
```bash
make rebuild
# Or: .venv/bin/python -m src.ingestion.ingest_all_taxonomies
```

### 3. Launch the Application
```bash
make dev
```
Open your browser at **[http://localhost:7860](http://localhost:7860)**.

---

## Makefile Quick Reference

| Command | Description |
|:---|:---|
| `make dev` | Start development server with hot-reload at `http://localhost:7860` |
| `make start` | Start production server without hot-reload |
| `make test` | Run full automated test suite with pytest (**89/89 passing**) |
| `make rebuild` | Full rebuild: verifies `data/`, regenerates knowledge bases, and re-indexes vector embeddings |
| `make rebuild-fast` | Fast rebuild: regenerates JSON knowledge bases while preserving vector stores |
| `make clean` | Cleans temporary cache directories and build artifacts |

---

## Testing & Quality Assurance

All **89 automated unit and integration tests** pass with zero regressions:
```bash
.venv/bin/pytest tests/ -v
============================== 89 passed in 8.26s ==============================
```

### Key Test Suites:
- `tests/test_production_webxbrl.py`: Multi-taxonomy compilation, schedule requirements, 7-state status evaluation, .wxbrl bundle export/import, autosave recovery cache cleanup on Save/Discard, and XML wizard APIs.
- `tests/test_webxbrl_workflow.py`: Presentation trees, gap settings, AI recommendation, spreadsheet tagging, live differences.
- `tests/test_calculations_and_rules.py`: Calculation networks, tolerance, sign checks, minority interest rules.
- `tests/test_core_primitives.py`: Periods, scaling, units, dates, HTML sanitization.
- `tests/test_mandatory_and_applicability.py`: Mandatory facts, applicability rules, gating criteria.
- `tests/test_web_standardization.py`: Canonical JSON envelopes, 422 handlers, correlation IDs.

---

## License & Compliance

Developed for corporate filing compliance under the **Ministry of Corporate Affairs (MCA), Government of India**.
Adheres to official MCA C&I, Ind AS, and Costing Filing Manual standards and XBRL International 2.1 specifications.
