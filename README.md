# XBRL Autopilot: AI-Powered MCA WebXBRL Filing System

[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com)
[![ChromaDB](https://img.shields.io/badge/ChromaDB-VectorStore-orange.svg)](https://www.trychroma.com/)
[![Tests](https://img.shields.io/badge/tests-79%20passed-brightgreen.svg)]()

**XBRL Autopilot** is an enterprise-grade MCA (Ministry of Corporate Affairs, India) XBRL preparation, tagging, validation, and filing application inspired by the commercial **WebXBRL** suite.

It combines a 100% full-width dual-pane financial tagging workspace with an AI-powered vector recommendation engine to automate taxonomy tagging for Company Secretaries (CS), Chartered Accountants (CA), and corporate compliance professionals.

---

## Key Features & Workflows

### 1. Dual-Pane Financial Tagging Workspace (100% Full Screen)
Modeled directly after the reference WebXBRL software, occupying the full screen with zero clutter:
- **Left Pane (Excel Spreadsheet Viewer)**:
  - Multi-sheet workbook navigation (`BS`, `PL`, `BS Sch`, etc.).
  - Interactive grid with column headers (A, B, C...) and row numbers.
  - Automatic column role detection (Particulars, Note, CY, PY).
  - **Bright Green Cell Highlighting** (`.cell-tagged`) for rows successfully mapped to taxonomy tags.
- **Right Pane (Taxonomy Presentation Hierarchy)**:
  - Expandable presentation tree (`+` / `-`) displaying concepts, notes, current year, and previous year values.
  - Multi-scope selector: `Balance Sheet`, `Both (BS & PL)`, `Statement of profit and loss`, `Cash flow`, and individual `Notes`.
  - **Bold Red Tagged Concepts & Ancestors** (`#c53030`) displaying populated values and notes.
  - Dynamic calculation of parent subtotals (e.g., `Total shareholders' funds`, `Total non-current liabilities`).
  - Right-click context menu: `Tag Selected Excel Row`, `Remove Tagging` (<kbd>Del</kbd>), `Go to Linked Cell` (<kbd>F5</kbd>), `Foot Note`, `Change Sign` (<kbd>Ctrl -</kbd>), `Properties` (<kbd>F6</kbd>), `Expand All`.
- **Inline Column Gap & Rounding Toolbar**:
  - Live controls for `Label Col`, `CY Col`, `Gap (Col Diff between Current & Previous Year)`, and `Level of Rounding` directly in the top toolbar or via the classic "WXBRL - Reset Setting" modal.
- **Live Status & Differences Bar**:
  - Real-time Balance Sheet difference tracking: `Difference in Balance Sheet : Current Year = 0 , Previous Year = 0`.
  - Real-time Profit & Loss difference tracking: `Net Profit or Loss : Current Year = 0 , Previous Year = 0`.
  - Instant synchronization with one-click recalculations.

### 2. Startup Modal Dialog: Load vs Create New Filing
When opening the web application or selecting actions from the top navigation bar:
- **Card 1: Load Saved Project**:
  - Lists all persistent filings saved on the server with 1-click loading.
  - Dropzone for importing portable `.wxbrl` or `.zip` project bundles.
- **Card 2: Create New Filing**:
  - Master entry for Company Name, CIN, Financial Year Start/End dates, Rounding Level, and Report Nature.
  - Excel workbook file upload (`.xlsx`, `.xls`) to directly initialize and jump into tagging.
- **Testing Quick Link**:
  - 1-click option to load pre-populated demo company (XBRL Ltd) with Balance Sheet, P&L, and Schedule rows pre-tagged.

### 3. Standard Multi-File Project Persistence (`saved_projects/`)
Every project is saved in a standard, reproducible directory under `saved_projects/<project_id>/`:
- `manifest.json`: Project metadata, company details, active sheet, tagged count, timestamps.
- `filing_facts.json`: All active filing facts and domain metadata.
- `workbook.xlsx`: The original binary Excel workbook uploaded by the user.
- `tag_mappings.json`: Exact row-to-concept mappings, labels, and match confidence.
- `settings.json`: Column gap settings, particulars column, and rounding levels.
- Portable `.wxbrl` archive export and import allows moving filings between machines seamlessly.

### 4. AI-Powered Auto-Tagging (Option A Staging Review)
- Users select the Particulars/Descriptions column and trigger **Auto Tag**.
- High-dimensional semantic embeddings (`sentence-transformers/all-mpnet-base-v2`) match workbook lines against official MCA taxonomy concepts.
- **Interactive Staging Review Modal**:
  - Displays original Excel line items side-by-side with recommended MCA concept QNames and labels.
  - Shows match confidence badges (e.g. `98% Match`, `AI Recommended`).
  - Allows selecting, approving, or overriding tags prior to committing.
- **Batch Application**: Approved tags automatically populate filing facts, scale monetary figures according to the selected rounding level, and trigger reactive calculations.

### 5. Multi-Taxonomy Vector Store Coverage
Over **10,000+** official MCA taxonomy concepts and linkbase labels are ingested into dedicated ChromaDB collections:

| Taxonomy | Collection Name | Ingested Concepts | Source |
| :--- | :--- | :--- | :--- |
| **MCA C&I 2016** | `ci_taxonomy` | **3,660** | Compiled authority model (`MCA_AUTHORITY.json`) |
| **IND-AS** | `ind_as_taxonomy` | **6,185** | Official MCA IND-AS Taxonomy V1.2 linkbases |
| **Costing** | `costing_taxonomy` | **452** | Costing Taxonomy 2019 Version 1.1 linkbases |

### 6. Master Taxonomy & Business Rule Rebuild Pipeline
To handle future MCA taxonomy updates, verify schemas, or recover a deleted/corrupted knowledge base:

#### Full Rebuild (Taxonomies + Chroma Vector DB)
Scans `data/`, verifies all schemas & business rules, regenerates `Knowlege_base/MCA_AUTHORITY.json`, wipes `chroma_langchain_db/`, and freshly re-indexes all 10,000+ concepts:
```bash
make rebuild
# Or via shell script:
./scripts/rebuild_knowledge_base.sh
```

#### Fast Rebuild (`--skip-chroma`)
Verifies unzipped taxonomy packages in `data/`, verifies checksums, and regenerates `Knowlege_base/MCA_AUTHORITY.json` (self-healing if missing) without re-embedding into ChromaDB:
```bash
# Option 1: Dedicated make target
make rebuild-fast

# Option 2: Target with argument
make rebuild skip-chroma

# Option 3: Double-dash syntax
make -- rebuild --skip-chroma

# Option 4: Makefile variable
make rebuild ARGS="--skip-chroma"

# Option 5: Direct shell script
./scripts/rebuild_knowledge_base.sh --skip-chroma
```

> [!TIP]
> The rebuild engine is **100% self-healing**. Even if the entire `Knowlege_base/` folder is deleted, running any rebuild command automatically restores the authoritative MCA model from compressed baseline templates in `data/` and verifies them against the official schema packages.

### 7. Strict Validation & XBRL XML Generation
- Internal validation gate checking contexts, units, decimals, dimensions/hypercubes, and MCA business rules.
- Automated one-click fixes for common discrepancies (`/api/validation/fix`).
- MCA error explanation engine translating official validator logs into plain-English fixes.
- Generation of compliant XBRL instance XML (`in-ci-ent-2016-03-31.xsd` entry point) and printable PDF preview.

---

## Architecture & Codebase Layout

```
XBRL_autopilot/
├── main.py                          # Application entry point (uvicorn runner)
├── pyproject.toml                   # Project dependencies & configuration
├── data/                            # Downloaded MCA taxonomy packages & validation tools
│   ├── c&I taxonomy/                # C&I 2016 schemas and linkbases
│   ├── IND-AS taxonomy/             # IND-AS schemas and linkbases
│   ├── Costing Taxonomy/            # Costing taxonomy schemas and linkbases
│   └── validation_tool/             # MCA XBRL Validation Tool V5.1
├── Knowlege_base/                   # Compiled authority models (MCA_AUTHORITY.json)
├── chroma_langchain_db/             # Local Chroma vector database collections
├── saved_projects/                  # Persistent multi-file projects (<id>/manifest.json, workbook.xlsx, ...)
├── scripts/
│   └── rebuild_knowledge_base.sh    # Executable master rebuild script for taxonomies & vectors
├── src/
│   ├── constants.py                 # Collection names and global paths
│   ├── core/                        # Core XBRL models, authority, decimal, periods, units
│   ├── engine/                      # Rules, calculation, applicability, generator, gate
│   ├── ingestion/
│   │   ├── store_taxonomies.py      # Base taxonomy storage interface
│   │   ├── ingest_all_taxonomies.py # Multi-taxonomy ingestion pipeline runner
│   │   └── rebuild_knowledge_base.py# Master knowledge base rebuild and re-ingest
│   ├── pipeline/
│   │   └── recom_taxonomies.py      # Semantic vector recommendation pipeline
│   ├── services/
│   │   ├── embeddings/              # HuggingFace embedding providers
│   │   ├── vectordb/                # ChromaDB vector store wrapper
│   │   ├── retrieval/               # Hybrid retrieval & reranking
│   │   ├── project_service.py       # Multi-file project persistence (manifest, facts, xlsx, settings)
│   │   ├── spreadsheet_service.py   # Multi-sheet workbook parsing & cell tagging
│   │   ├── taxonomy_catalog.py      # Presentation hierarchy tree & catalog search
│   │   ├── session.py               # Active filing session & reactive recalculations
│   │   └── excel_import.py          # Classical workbook parsing utilities
│   └── web/
│       ├── app.py                   # FastAPI application factory & exception handlers
│       ├── routes/                  # API routes (filing, facts, taxonomies, tools, projects, validation)
│       ├── schemas/                 # Pydantic request/response models
│       ├── templates/               # Jinja2 templates (startup modal, full-width tagging workspace)
│       └── static/                  # CSS styles, icons, and client-side controllers
├── tests/                           # 79 automated unit and integration tests
└── webXBRL_app/                     # Reference application screenshots and executable
```

---

## Getting Started

### Prerequisites
- Python >= 3.12
- `uv` package manager (recommended) or `pip`

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/VashuTheGreat/XBRL_autopilot.git
cd XBRL_autopilot

# Using uv (fastest)
uv sync

# Or using standard pip with virtualenv
python3 -m venv .venv
source .venv/bin/activate
pip install -e .
```

### 2. Ingest Taxonomy Data (One-Time Setup)
To populate or rebuild the local Chroma vector database across all three taxonomies:
```bash
make rebuild
# Or: uv run python -m src.ingestion.ingest_all_taxonomies
```

### 3. Launch Development Server
```bash
make dev
```
*(Starts the development server with auto-reload enabled at **[http://localhost:7860](http://localhost:7860)**).*

For production server:
```bash
make start
```

---

## Makefile Quick Reference

| Command | Description |
|:---|:---|
| `make dev` | Start development server with hot-reload at `http://localhost:7860` |
| `make start` | Start production server without reload |
| `make test` | Run full automated test suite with pytest (79/79 passing) |
| `make rebuild` | Full rebuild: verifies `data/`, updates `Knowlege_base/MCA_AUTHORITY.json`, wipes `chroma_langchain_db/`, and re-indexes all taxonomies |
| `make rebuild-fast` | Fast rebuild: verifies and regenerates knowledge base from `data/` while preserving existing Chroma vector embeddings |
| `make rebuild skip-chroma` | Shortcut syntax for fast rebuild |
| `make -- rebuild --skip-chroma` | GNU Make double-dash flag syntax for fast rebuild |
| `make rebuild ARGS="--skip-chroma"` | Makefile variable passing for fast rebuild |
| `make clean` | Cleans `__pycache__`, `.pytest_cache`, and temporary files |
| `./scripts/rebuild_knowledge_base.sh` | Direct shell script execution for full rebuild |
| `./scripts/rebuild_knowledge_base.sh --skip-chroma` | Direct shell script execution for fast rebuild |

---

## API Documentation

FastAPI provides interactive Swagger documentation at **`/docs`** and ReDoc at **`/redoc`**.

### Key Endpoints:
- **Project Persistence & Startup Lifecycle**:
  - `GET /api/projects/list`: Returns manifests of all saved projects on the server.
  - `POST /api/projects/save`: Saves active filing facts, workbook, tag mappings, and settings to disk.
  - `POST /api/projects/load/{project_id}`: Restores project facts, Excel file, and mappings.
  - `GET /api/projects/export/{project_id}`: Downloads standalone portable `.wxbrl` project bundle.
  - `POST /api/projects/import`: Restores filing from uploaded `.wxbrl` bundle.
  - `POST /api/projects/new`: Initializes a new filing with master metadata and optional Excel file.
- **Taxonomies & Auto-Tagging**:
  - `POST /api/taxonomies/recommend`: Semantic recommendation for an array of particulars.
  - `GET /api/taxonomies/tree`: Retrieves presentation tree hierarchy with live filing values.
  - `GET /api/taxonomies/search`: Text search across taxonomy concepts.
  - `POST /api/taxonomies/tag-row`: Maps a workbook row to a taxonomy tag.
  - `POST /api/taxonomies/batch-apply`: Batch applies approved AI recommendations.
  - `POST /api/taxonomies/settings`: Updates gap, column difference, and rounding settings.
  - `GET /api/taxonomies/differences`: Returns live Balance Sheet and P&L differences.
- **Spreadsheet & Workbook**:
  - `POST /api/tools/workbook/upload`: Uploads and parses multi-sheet Excel file.
  - `GET /api/tools/workbook/sheet`: Retrieves grid rows, columns, and tag annotations.
- **Filing Lifecycle**:
  - `GET /api/filing`: Overview of active filing facts, metadata, and ELRs.
  - `POST /api/filing/meta`: Updates company information, CIN, and periods.
  - `GET /api/filing/export/xml`: Downloads MCA-compliant XBRL XML instance document.
  - `POST /api/validation`: Runs gate engine and MCA business rules.

---

## Testing & Quality Assurance

Run the complete test suite:
```bash
make test
# Or: uv run pytest tests/ -v
```

All 79 automated test suites pass with 0 regressions:
- `test_webxbrl_workflow.py`: Project save/load, bundle export/import, new filing lifecycle, vector recommendation, presentation trees, spreadsheet upload, row tagging, batch auto-tagging, live differences.
- `test_calculations_and_rules.py`: Calculation networks, tolerance, sign checks, minority interest rules.
- `test_core_primitives.py`: Periods, scaling, units, dates, HTML sanitization.
- `test_excel_import_full.py`: Excel amount parsing, label normalization, readiness rules.
- `test_integration_e2e.py`: End-to-end filing lifecycle, carry-forward, totals fill, upkeep.
- `test_web_standardization.py`: Canonical JSON envelopes, 422 handlers, correlation IDs.

---

## License & Compliance

Developed for compliance with the **Ministry of Corporate Affairs (MCA), Government of India** filing requirements.
Taxonomy definitions, linkbases, and business rules adhere to MCA C&I, IND-AS, and Costing Filing Manual guidelines.
