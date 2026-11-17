# 13 — Gap Analysis, Webtel Deconstruction & Ind AS Architecture Blueprint

This document records the architectural audit, domain gap analysis, Webtel webXBRL reverse-engineering insights, and the revised blueprint for our **Ind AS (AOC-4 XBRL)** automated filing system.

---

## 1. Domain Gap Analysis (What Was Wrong in the Initial Approach)

1. **Flat Row-by-Row vs. Financial Hierarchy**:

   - *Flaw*: Initial auto-tagging (`layout.py`) processed Excel files row-by-row using regex heuristics.
   - *Reality*: Real corporate financial statements have multi-level indentation, sub-classifications, and grouped sections. Naive row-by-row matching loses parent-child context (e.g., classifying a sub-heading as an element, or losing the current/non-current qualifier).
2. **Costing (CRA-4) Conflated with Financial Statements (AOC-4)**:

   - *Flaw*: The initial repository treated Costing Taxonomy identically to C&I and Ind AS, dumping it into Qdrant as `cost_taxonomy`.
   - *Reality*: **Cost Audit (CRA-4)** is filed by Cost Accountants (CMAs) under Section 148 of the Companies Act. It uses product-wise unit cost sheets, ITC-HS / NPCS codes, capacity utilization, and operational consumption. It has zero Balance Sheet / P&L concepts. Webtel and all major vendors provide a completely separate software product for Costing.
   - *Decision*: **Strictly decouple and focus 100% on Ind AS 2017 (AOC-4)**.
3. **Incomplete Table & Notes Tagging**:

   - Real notes (related-party transactions, maturity buckets, contingent liabilities, multi-class share capital with narrative counts) are multidimensional and cannot be forced into a flat spreadsheet cell-tagging model.

---

## 2. Deconstruction of Webtel webXBRL (from Official Product Analysis)

A thorough analysis of Webtel webXBRL reveals its core UI/UX and architectural flow:

### A. The 5-Stage User Journey

1. **Masters & Company Setup**:
   - Company Master: Prefilled via CIN from MCA portal (Name, PAN, Standalone/Consolidated, Cash Flow Method: Direct/Indirect).
   - Director & Auditor Masters: Auto-fetched via DIN and PAN.
   - Document Master: Upload of distinct Excel files/schedules.
2. **Financial Tagging View (Split Screen)**:
   - Left: Uploaded Excel sheet.
   - Right: Hierarchical Ind AS Taxonomy tree.
   - `F9` Column Gap Utility: Sets column offset between CY and PY (e.g. 1 blank column gap). A single double-click tags both CY and PY cells simultaneously.
   - Live Reconciliation Footer: Continuously displays `Balance Sheet Difference = Current Year: 0 | Previous Year: 0`.
3. **Dedicated Table Tagging Window (`[T]`)**:
   - Tables (PPE schedule, changes in equity, borrowings) do NOT tag in the flat sheet; they open in a **dedicated pop-up window**.
   - **Show/Hide Members**: Displays the standard taxonomy members. Accountants can toggle off unused rows (e.g. uncheck "Other building") or add custom members using `+`.
   - **Table Reconciliation Counter**: Compares `Value as per Balance Sheet` vs `Table Total Value` vs `Difference`. Any non-zero difference turns **RED**.
4. **Notes & Text Block Tagging (`[E]`)**:
   - Narrative disclosures (Auditor Report, Director Report, Accounting Policies, Notes on Accounts) are managed in a text-block view where accountants paste/tag paragraphs.
5. **Validation & MCA Tool Integration**:
   - Color-coded error categorisation:
     - **Blue**: Missing Line Item (Mandatory concept not tagged).
     - **Orange**: Missing Member / Dimensional Detail.
     - **Red**: Table reconciliation mismatch or critical business rule failure.
   - Clicking any error navigates directly to the problem cell/table.

### B. Standard Indicator Decoding

| Symbol / UI Cue           | Meaning in Webtel                  | Purpose in XBRL                                                 |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------- |
| **`[E]`**         | **Explanatory / Text Block** | Narrative disclosures (Director's Report, Accounting Policies). |
| **`[L]`**         | **Link**                     | Cell linked to an underlying note/schedule.                     |
| **`[T]`**         | **Table**                    | Multidimensional schedules (PPE, Share Capital, Equity).        |
| **Underlined Cell** | **Footnote Attached**        | Specific footnote attached to a reported fact.                  |
| **Red Highlights**  | **Mandatory / Mismatch**     | Field required by MCA or Balance Sheet != Table Total.          |

---

## 3. High-Leverage Innovation: "Workbook Schema & Column Mapper"

To drastically cut accountant preparation time from hours to minutes, we introduce the **Workbook Schema Mapper Wizard** before any row tagging begins.

### Why It Solves the Problem:

Client workbooks often contain 15–25 sheets (scratchpads, ledgers, draft statements, tax depreciation). Blind AI tagging creates noise and high error rates.

### The 3-Step Wizard Flow:

```
[Uploaded Client Workbook]
          │
          ▼
1. Sheet Classifier (Auto-suggest + 1-click confirmation)
   ├── Sheet "BS"         ──> Role: "Balance Sheet" (Active)
   ├── Sheet "PL"         ──> Role: "Profit and Loss" (Active)
   ├── Sheet "Notes"      ──> Role: "Notes to Accounts" (Active)
   ├── Sheet "PPE_Sched"  ──> Role: "PPE Table" (Active)
   └── Sheet "TrialBal"   ──> Role: "Ignored / Discarded"
          │
          ▼
2. Column Role Detector (Per Active Sheet)
   ├── Particulars / Line item labels: Column B
   ├── Note Reference:                 Column C
   ├── Current Year (CY) Amount:       Column D (Date: 31-03-2026)
   └── Previous Year (PY) Amount:      Column E (Date: 31-03-2025)
          │
          ▼
3. Note Cross-Linkage
   └── BS (Col C "Note 4") is linked to Notes Sheet (Note "4 - Trade Receivables")
```

Once the schema is established, all row and table tagging runs with 95%+ precision because particulars, amounts, and note connections are structurally known.

---

## 4. Validation Engine Architecture: MCA Business Rules vs. Arelle

### The Dual-Engine Strategy:

1. **Arelle's Scope**:
   - Arelle is a standard XBRL 2.1 validator. It ensures XML syntax, XSD schemaRef, namespaces, units, and calculation linkbases are technically valid.
   - **Limitation**: Arelle has zero knowledge of the 1,351 Indian Ministry of Corporate Affairs (MCA) specific business rules (e.g. `SR-L1001-1`, `GR-3`). An XML passing Arelle can still fail 50 MCA checks.
2. **Our MCA Deterministic Engine (`@xap/engine`)**:
   - Evaluates the official MCA AST business rules (`ind_as_engine_rules.json`).
   - Runs in-memory inside the client in ~200ms debounced on every edit, keeping the UI completely lag-free.
3. **Official MCA Validation Tool v5.1**:
   - Used as the final external gatekeeper before filing to guarantee 100% acceptance on the MCA portal.

### Why Rule Changes Require ZERO Code Changes:

MCA business rules are entirely **data-driven ASTs**, not hardcoded `if/else` statements in TypeScript or Python.
When MCA publishes an updated Excel workbook (e.g. `Business Rules for IndAS Taxonomy V1.3.xlsx`), the Python builder script compiles it into `ind_as_engine_rules.json`. The engine executes the AST dynamically.

---

## 5. System Architecture: Desktop UI vs. FastAPI Backend

```
┌────────────────────────────────────────────────────────┐
│               FRONTEND (Desktop Application)           │
│             Electron + React 19 + Tailwind CSS         │
├────────────────────────────────────────────────────────┤
│ • Local Project State (.axbrl zip / local SQLite):     │
│   - Tagged cells, mappings, overrides, unsaved edits.  │
│   - Client financial confidentiality & 0ms responsiveness.
│ • Excel Spreadsheet Grid (Univer)                      │
│ • Schema & Column Mapper UI                            │
│ • Dedicated Table Modal [T] with Member Toggle & Diffs │
│ • Live Reconciliation Badge (CY Diff = 0 | PY Diff = 0)│
└───────────────────────────▲────────────────────────────┘
                            │ REST API / IPC
┌───────────────────────────▼────────────────────────────┐
│               BACKEND (FastAPI / Python Sidecar)       │
├────────────────────────────────────────────────────────┤
│ • Workbook Inspection & Schema Extraction              │
│ • Ind AS Taxonomy Catalog & ELR Trees                  │
│ • Hybrid Tagging Suggester (BM25 + Qdrant + FlashRank) │
│ • Table Block Member Extractor                         │
│ • MCA Ind AS Executable Rules AST Provider             │
│ • Deterministic XML Instance Generator                 │
│ • Licensing, Auth & In-Memory Copilot Chatbot          │
└────────────────────────────────────────────────────────┘
```

---

## 6. Detailed FastAPI Route Specifications for Ind AS

### 1. `POST /api/v1/workbooks/inspect`

Inspects an uploaded workbook and extracts candidate sheets, header rows, and sample columns for the Schema Mapper.

* **Request**: Multipart Form Data (`file: UploadFile`).
* **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "filename": "Financials_2026.xlsx",
      "sheets": [
        {
          "name": "BS",
          "rowCount": 85,
          "colCount": 8,
          "sampleRows": [["Particulars", "Note", "31-03-2026", "31-03-2025"]],
          "suggestedRole": "balance_sheet",
          "detectedColumns": {
            "labelCol": "B",
            "noteCol": "C",
            "cyCol": "D",
            "pyCol": "E"
          }
        },
        {
          "name": "Trial_Balance",
          "rowCount": 450,
          "colCount": 12,
          "suggestedRole": "ignored"
        }
      ]
    }
  }
  ```

---

### 2. `GET /api/v1/taxonomies/ind_as/elrs`

Retrieves all 66 Extended Link Roles (statements, schedules, notes) grouped by accounting category.

* **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "taxonomy": "ind_as_2017",
      "elrs": [
        {
          "code": "100100",
          "title": "Balance sheet",
          "group": "Balance Sheet",
          "order": 1
        },
        {
          "code": "100200",
          "title": "Statement of profit and loss",
          "group": "Profit & Loss",
          "order": 2
        },
        {
          "code": "400100",
          "title": "Property, plant and equipment",
          "group": "Notes",
          "order": 10
        }
      ]
    }
  }
  ```

---

### 3. `GET /api/v1/taxonomies/ind_as/elrs/{code}/tree`

Returns the hierarchical presentation tree of concepts for a given statement/ELR.

* **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "elrCode": "100100",
      "root": [
        {
          "qname": "in-ca:Assets",
          "label": "Assets",
          "isAbstract": true,
          "children": [
            {
              "qname": "in-ca:NonCurrentAssets",
              "label": "Non-current assets",
              "isAbstract": true,
              "children": [
                {
                  "qname": "in-ca:PropertyPlantAndEquipment",
                  "label": "Property, plant and equipment",
                  "isAbstract": false,
                  "periodType": "instant",
                  "dataType": "monetaryItemType",
                  "indicator": "T",
                  "hasTable": true
                }
              ]
            }
          ]
        }
      ]
    }
  }
  ```

---

### 4. `POST /api/v1/mapping/suggest_column`

Auto-tags a batch of row particulars from an active sheet using Hybrid Search (BM25 + Qdrant Dense Vector + FlashRank neural reranker).

* **Request**:
  ```json
  {
    "taxonomy": "ind_as_taxonomy",
    "sheetRole": "balance_sheet",
    "items": [
      { "row": 12, "label": "Equity Share Capital", "noteRef": "3" },
      { "row": 15, "label": "Trade Receivables", "noteRef": "7" }
    ],
    "context": {
      "levelOfRounding": "Lakhs",
      "cyPeriod": "2026-03-31",
      "pyPeriod": "2025-03-31"
    }
  }
  ```
* **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "suggestions": [
        {
          "row": 12,
          "label": "Equity Share Capital",
          "bestMatch": {
            "concept": "in-ca:EquityShareCapital",
            "label": "Equity share capital",
            "score": 0.96,
            "origin": "exact"
          },
          "alternatives": [
            {
              "concept": "in-ca:OtherEquity",
              "label": "Other equity",
              "score": 0.65
            }
          ]
        }
      ]
    }
  }
  ```

---

### 5. `POST /api/v1/mapping/notes/suggest`

Chunks unstructured narrative documents (Director's Report, Auditor's Report, Significant Accounting Policies) by headings and auto-matches paragraphs to Ind AS `[Text Block]` disclosure concepts.

* **Request**:
  ```json
  {
    "taxonomy": "ind_as_taxonomy",
    "documentType": "directors_report",
    "text": "DIRECTORS' REPORT\nTo the Members,\nThe Directors present the 13th Annual Report...\nFinancial and Operational Highlights\nShare capital of the Company stood at Rs 3,00,000...",
    "format": "text"
  }
  ```
* **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "chunks": [
        {
          "chunkId": "chunk_01",
          "heading": "DIRECTORS' REPORT > Share Capital",
          "startOffset": 142,
          "endOffset": 235,
          "text": "Share capital of the Company stood at Rs 3,00,000...",
          "bestMatch": {
            "concept": "in-ca:DescriptionOfChangeInShareCapitalExplanatory",
            "label": "Description of change in share capital [Text Block]",
            "score": 0.97
          },
          "alternatives": []
        }
      ]
    }
  }
  ```

---

### 6. `POST /api/v1/mapping/tables/suggest`

Detects dimensional schedules (e.g. PPE breakdown by asset class) and returns member mappings.

* **Request**:
  ```json
  {
    "taxonomy": "ind_as_taxonomy",
    "tableQname": "in-ca:PropertyPlantAndEquipmentTable",
    "rows": ["Land", "Buildings", "Plant and equipment", "Total"],
    "columns": ["Gross Carrying Amount Opening", "Additions", "Closing"]
  }
  ```
* **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "table": "in-ca:PropertyPlantAndEquipmentTable",
      "rowMappings": [
        { "rowText": "Land", "member": "in-ca:LandMember", "isStandard": true },
        { "rowText": "Buildings", "member": "in-ca:BuildingsMember", "isStandard": true }
      ],
      "columnMappings": [
        { "colText": "Gross Carrying Amount Opening", "concept": "in-ca:GrossCarryingAmount", "periodRole": "opening" }
      ]
    }
  }
  ```

---

### 7. `GET /api/v1/taxonomies/ind_as/rules`

Serves the executable AST business rules and mandatory requirements.

* **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "taxonomy": "ind_as_2017",
      "totalRules": 1351,
      "executableCount": 1273,
      "rules": [
        {
          "id": "SR-L1001-1",
          "elr": "100100",
          "severity": "ERROR",
          "expression": {
            "if": { ">": ["in-ca:PaidUpCapital", 0] },
            "then": { "mandatory": ["in-ca:DisclosureOfShareCapitalNote"] }
          },
          "message": "Disclosure of Share Capital Note is mandatory when paid-up capital is positive."
        }
      ]
    }
  }
  ```

---

### 8. `POST /api/v1/instances/generate`

Generates the final MCA-compliant AOC-4 XBRL XML instance document.

* **Request**:
  ```json
  {
    "taxonomy": "ind_as_2017",
    "cin": "U72200KA2010PLC123456",
    "companyName": "Dixon Technologies Private Limited",
    "fyStart": "2025-04-01",
    "fyEnd": "2026-03-31",
    "natureOfReport": "Standalone",
    "levelOfRounding": "Lakhs",
    "facts": [
      {
        "concept": "in-ca:EquityShareCapital",
        "value": "41783000",
        "period": "instant_cy",
        "unit": "INR",
        "decimals": "-5"
      }
    ],
    "tableBlocks": []
  }
  ```
* **Response**:
  ```json
  {
    "status": "success",
    "data": {
      "xml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<xbrli:xbrl xmlns:in-ca=\"...\">...",
      "factCount": 1,
      "filename": "AOC4_XBRL_U72200KA2010PLC123456_2025-26.xml"
    }
  }
  ```

---

## 7. Deep Dive: Critical Architectural Solutions (Addressing Edge Cases)

### 7.1 Full In-App Validation Engine vs. Simple Difference Counter

The in-app engine does **NOT** just check whether `Assets - Liabilities = 0`.
It simultaneously evaluates the complete **1,351 MCA Ind AS Business Rules** in real time:

- **Conditional Mandatory Checks**: If Paid-up capital > 0, it validates whether the Share Capital Note is tagged (`SR-L1001-1`).
- **Calculation Linkbases**: Checks that every aggregate equals the sum of its children.
- **Rollups**: Validates parent-member rollups in dimensional tables.
- **Problems Panel**: Surfaces issues with exact MCA rule IDs, severity (`ERROR`/`WARNING`), affected row, and 1-click Locate/Fix.
- **Live Reconciliation Counter**: The bottom bar shows `Balance Sheet Diff = 0 | Net Profit Diff = 0` for instant visual sanity.

### 7.2 The Heading-Path Hierarchy Solution (Resolving "Share Capital" under "Equity")

* **The Problem**: In client Excel sheets, Row 7 is `EQUITY & LIABILITIES` (Heading), Row 8 is `Share Holders' Funds` (Sub-heading), and Row 9 is `Share Capital` (Value row). In Ind AS taxonomy, the element is `in-ca:EquityShareCapital`. If search runs on `"Share Capital"` alone without context, it produces ambiguous or wrong matches.
* **The Solution — Breadcrumb Context Enrichment**:
  1. The layout parser tracks indentation and rows without amount figures as **Active Breadcrumbs**:
     `current_path = ["Equity & Liabilities", "Share Holders' Funds"]`
  2. For Row 9, the query sent to Hybrid Retrieval is NOT `"Share Capital"`. It is:
     `"Equity & Liabilities > Share Holders' Funds > Share Capital"`
  3. The semantic embedding and BM25 scorer match this compound hierarchy against taxonomy labels and presentation trees. `in-ca:EquityShareCapital` scores **0.98** (near-perfect match) without needing any hardcoded company-specific rules.

### 7.3 How Notes Tagging ([E]) and Tables ([T]) Work in Reality

Corporate financial statements contain **two fundamentally different categories of Notes**, which must be handled through distinct pipelines:

```
                          ┌───────────────────────────┐
                          │   Financial Notes (MCA)   │
                          └─────────────┬─────────────┘
                                        │
           ┌────────────────────────────┴───────────────────────────┐
           ▼                                                        ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────────────┐
│  Type A: Quantitative Tables ([T])   │  │  Type B: Narrative Text Blocks ([E]) │
├──────────────────────────────────────┤  ├──────────────────────────────────────┤
│ • Examples: Note 2.1 (Share classes) │  │ • Examples: Accounting Policies,     │
│   Note 2.3 (Borrowings breakdown)    │  │   Auditor Report, Director Report,   │
│   Note 4 (PPE Schedule)              │  │   Contingent liabilities description │
│ • Contains NUMERIC SCHEDULES.        │  │ • Contains FORMATTED PARAGRAPHS.     │
│ • MUST RECONCILE with B/S line item  │  │ • No arithmetic calculation. MCA     │
│   (Balance Sheet Diff = 0).          │  │   expects HTML/Text snippets (<p>).  │
│ • UI: Dedicated Table Modal ([T])    │  │ • UI: Notes Tagging View ([E])       │
└──────────────────────────────────────┘  └──────────────────────────────────────┘
```

#### A. Narrative Notes Tagging ([E] Text Blocks):

1. **Document Section Chunker**:
   - The backend splits uploaded narrative reports (Director's Report, Auditor's Report, Accounting Policies) into semantic chunks based on headings (`1. Significant Accounting Policies`, `1.2 Revenue Recognition`, `2. Corporate Information`).
2. **Dense Vector Retrieval**:
   - Chunks are matched against Ind AS taxonomy `[Text Block]` concepts using Qdrant embeddings (`all-mpnet-base-v2`) and BM25:
     - `"The company recognizes revenue when control of goods is transferred..."` ──> `in-ca:DescriptionOfAccountingPolicyForRevenueRecognitionExplanatory` (Score: 0.98).
     - `"These financial statements are prepared in accordance with Ind AS..."` ──> `in-ca:DescriptionOfAccountingPolicyForBasisOfPreparationOfFinancialStatementsExplanatory` (Score: 0.99).
3. **Pre-Highlighted Review UI**:
   - In Webtel, the accountant must manually highlight text paragraphs with a mouse and double-click the taxonomy concept.
   - In our system, the CA opens the **Notes Tagging view** to find paragraphs **already highlighted in blue with AI-suggested concepts attached**.
   - The CA clicks **[Accept All Suggested Notes (95%+)]**, completing hours of narrative tagging in seconds.

#### B. Quantitative Schedules ([T] Dimensional Tables):

1. **Schedule Extraction**:
   - The schedule under Note 2.1 contains authorized/issued share counts and par values.
   - The Table Suggester maps these figures to `in-ca:ClassesOfEquityShareCapitalTable`.
2. **Automated Reconciliation**:
   - The engine checks whether `Issued Shares × Par Value == Balance Sheet Line (3,000,000)`.
   - If equal: Difference = 0, automatically verified (Green).
   - If unequal: Difference != 0, flagged in **RED** inside the dedicated Table Modal for CA review.
3. **Rule-Driven Auto-Zero Filling**:
   - Columns with active values run `fillTableMandatoryZeros`, populating required non-reported zeros to prevent MCA rule failures without requiring manual user typing.

---

### 7.4 Architecture Options Evaluation & Selection

| Option             | Description                                      | Verdict                                    | Reason                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------ | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Option 1** | Monolithic Pure JS (Desktop App + AI in Node.js) | ❌ Rejected                                | Heavy vector embeddings and neural reranking in Node.js freeze the UI. Crackable client licensing. Lack of rich Python data/ML ecosystem.                                              |
| **Option 2** | Client-Server (Electron UI + FastAPI Backend)    | ✅ **Selected**                      | Clean separation of concerns. Client financial data stays confidential in local `.axbrl`/SQLite. Centralized rule updates without app reinstalls. SaaS-ready for browser deployment. |
| **Option 3** | Arelle as Core Engine                            | ❌ Rejected as Core (Used for Syntax Only) | Arelle validates XBRL 2.1 XML syntax, but has ZERO knowledge of MCA's 1,351 Indian business rules. Used strictly as a background conformance validator.                                |

---

### 7.5 Complete Gallery of Webtel webXBRL Reference Screenshots (Single-Screen Views)

All reference screenshots have been extracted and saved as **individual, high-resolution (1280×720) standalone images** in [`docs/ui/`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui) for UI design guidance:

| File Name                                                                                                                                    | Screen / Feature                      | Description                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-financial-tagging-balance-sheet.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/01-financial-tagging-balance-sheet.png) | **Balance Sheet Tagging**       | Excel on left, Ind AS taxonomy on right, live reconciliation footer (`CY Diff = 0`).                                                                     |
| [`02-both-statements-and-notes-tree.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/02-both-statements-and-notes-tree.png)   | **Taxonomy Tree & Notes**       | Expanded taxonomy showing `[E]` Text Block and `[L]` Link tags with 3,000,000 unreconciled difference counter.                                         |
| [`03-process-flow-dashboard.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/03-process-flow-dashboard.png)                   | **Process Flow Dashboard**      | Overall software flow: Master Entry $\rightarrow$ Document Upload $\rightarrow$ Financial Tagging $\rightarrow$ Validation $\rightarrow$ Generate. |
| [`04-company-master-cin-prefill.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/04-company-master-cin-prefill.png)           | **Company Master & CIN**        | Auto-prefill company details via CIN directly from the MCA portal.                                                                                         |
| [`05-director-master-setup.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/05-director-master-setup.png)                     | **Director & Auditor Master**   | DIN/PAN based prefilling of signatories and statutory auditors.                                                                                            |
| [`06-document-master-upload.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/06-document-master-upload.png)                   | **Document Master**             | Upload and cataloging of separate Excel files (Balance Sheet, P&L, Notes, Reports).                                                                        |
| [`07-f9-column-gap-setting.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/07-f9-column-gap-setting.png)                     | **F9 Column Gap Utility**       | Defining column offset between Current Year and Previous Year for 1-click tagging.                                                                         |
| [`08-cell-options-context-menu.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/08-cell-options-context-menu.png)             | **Right-Click Context Menu**    | Add Footnote (creates underlined cell), Go to Linked Cell, Change Sign (+/-), View Properties.                                                             |
| [`09-notes-tagging-text-blocks.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/09-notes-tagging-text-blocks.png)             | **Notes Tagging UI**            | Dedicated narrative view: Left shows formatted text with blue highlighted paragraphs; right shows `[Text Block]` disclosure concepts.                    |
| [`10-table-tagging-dedicated-window.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/10-table-tagging-dedicated-window.png)   | **Dedicated Table Window**      | PPE schedule table modal with asset rows on left, gross block/depreciation column groups, and live B/S reconciliation.                                     |
| [`11-table-show-hide-members-modal.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/11-table-show-hide-members-modal.png)     | **Show/Hide Members Dialog**    | Pop-up tree allowing the user to uncheck non-applicable members (e.g. "Other building") or add custom members.                                             |
| [`12-table-difference-reconciliation.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/12-table-difference-reconciliation.png) | **Table Reconciliation Footer** | `Value as per B/S vs Table Value vs Difference` (Turns **RED** when unreconciled).                                                                 |
| [`13-mca-validation-colored-errors.png`](file:///home/vanshsharma/projects/xbrl_autopilot/docs/ui/13-mca-validation-colored-errors.png)     | **Official MCA Error Reports**  | Color-coded error list (Blue = Line Item, Orange = Member, Cyan = Table) with 1-click jump back to webXBRL.                                                |

---

## 8. Code Implementation Blueprint: How to Code the New Components

### 8.1 Workbook Schema & Column Mapper (`src/services/workbook/schema_detector.py`)

* **Purpose**: Automatically scans the sheets of an uploaded `.xlsx` or `.xls` file and assigns high-confidence roles to each sheet and column.
* **Algorithm**:
  1. **Sheet Role Classifier**:
     - Scans sheet names against keyword dictionary (`balance sheet`, `bs`, `profit`, `pl`, `statement of profit`, `notes`, `ppe`, `fixed asset`, `trial balance`, `ledger`).
     - Inspects top 10 rows: checks for keywords like `"EQUITY AND LIABILITIES"`, `"ASSETS"`, `"Revenue from operations"`.
     - Assigns role: `balance_sheet`, `profit_loss`, `notes`, `table_schedule`, or `ignored`.
  2. **Column Role Detector**:
     - Scans header rows (rows 1–10) looking for date patterns (`31-03-2026`, `31st March 2026`, `2026`).
     - Detects label/particulars column (column with highest density of strings/alphabetical characters).
     - Detects note reference column (column with numbers matching `1`, `2.1`, `3` or header `"Note"`).
     - Detects CY column (latest date) and PY column (preceding year date).

### 8.2 Notes Tagging Pipeline (`src/services/tagging/notes_chunker.py` & `notes_suggest.py`)

* **Purpose**: Converts narrative reports into pre-highlighted, auto-tagged text blocks.
* **Algorithm**:
  1. **Document Chunker (`notes_chunker.py`)**:
     - Splits text by markdown or document headers (`#`, `##`, all-caps lines like `DIRECTORS' REPORT`, numbered policies like `1.1 Basis of preparation`).
     - Records character offsets: `start_offset`, `end_offset`, `heading_context`, and `paragraph_text`.
  2. **Vector Matcher (`notes_suggest.py`)**:
     - Filters Qdrant collection `ind_as_taxonomy` specifically for concepts where `dataType == "textBlockItemType"`.
     - Computes cosine similarity between chunk embedding and `[Text Block]` concept embeddings.
     - Returns top match (e.g. `in-ca:DescriptionOfAccountingPolicyForRevenueRecognitionExplanatory`) with confidence score.
  3. **Frontend Rendering (`ui/src/components/NotesTaggingView.tsx`)**:
     - Renders document with CSS highlights:
       ```css
       .xap-note-highlight-suggested { background-color: rgba(59, 130, 246, 0.15); border-left: 3px solid #3b82f6; }
       .xap-note-highlight-approved { background-color: rgba(34, 197, 94, 0.15); border-left: 3px solid #22c55e; }
       ```
     - Clicking any highlighted paragraph displays the tag chip with `[Accept ✓]` or `[Change concept]`.
     - A top toolbar provides `[Accept All ≥ 90% (n)]` to tag all narrative disclosures in 1 click.

### 8.3 Dedicated Table Tagging Engine (`src/services/tagging/tables_suggest.py`)

* **Purpose**: Manages multi-dimensional schedules in dedicated modal windows with live B/S reconciliation.
* **Algorithm**:
  1. **Table Trigger**: When a concept with indicator `[T]` (e.g. `in-ca:PropertyPlantAndEquipment`) is opened or double-clicked, the UI launches `TableModal.tsx`.
  2. **Member Extractor (`tables_suggest.py`)**:
     - Loads standard taxonomy members for the table axis (e.g. `LandMember`, `BuildingsMember`, `PlantAndEquipmentMember`).
     - Matches row labels from the client's schedule to taxonomy members using exact + fuzzy string matching.
     - Unmatched user rows are assigned to generic custom placeholders (`OtherPropertyPlantAndEquipmentMember`).
  3. **Live B/S Reconciliation**:
     $$
     \text{Difference} = \text{Balance Sheet Concept Amount} - \sum(\text{Closing Carrying Amount of all Active Members})
     $$

     - If $\text{Difference} == 0$: Status indicator displays **GREEN** (`Reconciled`).
     - If $\text{Difference} \neq 0$: Status indicator turns **RED** (`Difference: ₹X`), pinpointing the exact gap for the CA.
  4. **Auto-Zero Fill (`fillTableMandatoryZeros`)**:
     - Empty cells in any column that has active figures are automatically populated with `0` upon confirmation, satisfying MCA mandatory reporting rules.
