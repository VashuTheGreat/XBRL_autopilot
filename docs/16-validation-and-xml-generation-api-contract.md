# 16. Validation Architecture & XML Generation API Contract

> **Scope**: Specification of the 2-Tier Validation Model, the single-call Backend XML Generator, the exact JSON Request/Response schemas, and the 100% dynamic implementation in `t.py`.  
> **Source of Truth**: `knowledge_base/ind_as_knowledge_base.json` (5,647 concepts, 37 calculation ELRs, 225 mandatory rules, 211 non-negative concepts).  
> **Implementation Reference**: [`t.py`](../t.py).

---

## 1. Executive Summary & Design Principles

In traditional MCA filing desktop tools, users suffered from cryptic Java validation errors discovered only after submitting the file to the MCA validation utility. In **XBRL Autopilot**, validation is proactive, transparent, and multi-tiered:

1. **Client-Side (Frontend Instant Feedback)**: Zero-latency (0.1ms) calculation checks run locally in the browser/React state as users edit numbers, providing instant visual feedback (green check / red border) without spamming the backend API.
2. **Backend Single-Call Gatekeeper (`/api/v1/export/xml`)**: When the user clicks **"Generate MCA AOC-4 XBRL"**, the frontend sends a single consolidated JSON payload. The backend validator (`IndASValidator` in `t.py`) executes statutory validation gates directly against `ind_as_knowledge_base.json`.
   - **If valid**: Instantly compiles and outputs the valid MCA AOC-4 XML instance document.
   - **If invalid**: Blocks XML generation and returns structured, actionable error items with exact concept names, expected values, calculated sums, and diffs.
3. **ZERO Hardcoding Principle**:
   > [!IMPORTANT]
   > **No Hardcoded Concepts or Whitelists**:  
   > - The validator class (`IndASValidator`) accepts `kb_path: Path | str` dynamically in `__init__`.
   > - Mandatory fields are loaded dynamically by ELR from `self.kb["businessRules"]["mandatoryByELR"]` (e.g., `700300` for General Company Info, `700400` for Auditor Report).
   > - Statement roots (`ind-as:Assets`, `ind-as:EquityAndLiabilities`, `ind-as:ProfitLossForPeriod`) are discovered dynamically as topological tree roots (`parents - children`) of calculation ELRs `110000` and `210000`.
   > - Non-negative constraints are loaded directly from `self.kb["businessRules"]["nonNegativeConcepts"]` (the 211 concepts marked `"Should be greater than or equal to zero"` by MCA). There is **ZERO** hardcoded `exempt_negative` whitelist; naturally signed concepts (inventory changes, profit/loss) are simply not in the non-negative set and are allowed to be negative.
4. **No Redundant Fields (`noteNo` Omission)**:
   > [!NOTE]
   > **Why `noteNo` is NOT in the JSON payload or the XBRL XML**:  
   > In statutory Schedule III accounting balance sheets, "Note No" (e.g., *Note 3*, *Note 7*) is purely a visual cross-reference for human readers. In official MCA Ind AS XBRL instance documents, **there is NO concept, tag, or attribute for `noteNo`**. Line item facts are tagged purely as `<ind-as:Inventories contextRef="CY_Instant" unitRef="INR" decimals="0">4500000</ind-as:Inventories>`. Narrative disclosures are tagged separately as distinct explanatory text blocks. Omitting `noteNo` keeps the API contract pure, canonical, and 100% compliant with XBRL specifications.

---

## 2. 2-Tier Validation Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: FRONTEND (Instant UI State - 0.1ms)                                 │
│ - Live calculation rollups using cached KB calculation trees (37 ELRs)      │
│ - Instant Balance Sheet check: Assets == Equity + Liabilities               │
│ - Instant visual cues: Red border on calculation discrepancies              │
│ - Real-time net block calculation in PPE schedules                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                         Click "Generate XBRL XML"
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ TIER 2: BACKEND GATEKEEPER (/api/v1/export/xml or t.py)                     │
│ Validates payload dynamically against ind_as_knowledge_base.json:           │
│  ├─ Gate 1: Mandatory Company Info (dynamically loaded from ELR 700300)     │
│  ├─ Gate 2: Statutory Signatories (Min 2 Directors with 8-digit DIN)       │
│  ├─ Gate 3: Mandatory Statement Roots (discovered from calculation roots)   │
│  ├─ Gate 4: Calculation Tree Integrity across all 37 ELRs (1 INR tolerance) │
│  ├─ Gate 5: Balance Sheet Hard Balancing (Assets == Equity + Liabilities)   │
│  ├─ Gate 6: Non-Negative Constraints (211 MCA concepts, ZERO hardcoding)    │
│  └─ Gate 7: PPE 2D Multi-dimensional Schedule Rollforward Reconciliations   │
└──────────────────────┬───────────────────────────────┬──────────────────────┘
                       │                               │
                [Any Fatal Errors?]                    │ [0 Errors]
                       │                               │
                       ▼                               ▼
     ┌───────────────────────────────────┐   ┌────────────────────────────────┐
     │ ❌ BLOCKED: 422 Unprocessable      │   │ ✅ PASSED: 200 OK              │
     │ Returns JSON array of actionable  │   │ Deterministic XbrlXmlGenerator │
     │ validation errors with diffs      │   │ compiles MCA AOC-4 XBRL XML    │
     └───────────────────────────────────┘   └────────────────────────────────┘
```

---

## 3. Dynamic Backend Validation Gates (`IndASValidator`)

Implemented in [`t.py`](../t.py):

| Gate | Validation Rule | Severity | Source in Knowledge Base |
|---|---|---|---|
| **Gate 1** | **Mandatory Company Information** | `ERROR` | `businessRules["mandatoryByELR"]["700300"]` (CIN, Name, Period Dates, Currency, Rounding, etc.) |
| **Gate 2** | **Statutory Signatories** | `ERROR` | Section 134(1) Companies Act rule: minimum 2 director signatories with valid 8-digit DINs. |
| **Gate 3** | **Mandatory Statement Roots** | `ERROR` | Dynamic tree roots (`parents - children`) of calculation ELRs `110000` (Balance Sheet) & `210000` (P&L). |
| **Gate 4** | **Calculation & Math Summation** | `ERROR` | `kb["calculation"]` across all 37 ELRs: $\sum (\text{child} \times \text{weight}) == \text{parent}$ ($\pm 1.0$ INR). |
| **Gate 5** | **Balance Sheet Hard Balancing** | `CRITICAL` | Dynamically compares debit root and credit root of ELR `110000` ($\text{diff} \le 1.0\text{ INR}$). |
| **Gate 6** | **Non-Negative Constraints** | `ERROR` | `businessRules["nonNegativeConcepts"]` (211 concepts). Non-negative only if required by MCA. |
| **Gate 7** | **PPE 2D Schedule Reconciliations** | `ERROR` | Gross rollforward $(Open + Add - Disp = Close)$, Dep $(Open + Year - Disp = Close)$, Net Block $(Gross - Dep = Net)$. |

---

## 4. API Request Payload Specification

### Endpoint
`POST /api/v1/export/xml` (or `POST /api/v1/validate`)

### Request JSON Schema
```json
{
  "meta": {
    "taxonomy": "ind_as",
    "nature": "Standalone",
    "startDate": "2025-04-01",
    "endDate": "2026-03-31",
    "unit": "INR",
    "decimals": "0"
  },
  "master": {
    "company": {
      "in-ca:CorporateIdentityNumber": "U72200DL2018PTC123456",
      "in-ca:NameOfCompany": "Helmier Technologies Private Limited",
      "in-ca:PermanentAccountNumberOfEntity": "AAACH1234K",
      "in-ca:AddressOfRegisteredOfficeOfCompany": "Connaught Place, New Delhi",
      "in-ca:TypeOfIndustry": "Commercial and Industrial",
      "in-ca:DateOfBoardMeetingWhenFinalAccountsWereApproved": "2026-09-05",
      "in-ca:DateOfStartOfReportingPeriod": "2025-04-01",
      "in-ca:DateOfEndOfReportingPeriod": "2026-03-31",
      "in-ca:NatureOfReportStandaloneConsolidated": "Standalone",
      "in-ca:ContentOfReport": "Financial Statements",
      "in-ca:DescriptionOfPresentationCurrency": "INR",
      "in-ca:LevelOfRoundingUsedInFinancialStatements": "Exact",
      "in-ca:WhetherCompanyIsMaintainingBooksOfAccountAndOtherRelevantBooksAndPapersInElectronicForm": "No",
      "ind-as:DescriptionOfNatureOfFinancialStatements": "Standalone"
    },
    "auditor": {
      "in-ca:CategoryOfAuditor": "Auditor's firm",
      "in-ca:NameOfAuditFirm": "R. K. Sharma & Associates",
      "in-ca:NameOfAuditorSigningReport": "CA Rajesh Sharma",
      "in-ca:MembershipNumberOfAuditor": "087654",
      "in-ca:AddressOfAuditors": "Connaught Place, New Delhi - 110001",
      "in-ca:PermanentAccountNumberOfAuditorOrAuditorsFirm": "AAAFR1234K",
      "in-ca:DateOfSigningAuditReportByAuditors": "2026-09-05",
      "in-ca:DateOfSigningOfBalanceSheetByAuditors": "2026-09-05"
    },
    "signatories": [
      {
        "din": "01234567",
        "firstName": "John",
        "lastName": "Doe",
        "designation": "Managing Director",
        "signingDate": "2026-09-05"
      },
      {
        "din": "07654321",
        "firstName": "Jane",
        "lastName": "Doe",
        "designation": "Director",
        "signingDate": "2026-09-05"
      }
    ]
  },
  "statements": {
    "balanceSheet": [
      {"concept": "ind-as:PropertyPlantAndEquipment", "cy": 14500000, "py": 12000000},
      {"concept": "ind-as:CapitalWorkInProgress", "cy": 1200000, "py": 800000},
      {"concept": "ind-as:NoncurrentAssets", "cy": 15700000, "py": 12800000},
      {"concept": "ind-as:Inventories", "cy": 4500000, "py": 3800000},
      {"concept": "ind-as:TradeReceivablesCurrent", "cy": 7800000, "py": 6200000},
      {"concept": "ind-as:CashAndCashEquivalents", "cy": 3200000, "py": 2100000},
      {"concept": "ind-as:CurrentFinancialAssets", "cy": 11000000, "py": 8300000},
      {"concept": "ind-as:CurrentAssets", "cy": 15500000, "py": 12100000},
      {"concept": "ind-as:Assets", "cy": 31200000, "py": 24900000},
      {"concept": "ind-as:EquityShareCapital", "cy": 10000000, "py": 10000000},
      {"concept": "ind-as:OtherEquity", "cy": 15400000, "py": 10000000},
      {"concept": "ind-as:Equity", "cy": 25400000, "py": 20000000},
      {"concept": "ind-as:TradePayablesCurrent", "cy": 5800000, "py": 4900000},
      {"concept": "ind-as:CurrentLiabilities", "cy": 5800000, "py": 4900000},
      {"concept": "ind-as:Liabilities", "cy": 5800000, "py": 4900000},
      {"concept": "ind-as:EquityAndLiabilities", "cy": 31200000, "py": 24900000}
    ],
    "profitLoss": [
      {"concept": "ind-as:RevenueFromOperations", "cy": 52000000, "py": 41000000},
      {"concept": "ind-as:OtherIncome", "cy": 1200000, "py": 850000},
      {"concept": "ind-as:Income", "cy": 53200000, "py": 41850000},
      {"concept": "ind-as:CostOfMaterialsConsumed", "cy": 24000000, "py": 19500000},
      {"concept": "ind-as:ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade", "cy": -1500000, "py": -800000},
      {"concept": "ind-as:EmployeeBenefitExpense", "cy": 8500000, "py": 6800000},
      {"concept": "ind-as:FinanceCosts", "cy": 950000, "py": 820000},
      {"concept": "ind-as:DepreciationDepletionAndAmortisationExpense", "cy": 2100000, "py": 1800000},
      {"concept": "ind-as:OtherExpenses", "cy": 11450000, "py": 9200000},
      {"concept": "ind-as:Expenses", "cy": 45500000, "py": 37320000},
      {"concept": "ind-as:ProfitBeforeTax", "cy": 7700000, "py": 4530000},
      {"concept": "ind-as:CurrentTax", "cy": 1950000, "py": 1150000},
      {"concept": "ind-as:DeferredTax", "cy": 520000, "py": 380000},
      {"concept": "ind-as:ProfitLossForPeriod", "cy": 5230000, "py": 3000000}
    ]
  },
  "tables": [
    {
      "table": "ind-as:DisclosureOfPropertyPlantAndEquipmentTable",
      "axis": "ind-as:ClassesOfPropertyPlantAndEquipmentAxis",
      "rows": [
        {
          "member": "ind-as:PlantAndEquipmentMember",
          "grossOpening": 10000000,
          "grossAdditions": 2500000,
          "grossDisposals": 0,
          "grossClosing": 12500000,
          "depOpening": 2000000,
          "depForYear": 1000000,
          "depDisposals": 0,
          "depClosing": 3000000,
          "netCurrentYear": 9500000,
          "netPreviousYear": 8000000
        },
        {
          "member": "ind-as:FurnitureAndFixturesMember",
          "grossOpening": 2000000,
          "grossAdditions": 500000,
          "grossDisposals": 0,
          "grossClosing": 2500000,
          "depOpening": 600000,
          "depForYear": 250000,
          "depDisposals": 0,
          "depClosing": 850000,
          "netCurrentYear": 1650000,
          "netPreviousYear": 1400000
        }
      ]
    }
  ],
  "notes": [
    {
      "concept": "ind-as:DisclosureOfCorporateInformationNotesAndOtherExplanatoryInformation",
      "content": "Helmier Technologies Private Limited is domiciled in India and incorporated under the Companies Act 2013."
    },
    {
      "concept": "ind-as:DisclosureOfSummaryOfSignificantAccountingPoliciesExplanatory",
      "content": "Financial statements are prepared under Ind AS notified under Section 133 of the Companies Act 2013."
    }
  ]
}
```

---

## 5. API Response Specifications

### Case A: Success Response (`200 OK`)
When all dynamic gates pass (0 blocking `ERROR` or `CRITICAL` levels):
```json
{
  "status": "SUCCESS",
  "canExport": true,
  "fileName": "MCA_AOC4_TEST_CLEAN.xml",
  "fileSizeKb": 17.97,
  "factsCount": 180,
  "contextsCount": 10,
  "validationSummary": {
    "blockingErrors": 0,
    "warnings": 0
  },
  "downloadUrl": "/api/v1/download/MCA_AOC4_TEST_CLEAN.xml",
  "xmlContent": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<xbrli:xbrl xmlns:in-ca=\"http://www.mca.gov.in/in-ca/2016-03-31\" xmlns:ind-as=\"http://www.mca.gov.in/ind-as/2016-03-31\" ...>...</xbrli:xbrl>"
}
```

### Case B: Validation Failure Response (`422 Unprocessable Entity`)
When calculation errors, balance sheet imbalances, missing mandatory concepts, or negative value violations are detected:
```json
{
  "status": "VALIDATION_FAILED",
  "canExport": false,
  "errorsCount": 3,
  "warningsCount": 0,
  "errors": [
    {
      "level": "ERROR",
      "type": "CALCULATION_MISMATCH",
      "elr": "210000",
      "parent": "ind-as:Income",
      "expected": 99999999,
      "calculated": 53200000,
      "diff": 46799999,
      "message": "Math mismatch in ELR 210000: Income (99,999,999) != sum of children (53,200,000) [Diff: 46,799,999]"
    },
    {
      "level": "CRITICAL",
      "type": "BS_OUT_OF_BALANCE",
      "assets": 50000000,
      "equityAndLiabilities": 31200000,
      "diff": 18800000,
      "message": "Balance Sheet is out of balance! Total Assets (50,000,000) != Total Equity and Liabilities (31,200,000) [Diff: 18,800,000]"
    },
    {
      "level": "ERROR",
      "type": "NEGATIVE_VALUE_NOT_PERMITTED",
      "concept": "ind-as:PropertyPlantAndEquipment",
      "value": -500000,
      "message": "MCA statutory rule violation: PropertyPlantAndEquipment (ind-as:PropertyPlantAndEquipment) cannot be negative (reported: -500,000)"
    }
  ]
}
```

---

## 6. Test Suite Verification (`t.py`)

Run the verified test suite with:
```bash
python3 t.py
```

### Execution Results:
```text
================================================================================
🚀 DYNAMIC IND AS VALIDATION & DETERMINISTIC XML GENERATION TEST (t.py)
   ZERO HARDCODING: Dynamic rules loaded from knowledge_base/ind_as_knowledge_base.json
================================================================================

--- TEST 1: VALIDATING CLEAN PAYLOAD ---
Validation Result: ✅ PASSED (0 Blocking Errors)
Compiling XML...
✅ XML Successfully Generated: output/MCA_AOC4_TEST_CLEAN.xml
   Size: 17.97 KB | Elements: 180

--- TEST 2: DETECTING MATHEMATICAL CALCULATION MISMATCH ---
Validation Result: ❌ BLOCKED AS EXPECTED
  [ERROR] CALCULATION_MISMATCH: Math mismatch in ELR 210000: Income (99,999,999) != sum of children (53,200,000) [Diff: 46,799,999]

--- TEST 3: DETECTING BALANCE SHEET OUT OF BALANCE ---
Validation Result: ❌ BLOCKED AS EXPECTED
  [ERROR] CALCULATION_MISMATCH: Math mismatch in ELR 110000: Assets (50,000,000) != sum of children (31,200,000) [Diff: 18,800,000]
  [CRITICAL] BS_OUT_OF_BALANCE: Balance Sheet is out of balance! Total Assets (50,000,000) != Total Equity and Liabilities (31,200,000) [Diff: 18,800,000]

--- TEST 4: DETECTING VIOLATION OF DYNAMIC NON-NEGATIVE CONSTRAINT ---
Validation Result: ❌ BLOCKED AS EXPECTED
  [ERROR] NEGATIVE_VALUE_NOT_PERMITTED: MCA statutory rule violation: PropertyPlantAndEquipment (ind-as:PropertyPlantAndEquipment) cannot be negative (reported: -500,000)

================================================================================
🎉 ALL 4 DYNAMIC TESTS PASSED! IndASValidator has ZERO hardcoded concepts.
================================================================================
```
