# MCA XBRL Autopilot: Project Architecture & Execution Summary

**Document Version:** 2.0 (Consolidated & Summarized)  
**Last Updated:** 2026-11-07  
**Status:** In Production / Active Maintenance  
**Test Suite:** 79 Passed / 79 Total (100% Pass Rate)

---

## 1. Project Objective & Context

**XBRL Autopilot** is an enterprise-grade MCA (Ministry of Corporate Affairs, India) XBRL preparation, tagging, validation, and filing application inspired by the commercial **WebXBRL** suite. 

The application is tailored for Company Secretaries (CS), Chartered Accountants (CA), and corporate compliance professionals to automate and streamline the preparation of MCA XBRL instance documents (`.xml`) for Indian companies under:
- **C&I Taxonomy 2016 (V1.2 / V1.3 Rules)**
- **IND-AS Taxonomy (V1.2)**
- **Costing Taxonomy (2019 V1.1)**

### Migration History
The system was originally a hybrid JavaScript + Python codebase. The JavaScript business logic was completely converted and consolidated into a pure **Python 3.12 + FastAPI** backend with server-side Jinja2 templates and a vanilla JavaScript interactive client. The legacy JavaScript source is preserved for reference only in `legacy_js/`.

---

## 2. Core Subsystems & Architectural Components

### A. Authority Model (`Knowlege_base/MCA_AUTHORITY.json`)
The application does not parse raw taxonomy XML files on each request; it relies on a compiled 5.9MB authority model that pre-indexes:
- **3,660 C&I Concepts**: QNames, standard labels, data types, balances, and periods.
- **47 Extended Link Roles (ELRs)**: Presentation links, calculation links, and definition networks.
- **Business Rules & Calculations**: Tolerance limits, mandatory element validation, and asset-liability parity checks.
- Accessible in Python via the singleton `src.core.authority.get_authority()`.

### B. Multi-Taxonomy Vector Store (`chroma_langchain_db/`)
Semantic concept discovery is powered by ChromaDB and `sentence-transformers/all-mpnet-base-v2` embeddings:
| Taxonomy | Collection Name | Ingested Vectors | Source File / Package |
| :--- | :--- | :--- | :--- |
| **MCA C&I 2016** | `ci_taxonomy` | 3,660 | `Knowlege_base/MCA_AUTHORITY.json` |
| **IND-AS** | `ind_as_taxonomy` | 6,185 | `data/IND-AS taxonomy/Taxonomy for IND-AS V1.2@31-03-2017` |
| **Costing** | `costing_taxonomy` | 452 | `data/Costing Taxonomy/Costing Taxonomy 2019 Version 1.1@31-03-2019` |

### C. Spreadsheet & Dual-Pane Tagging Engine (`src/services/spreadsheet_service.py`)
- Native `.xlsx` / `.xls` workbook session parsing using `openpyxl`.
- Preserves raw workbook binary bytes for exact state restoration.
- Automatic column detection (Particulars, Note, Current Year, Previous Year).
- In-memory state tracking for tagged row-to-concept mappings `(sheet, row_idx) -> {concept, label, confidence}`.
- Real-time Balance Sheet and Profit & Loss difference derivation:
  - $\text{BS Difference} = \text{Total Assets} - (\text{Equity} + \text{Total Liabilities})$
  - $\text{P&L Difference} = \text{Total Revenue} - \text{Total Expenses} - \text{Tax}$

### D. Standard Multi-File Project Storage (`src/services/project_service.py`)
Filings are persisted in human-readable and standard file packages under `saved_projects/<project_id>/`:
- `manifest.json`: Metadata, CIN, company name, timestamps, active sheet, tagged count.
- `filing_facts.json`: All active filing facts serialized via `Filing.to_json()`.
- `workbook.xlsx`: The original binary Excel workbook uploaded by the user.
- `tag_mappings.json`: Exact row-to-concept mappings, labels, and match confidence.
- `settings.json`: Gap settings (`colDiff`, `particularsCol`, `cyCol`, `pyCol`, `noteCol`, `levelRounding`).
- Standalone portable `.wxbrl` zip archive generation for cross-machine export and import.

### E. Master Knowledge Base Rebuild Pipeline (`makefile` & `scripts/rebuild_knowledge_base.sh`)
When MCA updates taxonomies or business rules:
- **Full Rebuild**: `make rebuild` or `./scripts/rebuild_knowledge_base.sh`
  - Validates presence of unzipped official files in `data/`.
  - Re-extracts SHA256 hashes and metadata into `Knowlege_base/MCA_AUTHORITY.json`.
  - Safely wipes `chroma_langchain_db/` (`shutil.rmtree`).
  - Runs `src/ingestion/ingest_all_taxonomies.py` to regenerate vector embeddings across C&I, IND-AS, and Costing taxonomies.
- **Fast Rebuild (`--skip-chroma`)**: `make rebuild-fast`, `make rebuild skip-chroma`, or `./scripts/rebuild_knowledge_base.sh --skip-chroma`
  - Verifies and regenerates `Knowlege_base/MCA_AUTHORITY.json` without wiping or re-indexing vector stores.
  - **100% self-healing**: Automatically recreates the knowledge base from baseline templates if `Knowlege_base/` is deleted.

---

## 3. UI / UX Workflows (WebXBRL Alignment)

### 1. Full-Width Dual-Pane Workspace (100% Screen Width)
- The persistent left navigation sidebar was removed to eliminate cramped columns.
- The dual pane occupies the entire screen:
  - **Left Pane**: Excel worksheet grid with green highlights (`.cell-tagged` / `#8ce99a`) on mapped rows.
  - **Right Pane**: Presentation hierarchy tree with **bold red** highlights (`#c53030`) on mapped leaf concepts and all abstract ancestor groups.
  - **Selected Row Highlight**: Windows classic blue selection.
  - **Right-Click Context Menu**: Tag Selected Excel Row, Remove Tagging (<kbd>Del</kbd>), Go to Linked Cell (<kbd>F5</kbd>), Foot Note, Change Sign (<kbd>Ctrl -</kbd>), Properties (<kbd>F6</kbd>).

### 2. Startup Modal Dialog (`partials/startup_modal.html`)
Opens automatically on launch or via top navbar buttons:
- **Load Saved Project**: Browse persistent filings on disk with 1-click load or upload `.wxbrl` bundle.
- **Create New Filing**: Company Name, CIN, FY Start/End, Rounding Level, Report Nature, and Excel upload.
- **Quick Demo Sample**: 1-click fallback to pre-populated XBRL Ltd financials for testing.

### 3. Inline Gap Controls & Scope Selector
- Top toolbar controls for `Label Col`, `CY Col`, `Gap (Col Diff between CY & PY)`, and `Level of Rounding`.
- Multi-Scope dropdown: `Balance Sheet`, `Both (BS & PL)`, `Statement of profit and loss`, `Cash flow`, and individual `Notes`.

### 4. AI-Powered Auto-Tagging (Option A Staging Review)
1. User selects the Particulars column in Excel and clicks **Auto Tag**.
2. Frontend requests vector recommendations via `POST /api/taxonomies/recommend`.
3. Modal displays extracted text alongside recommended MCA tags, confidence badges (`98% Match`), and review checkboxes.
4. On clicking **Apply Recommended Tags**, mappings are committed via `POST /api/taxonomies/batch-apply`, updating filing facts, green cells, and bold red tree nodes.

---

## 4. Summary of API Endpoints

| Category | Endpoint | Method | Description |
| :--- | :--- | :---: | :--- |
| **Projects** | `/api/projects/list` | GET | List all persistent filings in `saved_projects/` |
| | `/api/projects/save` | POST | Save active state, Excel file, mappings, and settings |
| | `/api/projects/load/{project_id}` | POST | Restore project state, workbook, and mappings |
| | `/api/projects/export/{project_id}` | GET | Download portable `.wxbrl` zip archive |
| | `/api/projects/import` | POST | Upload and restore `.wxbrl` archive |
| | `/api/projects/new` | POST | Initialize new filing with metadata & optional workbook |
| **Taxonomies** | `/api/taxonomies/recommend` | POST | Vector recommendation for list of particulars |
| | `/api/taxonomies/tree` | GET | Presentation hierarchy for specified ELR/scope |
| | `/api/taxonomies/search` | GET | Concept lookup across authority catalog |
| | `/api/taxonomies/tag-row` | POST | Map single Excel row to taxonomy concept |
| | `/api/taxonomies/batch-apply` | POST | Batch apply AI approved recommendations |
| | `/api/taxonomies/settings` | POST | Update gap, column difference, and rounding settings |
| | `/api/taxonomies/differences` | GET | Live Balance Sheet & P&L differences |
| **Spreadsheet** | `/api/tools/workbook/upload` | POST | Upload and parse multi-sheet Excel file |
| | `/api/tools/workbook/sheet` | GET | Get active sheet matrix and tagging indicators |
| **Filing & XML** | `/api/filing/overview` | GET | Filing metadata, status, and summary |
| | `/api/filing/export/xml` | GET | Export final MCA compliant XBRL XML |
| | `/api/tools/preview/html` | GET | Printable HTML / PDF preview of financial statements |
| **Validation** | `/api/validation` | GET | Run all MCA Business Rules & gating validations |
| | `/api/validation/fix` | POST | One-click auto-fix for common discrepancies |

---

## 5. Execution & Verification Reference

### Running the Application
```bash
source .venv/bin/activate
uvicorn src.web.app:app --host 0.0.0.0 --port 8000 --reload
```

### Running the Test Suite
```bash
.venv/bin/pytest tests/ -v
```
**Current Test Coverage:** 79 tests passed (0 failures, 0 regressions, ~8 seconds).

### Rebuilding Taxonomies and Knowledge Base
```bash
./scripts/rebuild_knowledge_base.sh
```
Or without wiping ChromaDB:
```bash
./scripts/rebuild_knowledge_base.sh --skip-chroma
```
