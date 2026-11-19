import json
import os
import io
import re
import html
import pandas as pd
from pathlib import Path
from contextlib import redirect_stdout, redirect_stderr

def create_and_run_notebook():
    notebook_path = "/home/vanshsharma/projects/xbrl_autopilot/notebooks/xbrl_pipeline_master.ipynb"
    
    cells = []
    exec_globals = {}
    
    def add_md(content):
        cells.append({
            "cell_type": "markdown",
            "metadata": {},
            "source": [line + "\n" for line in content.split("\n")]
        })
        
    def add_code(code_str, exec_count):
        f = io.StringIO()
        err_f = io.StringIO()
        try:
            with redirect_stdout(f), redirect_stderr(err_f):
                exec(code_str, exec_globals)
            out_str = f.getvalue()
        except Exception as e:
            import traceback
            out_str = f"Error during execution: {e}\n{traceback.format_exc()}\n{f.getvalue()}\n{err_f.getvalue()}"
            
        outputs = []
        if out_str.strip():
            outputs.append({
                "name": "stdout",
                "output_type": "stream",
                "text": [line + "\n" for line in out_str.split("\n")]
            })
            
        cells.append({
            "cell_type": "code",
            "execution_count": exec_count,
            "metadata": {},
            "outputs": outputs,
            "source": [line + "\n" for line in code_str.split("\n")]
        })

    # Cell 1: Intro Markdown
    add_md("""# 🚀 Ind AS MCA AOC-4 XBRL Autopilot: End-to-End Pipeline
### From Clean Canonical Spreadsheets $\\to$ Unified Vector DB $\\to$ Multi-Statement Auto-Tagging $\\to$ Deterministic XML Generation

This master notebook executes the entire end-to-end production architecture:
1. **Load Standard Canonical Sheets** (`CANONICAL_BS.xlsx`, `CANONICAL_PL.xlsx`, `CANONICAL_PPE_SCHEDULE.xlsx`, `CANONICAL_NOTES.xlsx`)
2. **Unified ChromaDB Indexing**: MCA Ind AS Taxonomy (5,647 concepts) with rich metadata (`in_bs`, `in_pl`, `in_cf`, `in_ppe`, `item_type`, `period_type`, `balance`, `is_abstract`)
3. **Balance Sheet Auto-Tagging**: Metadata-scoped querying (`where={"$and": [{"in_bs": True}, {"is_abstract": False}]}`)
4. **Profit & Loss Statement Auto-Tagging**: Scoped duration querying + automated live mathematical reconciliation checks
5. **Fixed Assets Schedule (PPE) 2D Table Auto-Tagging**:
   - Rows $\\to$ `ClassesOfPropertyPlantAndEquipmentAxis` Domain Members
   - Columns $\\to$ Rollforward Line Item Concepts
   - Live Math Checks: Horizontal Rollforward + Vertical Sums + Balance Sheet Note 5 cross-reconciliation (`Diff = 0.00`)
6. **Narrative Notes Tagging & XHTML Escaping**:
   - Narrative Disclosures $\\to$ `textBlockItemType`
   - Valid escaped XHTML paragraphs with typography styling
7. **Statutory Master Data Setup**:
   - Company Identification (CIN, Dates, Standalone)
   - Statutory Auditor Details (Firm, Auditor Name, Membership No, Address, Signing Date)
   - Board of Directors Signatories (DIN, Names, Designation, Signing Date)
8. **Final Deterministic MCA AOC-4 XBRL XML Assembly & Export**:
   - Assembling all contexts, units, facts, dimensional tables, and text blocks into valid MCA XBRL XML
   - Exported to `output/MCA_AOC4_STANDALONE_FILING.xml`""")

    # Cell 2: Code 1 - Load Canonical Sheets
    code_1 = """import os
from pathlib import Path
import pandas as pd
import numpy as np

# Robust path detection for both Jupyter kernel and terminal execution
CURRENT_DIR = Path(os.getcwd())
NOTEBOOK_DIR = CURRENT_DIR if CURRENT_DIR.name == "notebooks" else CURRENT_DIR / "notebooks"
PROJECT_ROOT = NOTEBOOK_DIR.parent
CANONICAL_DIR = NOTEBOOK_DIR / "canonical_sheets"
KB_PATH = PROJECT_ROOT / "knowledge_base" / "ind_as_knowledge_base.json"

# 1. Load Canonical Spreadsheets
df_bs = pd.read_excel(CANONICAL_DIR / 'CANONICAL_BS.xlsx')
df_pl = pd.read_excel(CANONICAL_DIR / 'CANONICAL_PL.xlsx')
df_ppe = pd.read_excel(CANONICAL_DIR / 'CANONICAL_PPE_SCHEDULE.xlsx')
df_notes = pd.read_excel(CANONICAL_DIR / 'CANONICAL_NOTES.xlsx')

print(f"✅ CANONICAL_BS.xlsx: {len(df_bs)} rows loaded")
print(f"✅ CANONICAL_PL.xlsx: {len(df_pl)} rows loaded")
print(f"✅ CANONICAL_PPE_SCHEDULE.xlsx: {len(df_ppe)} asset classes loaded")
print(f"✅ CANONICAL_NOTES.xlsx: {len(df_notes)} narrative notes loaded")
"""
    add_code(code_1, 1)

    # Cell 3: Markdown 2
    add_md("""## 2. Unified Vector DB Taxonomy Indexing (with Rich Metadata)
All 5,647 concepts are indexed into a single ChromaDB collection (`ind_as_taxonomy`).
Instead of multiple vector stores, we use metadata filters (`in_bs`, `in_pl`, `item_type`, etc.) for sub-millisecond retrieval.""")

    # Cell 4: Code 2 - Unified ChromaDB Indexing
    code_2 = """import json
import re
import chromadb
from chromadb.utils import embedding_functions

# Load Taxonomy Knowledge Base
with open(KB_PATH, 'r') as f:
    kb = json.load(f)

# Extract Presentation ELR sets for fast metadata scoping
elr_bs = set(arc['from'] for arc in kb['presentation'].get('110000', [])) | set(arc['to'] for arc in kb['presentation'].get('110000', []))
elr_pl = set(arc['from'] for arc in kb['presentation'].get('210000', [])) | set(arc['to'] for arc in kb['presentation'].get('210000', []))
elr_cf = set(arc['from'] for arc in kb['presentation'].get('310000', [])) | set(arc['to'] for arc in kb['presentation'].get('310000', []))
elr_ppe = set(arc['from'] for arc in kb['presentation'].get('400600', [])) | set(arc['to'] for arc in kb['presentation'].get('400600', []))

def clean_camel(name):
    return re.sub(r'([A-Z])', r' \\1', name).strip()

ids, docs, metadatas = [], [], []
for qname, c in kb['concepts'].items():
    name = c['name']
    lbl = c.get('labels', {}).get('label') or name
    split_name = clean_camel(name)
    doc_text = f"{lbl} | {split_name}"
    
    ids.append(qname)
    docs.append(doc_text)
    metadatas.append({
        'qname': qname,
        'name': name,
        'label': lbl,
        'item_type': c.get('type') or 'stringItemType',
        'period_type': c.get('periodType') or 'instant',
        'balance': c.get('balance') or 'none',
        'is_abstract': bool(c.get('abstract', False)),
        'in_bs': qname in elr_bs,
        'in_pl': qname in elr_pl,
        'in_cf': qname in elr_cf,
        'in_ppe': qname in elr_ppe
    })

print(f"Prepared {len(ids)} taxonomy concepts.")

# Initialize ChromaDB Client
client = chromadb.Client()
emb_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
    model_name='sentence-transformers/all-MiniLM-L6-v2'
)

# Create collection
if 'ind_as_taxonomy' in [c.name for c in client.list_collections()]:
    client.delete_collection('ind_as_taxonomy')

collection = client.create_collection(
    name='ind_as_taxonomy',
    embedding_function=emb_fn
)

# Index in batches of 500
batch_size = 500
for i in range(0, len(ids), batch_size):
    collection.add(
        ids=ids[i:i+batch_size],
        documents=docs[i:i+batch_size],
        metadatas=metadatas[i:i+batch_size]
    )

print(f"✅ Successfully indexed all {collection.count()} concepts into Unified ChromaDB!")
"""
    add_code(code_2, 2)

    # Cell 5: Markdown 3
    add_md("""## 3. Balance Sheet (`CANONICAL_BS.xlsx`) Auto-Tagging
We query the unified vector collection with filter:
`where={"$and": [{"in_bs": True}, {"is_abstract": False}]}`""")

    # Cell 6: Code 3 - BS Tagging
    code_3 = """# Auto-tag Balance Sheet
bs_results = []
for idx, row in df_bs.iterrows():
    query_text = str(row['Line_Item'])
    res = collection.query(
        query_texts=[query_text],
        n_results=1,
        where={"$and": [{"in_bs": True}, {"is_abstract": False}]}
    )
    
    matched_qname = res['ids'][0][0]
    matched_name = res['metadatas'][0][0]['name']
    matched_lbl = res['metadatas'][0][0]['label']
    dist = res['distances'][0][0]
    
    bs_results.append({
        'Line_Item': row['Line_Item'],
        'Note_No': row['Note_No'],
        'Current_Year_Amount': row['Current_Year_Amount'],
        'Previous_Year_Amount': row['Previous_Year_Amount'],
        'XBRL_Concept': matched_name,
        'XBRL_Label': matched_lbl,
        'Cosine_Distance': round(dist, 4)
    })

df_bs_tagged = pd.DataFrame(bs_results)
print("=== BALANCE SHEET AUTO-TAGGING RESULTS ===")
for r in bs_results:
    print(f"{r['Line_Item'][:35]:<35} -> {r['XBRL_Concept']:<45} (dist: {r['Cosine_Distance']})")
"""
    add_code(code_3, 3)

    # Cell 7: Markdown 4
    add_md("""## 4. Profit & Loss (`CANONICAL_PL.xlsx`) Auto-Tagging & Math Checks
We query the unified collection with filter:
`where={"$and": [{"in_pl": True}, {"is_abstract": False}]}`
Then we perform automated mathematical reconciliation of all P&L equations.""")

    # Cell 8: Code 4 - PL Tagging & Math Checks
    code_4 = """# Auto-tag Profit & Loss
pl_results = []
for idx, row in df_pl.iterrows():
    query_text = str(row['Line_Item'])
    res = collection.query(
        query_texts=[query_text],
        n_results=1,
        where={"$and": [{"in_pl": True}, {"is_abstract": False}]}
    )
    
    matched_qname = res['ids'][0][0]
    matched_name = res['metadatas'][0][0]['name']
    matched_lbl = res['metadatas'][0][0]['label']
    dist = res['distances'][0][0]
    
    pl_results.append({
        'Line_Item': row['Line_Item'],
        'Note_No': row['Note_No'],
        'Current_Year_Amount': row['Current_Year_Amount'],
        'Previous_Year_Amount': row['Previous_Year_Amount'],
        'XBRL_Concept': matched_name,
        'XBRL_Label': matched_lbl,
        'Cosine_Distance': round(dist, 4)
    })

df_pl_tagged = pd.DataFrame(pl_results)

# Display tagging table
print("=== PROFIT & LOSS AUTO-TAGGING RESULTS ===")
for r in pl_results:
    print(f"{r['Line_Item'][:35]:<35} -> {r['XBRL_Concept']:<45} (dist: {r['Cosine_Distance']})")

# Live Mathematical Reconciliation Checks
print("\\n=== P&L MATHEMATICAL RECONCILIATION CHECKS ===")
amounts = dict(zip(df_pl_tagged['XBRL_Concept'], df_pl_tagged['Current_Year_Amount']))

# 1. Total Income Check
calc_income = amounts['RevenueFromOperations'] + amounts['OtherIncome']
diff_income = calc_income - amounts['Income']
print(f"Total Income Check: {amounts['RevenueFromOperations']} + {amounts['OtherIncome']} = {calc_income} | Sheet: {amounts['Income']} | Diff: {diff_income} ({'PASS' if diff_income==0 else 'FAIL'})")

# 2. Total Expenses Check
expense_keys = [
    'CostOfMaterialsConsumed',
    'ChangesInInventoriesOfFinishedGoodsWorkInProgressAndStockInTrade',
    'EmployeeBenefitExpense',
    'FinanceCosts',
    'DepreciationDepletionAndAmortisationExpense',
    'OtherExpenses'
]
calc_expenses = sum(amounts[k] for k in expense_keys)
diff_expenses = calc_expenses - amounts['Expenses']
print(f"Total Expenses Check: Sum = {calc_expenses} | Sheet: {amounts['Expenses']} | Diff: {diff_expenses} ({'PASS' if diff_expenses==0 else 'FAIL'})")

# 3. Profit Before Tax Check
calc_pbt = amounts['Income'] - amounts['Expenses']
diff_pbt = calc_pbt - amounts['ProfitBeforeTax']
print(f"Profit Before Tax Check: {amounts['Income']} - {amounts['Expenses']} = {calc_pbt} | Sheet: {amounts['ProfitBeforeTax']} | Diff: {diff_pbt} ({'PASS' if diff_pbt==0 else 'FAIL'})")

# 4. Profit for Period Check
calc_pat = amounts['ProfitBeforeTax'] - (amounts['CurrentTax'] + amounts['DeferredTax'])
diff_pat = calc_pat - amounts['ProfitLossForPeriod']
print(f"Profit For Period Check: {amounts['ProfitBeforeTax']} - ({amounts['CurrentTax']}+{amounts['DeferredTax']}) = {calc_pat} | Sheet: {amounts['ProfitLossForPeriod']} | Diff: {diff_pat} ({'PASS' if diff_pat==0 else 'FAIL'})")
"""
    add_code(code_4, 4)

    # Cell 9: Markdown 5
    add_md("""## 5. Property, Plant & Equipment (`CANONICAL_PPE_SCHEDULE.xlsx`) 2D Table Auto-Tagging & Math Checks
A 2D Schedule links:
- **Rows** $\\to$ `ClassesOfPropertyPlantAndEquipmentAxis` Domain Members (`domainItemType`)
- **Columns** $\\to$ Rollforward concepts (`PropertyPlantAndEquipment`, `Additions`, `Depreciation`, etc.)

We perform 3 rigorous reconciliations:
1. **Horizontal Rollforward**: $\\text{Gross Closing} = \\text{Gross Opening} + \\text{Additions} - \\text{Disposals}$ and $\\text{Dep Closing} = \\text{Dep Opening} + \\text{Dep For Year} - \\text{Dep Disposals}$
2. **Vertical Sum Integrity**: $\\sum \\text{Asset Classes} = \\text{Total Row}$ across all 10 columns
3. **Cross-Statement Balance Sheet Tie**: Balance Sheet Note 5 Net Block == Schedule Total Net Current Year.""")

    # Cell 10: Code 5 - PPE Tagging & Reconciliation
    code_5 = """# 1. Row Auto-Tagging (Asset Classes -> Domain Members)
ppe_rows_tagged = []
for idx, row in df_ppe.iterrows():
    ac = row['Asset_Class']
    res = collection.query(
        query_texts=[ac],
        n_results=1,
        where={"item_type": "domainItemType"}
    )
    matched_qname = res['ids'][0][0]
    matched_name = res['metadatas'][0][0]['name']
    matched_lbl = res['metadatas'][0][0]['label']
    dist = res['distances'][0][0]
    
    ppe_rows_tagged.append({
        'Asset_Class': ac,
        'XBRL_Member': matched_name,
        'Member_Label': matched_lbl,
        'Distance': round(dist, 4)
    })

print("=== PPE ASSET CLASS AUTO-TAGGING ===")
for r in ppe_rows_tagged:
    print(f"{r['Asset_Class'][:35]:<35} -> {r['XBRL_Member']:<40} (dist: {r['Distance']})")

# 2. Horizontal Rollforward Integrity Checks
print("\\n=== HORIZONTAL ROLLFORWARD CHECKS (GROSS & DEP) ===")
for idx, row in df_ppe.iterrows():
    ac = row['Asset_Class']
    
    # Gross check: Opening + Additions - Disposals == Closing
    calc_gross_close = row['Gross_Opening'] + row['Gross_Additions'] - row['Gross_Disposals']
    diff_gross = calc_gross_close - row['Gross_Closing']
    
    # Dep check: Opening + For Year - Disposals == Closing
    calc_dep_close = row['Dep_Opening'] + row['Dep_For_Year'] - row['Dep_Disposals']
    diff_dep = calc_dep_close - row['Dep_Closing']
    
    # Net CY check: Gross Closing - Dep Closing == Net CY
    calc_net_cy = row['Gross_Closing'] - row['Dep_Closing']
    diff_net_cy = calc_net_cy - row['Net_Current_Year']
    
    # Net PY check: Gross Opening - Dep Opening == Net PY
    calc_net_py = row['Gross_Opening'] - row['Dep_Opening']
    diff_net_py = calc_net_py - row['Net_Previous_Year']
    
    all_ok = (diff_gross == 0 and diff_dep == 0 and diff_net_cy == 0 and diff_net_py == 0)
    print(f"{ac[:30]:<30} | Gross Diff: {diff_gross:>3} | Dep Diff: {diff_dep:>3} | Net CY Diff: {diff_net_cy:>3} | {'PASS (Diff=0.00)' if all_ok else 'FAIL'}")

# 3. Vertical Sum Checks (Asset Classes Sum == Total Row)
print("\\n=== VERTICAL COLUMN SUM CHECKS ===")
total_row = df_ppe[df_ppe['Asset_Class'] == 'Total Property, Plant & Equipment'].iloc[0]
sub_df = df_ppe[df_ppe['Asset_Class'] != 'Total Property, Plant & Equipment']

cols_to_check = ['Gross_Opening', 'Gross_Additions', 'Gross_Disposals', 'Gross_Closing', 'Dep_Opening', 'Dep_For_Year', 'Dep_Disposals', 'Dep_Closing', 'Net_Current_Year', 'Net_Previous_Year']
for c in cols_to_check:
    sum_val = sub_df[c].sum()
    total_val = total_row[c]
    diff = sum_val - total_val
    print(f"{c:<20} | Sum: {sum_val:>12} | Total: {total_val:>12} | Diff: {diff:>2} ({'PASS' if diff==0 else 'FAIL'})")

# 4. Cross-Statement Tie: Balance Sheet Note 5 <-> PPE Schedule Total
bs_ppe_val = df_bs[df_bs['Line_Item'].str.contains('Property', case=False)]['Current_Year_Amount'].values[0]
ppe_total_net_cy = total_row['Net_Current_Year']
diff_cross = bs_ppe_val - ppe_total_net_cy

print(f"\\n=== CROSS-STATEMENT RECONCILIATION ===")
print(f"Balance Sheet (Line 1, Note 5) PPE Net Block : ₹{bs_ppe_val:,}")
print(f"PPE Schedule Total Row Net Current Year      : ₹{ppe_total_net_cy:,}")
print(f"Difference                                   : ₹{diff_cross:,.2f} ({'PERFECT MATCH 0.00' if diff_cross==0 else 'FAIL'})")
"""
    add_code(code_5, 5)

    # Cell 11: Markdown 6 - Narrative Notes Tagging & XHTML Escaping
    add_md("""## 6. Narrative Notes (`CANONICAL_NOTES.xlsx`) Auto-Tagging & XHTML Escaping
Narrative disclosures (Accounting Policies, Contingent Liabilities, Related Party Details) are extracted from signed Word/PDF annual reports.

In MCA AOC-4 XBRL:
1. They map to `type="textBlockItemType"` concepts with `periodType="duration"`.
2. Content must be formatted as **valid escaped XHTML** (`<p style='...'>...</p>`), preventing XML parser breakage while preserving readable typography.""")

    # Cell 12: Code 6 - Notes Tagging & XHTML Escaping
    code_6 = """import html

# Auto-tag Narrative Notes
notes_results = []
for idx, row in df_notes.iterrows():
    title = str(row['Note_Title'])
    disc_type = str(row['Disclosure_Type'])
    
    # If disclosure type is Disclosures and title doesn't start with disclosure, qualify query
    if 'Disclosure' in disc_type and not title.lower().startswith('disclosure'):
        query_text = f"Disclosure of {title}"
    else:
        query_text = title
        
    res = collection.query(
        query_texts=[query_text],
        n_results=1,
        where={"item_type": "textBlockItemType"}
    )
    
    matched_qname = res['ids'][0][0]
    matched_name = res['metadatas'][0][0]['name']
    matched_lbl = res['metadatas'][0][0]['label']
    dist = res['distances'][0][0]
    
    # Generate valid XHTML content
    raw_text = str(row['Narrative_Content'])
    xhtml_body = f"<p style='text-align:justify; font-family:Arial,sans-serif; font-size:10pt;'>{html.escape(raw_text)}</p>"
    
    # Generate XBRL XML Fact Tag Snippet (using CDATA for standard compliance)
    xml_snippet = f"<{matched_qname} contextRef='CY_Duration'><![CDATA[{xhtml_body}]]></{matched_qname}>"
    
    notes_results.append({
        'Note_No': row['Note_No'],
        'Note_Title': row['Note_Title'],
        'Disclosure_Type': row['Disclosure_Type'],
        'XBRL_Concept': matched_name,
        'Concept_Label': matched_lbl,
        'Cosine_Distance': round(dist, 4),
        'Narrative_Content': raw_text,
        'XHTML_Snippet': xml_snippet
    })

df_notes_tagged = pd.DataFrame(notes_results)

print("=== NARRATIVE NOTES AUTO-TAGGING & XHTML ESCAPING ===")
for r in notes_results:
    print(f"Note {r['Note_No']:<4} | {r['Note_Title'][:32]:<32} -> {r['XBRL_Concept']:<65} (dist: {r['Cosine_Distance']})")

print("\\n=== SAMPLE GENERATED XBRL TEXTBLOCK FACT (XHTML ESCAPED) ===")
sample = notes_results[0]
print(f"Concept : {sample['XBRL_Concept']}")
print("XML Fact:")
print(sample['XHTML_Snippet'])
"""
    add_code(code_6, 6)

    # Cell 13: Markdown 7 - Master Data Setup
    add_md("""## 7. Company, Directors & Auditors Master Data Setup
In MCA AOC-4 filings, statutory metadata (CIN, PAN, DIN, FRN, Membership numbers) is mandatory for filing acceptance.
Rather than extracting these from unformatted Excel footers, they are captured via standardized form payloads or MCA V3 API integration.""")

    # Cell 14: Code 7 - Master Data Payload
    code_7 = """# Setup Statutory Company, Auditor & Signatories Master Data
company_master = {
    'in-ca:CorporateIdentityNumber': 'U72200DL2018PTC123456',
    'in-ca:NameOfCompany': 'Helmier Technologies Private Limited',
    'in-ca:DateOfStartOfReportingPeriod': '2025-04-01',
    'in-ca:DateOfEndOfReportingPeriod': '2026-03-31',
    'ind-as:DescriptionOfNatureOfFinancialStatements': 'Standalone',
}

auditor_master = {
    'in-ca:CategoryOfAuditor': "Auditor's firm",
    'in-ca:NameOfAuditFirm': 'R. K. Sharma & Associates',
    'in-ca:NameOfAuditorSigningReport': 'CA Rajesh Sharma',
    'in-ca:MembershipNumberOfAuditor': '087654',
    'in-ca:AddressOfAuditors': 'Connaught Place, New Delhi - 110001',
    'in-ca:PermanentAccountNumberOfAuditorOrAuditorsFirm': 'AAAFR1234K',
    'in-ca:DateOfSigningAuditReportByAuditors': '2026-09-05',
    'in-ca:DateOfSigningOfBalanceSheetByAuditors': '2026-09-05',
}

directors_master = [
    {
        'in-ca:DirectorIdentificationNumberOfDirector': '01234567',
        'in-ca:FirstNameOfDirector': 'John',
        'in-ca:LastNameOfDirector': 'Doe',
        'in-ca:DesignationOfDirector': 'Managing Director',
        'in-ca:DateOfSigningOfFinancialStatementsByDirector': '2026-09-05',
    },
    {
        'in-ca:DirectorIdentificationNumberOfDirector': '07654321',
        'in-ca:FirstNameOfDirector': 'Jane',
        'in-ca:LastNameOfDirector': 'Doe',
        'in-ca:DesignationOfDirector': 'Director',
        'in-ca:DateOfSigningOfFinancialStatementsByDirector': '2026-09-05',
    }
]

master_data_payload = {
    'company': company_master,
    'auditor': auditor_master,
    'directors': directors_master
}

print("=== STATUTORY MASTER DATA LOADED ===")
print(f"Company Name : {company_master['in-ca:NameOfCompany']} (CIN: {company_master['in-ca:CorporateIdentityNumber']})")
print(f"Auditor Firm : {auditor_master['in-ca:NameOfAuditFirm']} (M.No: {auditor_master['in-ca:MembershipNumberOfAuditor']})")
print(f"Signatories  : {len(directors_master)} Directors registered")
for idx, d in enumerate(directors_master, 1):
    print(f"  Director {idx}: {d['in-ca:FirstNameOfDirector']} {d['in-ca:LastNameOfDirector']} ({d['in-ca:DesignationOfDirector']}, DIN: {d['in-ca:DirectorIdentificationNumberOfDirector']})")
"""
    add_code(code_7, 7)

    # Cell 15: Markdown 8 - Final XML Assembly
    add_md("""## 8. Final Deterministic MCA AOC-4 XBRL XML Assembly & Export
This final stage synthesizes all verified components into a single statutory XBRL instance document:
- **XML Namespaces**: `in-ca`, `ind-as`, `xbrli`, `xlink`, `link`, `xbrldi`, `iso4217`
- **Contexts**:
  - `CY_Instant` (2026-03-31) & `PY_Instant` (2025-03-31) for Balance Sheet
  - `CY_Duration` & `PY_Duration` for P&L, Notes, and Company Master
  - PPE Schedule Dimensional Contexts (`ClassesOfPropertyPlantAndEquipmentAxis` explicit members)
  - Director Signatories Typed/Explicit Contexts (`DirectorsSigningFinancialStatementsAxis`)
- **Units**: `INR` (`iso4217:INR`), `shares`, `pure`
- **Output Artifact**: Exported to `output/MCA_AOC4_STANDALONE_FILING.xml`""")

    # Cell 16: Code 8 - Final XML Assembly & Export
    code_8 = """import xml.etree.ElementTree as ET

OUTPUT_DIR = PROJECT_ROOT / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
output_xml_path = OUTPUT_DIR / "MCA_AOC4_STANDALONE_FILING.xml"

cin = company_master['in-ca:CorporateIdentityNumber']

xml = []
xml.append('<?xml version="1.0" encoding="UTF-8"?>')
xml.append('<xbrli:xbrl')
xml.append('  xmlns:in-ca="http://www.mca.gov.in/in-ca/2016-03-31"')
xml.append('  xmlns:ind-as="http://www.mca.gov.in/ind-as/2016-03-31"')
xml.append('  xmlns:xbrli="http://www.xbrl.org/2003/instance"')
xml.append('  xmlns:xlink="http://www.w3.org/1999/xlink"')
xml.append('  xmlns:link="http://www.xbrl.org/2003/linkbase"')
xml.append('  xmlns:xbrldi="http://xbrl.org/2006/xbrldi"')
xml.append('  xmlns:iso4217="http://www.xbrl.org/2003/iso4217">')
xml.append('  <link:schemaRef xlink:href="http://www.mca.gov.in/ind-as/2016-03-31/ind-as-2016-03-31.xsd" xlink:type="simple"/>')
xml.append('')

# 1. Standard Contexts
xml.append('  <!-- ==================== 1. STANDARD CONTEXTS ==================== -->')
xml.append('  <xbrli:context id="CY_Instant">')
xml.append('    <xbrli:entity>')
xml.append(f'      <xbrli:identifier scheme="http://www.mca.gov.in/CIN">{cin}</xbrli:identifier>')
xml.append('    </xbrli:entity>')
xml.append('    <xbrli:period>')
xml.append('      <xbrli:instant>2026-03-31</xbrli:instant>')
xml.append('    </xbrli:period>')
xml.append('  </xbrli:context>')

xml.append('  <xbrli:context id="PY_Instant">')
xml.append('    <xbrli:entity>')
xml.append(f'      <xbrli:identifier scheme="http://www.mca.gov.in/CIN">{cin}</xbrli:identifier>')
xml.append('    </xbrli:entity>')
xml.append('    <xbrli:period>')
xml.append('      <xbrli:instant>2025-03-31</xbrli:instant>')
xml.append('    </xbrli:period>')
xml.append('  </xbrli:context>')

xml.append('  <xbrli:context id="CY_Duration">')
xml.append('    <xbrli:entity>')
xml.append(f'      <xbrli:identifier scheme="http://www.mca.gov.in/CIN">{cin}</xbrli:identifier>')
xml.append('    </xbrli:entity>')
xml.append('    <xbrli:period>')
xml.append('      <xbrli:startDate>2025-04-01</xbrli:startDate>')
xml.append('      <xbrli:endDate>2026-03-31</xbrli:endDate>')
xml.append('    </xbrli:period>')
xml.append('  </xbrli:context>')

xml.append('  <xbrli:context id="PY_Duration">')
xml.append('    <xbrli:entity>')
xml.append(f'      <xbrli:identifier scheme="http://www.mca.gov.in/CIN">{cin}</xbrli:identifier>')
xml.append('    </xbrli:entity>')
xml.append('    <xbrli:period>')
xml.append('      <xbrli:startDate>2024-04-01</xbrli:startDate>')
xml.append('      <xbrli:endDate>2025-03-31</xbrli:endDate>')
xml.append('    </xbrli:period>')
xml.append('  </xbrli:context>')
xml.append('')

# 2. PPE Dimensional Contexts
xml.append('  <!-- ==================== 2. PPE DIMENSIONAL CONTEXTS ==================== -->')
member_map = {r['Asset_Class']: r['XBRL_Member'] for r in ppe_rows_tagged}
for r in ppe_rows_tagged:
    if r['Asset_Class'] == 'Total Property, Plant & Equipment':
        continue
    member = r['XBRL_Member']
    
    # CY Duration for member
    xml.append(f'  <xbrli:context id="CY_Duration_{member}">')
    xml.append('    <xbrli:entity>')
    xml.append(f'      <xbrli:identifier scheme="http://www.mca.gov.in/CIN">{cin}</xbrli:identifier>')
    xml.append('      <xbrli:segment>')
    xml.append('        <xbrldi:explicitMember dimension="ind-as:ClassesOfPropertyPlantAndEquipmentAxis">')
    xml.append(f'          ind-as:{member}')
    xml.append('        </xbrldi:explicitMember>')
    xml.append('      </xbrli:segment>')
    xml.append('    </xbrli:entity>')
    xml.append('    <xbrli:period>')
    xml.append('      <xbrli:startDate>2025-04-01</xbrli:startDate>')
    xml.append('      <xbrli:endDate>2026-03-31</xbrli:endDate>')
    xml.append('    </xbrli:period>')
    xml.append('  </xbrli:context>')
    
    # CY Instant for member
    xml.append(f'  <xbrli:context id="CY_Instant_{member}">')
    xml.append('    <xbrli:entity>')
    xml.append(f'      <xbrli:identifier scheme="http://www.mca.gov.in/CIN">{cin}</xbrli:identifier>')
    xml.append('      <xbrli:segment>')
    xml.append('        <xbrldi:explicitMember dimension="ind-as:ClassesOfPropertyPlantAndEquipmentAxis">')
    xml.append(f'          ind-as:{member}')
    xml.append('        </xbrldi:explicitMember>')
    xml.append('      </xbrli:segment>')
    xml.append('    </xbrli:entity>')
    xml.append('    <xbrli:period>')
    xml.append('      <xbrli:instant>2026-03-31</xbrli:instant>')
    xml.append('    </xbrli:period>')
    xml.append('  </xbrli:context>')
    
    # PY Instant for member
    xml.append(f'  <xbrli:context id="PY_Instant_{member}">')
    xml.append('    <xbrli:entity>')
    xml.append(f'      <xbrli:identifier scheme="http://www.mca.gov.in/CIN">{cin}</xbrli:identifier>')
    xml.append('      <xbrli:segment>')
    xml.append('        <xbrldi:explicitMember dimension="ind-as:ClassesOfPropertyPlantAndEquipmentAxis">')
    xml.append(f'          ind-as:{member}')
    xml.append('        </xbrldi:explicitMember>')
    xml.append('      </xbrli:segment>')
    xml.append('    </xbrli:entity>')
    xml.append('    <xbrli:period>')
    xml.append('      <xbrli:instant>2025-03-31</xbrli:instant>')
    xml.append('    </xbrli:period>')
    xml.append('  </xbrli:context>')
xml.append('')

# 3. Director Signatories Contexts
xml.append('  <!-- ==================== 3. DIRECTOR SIGNATORIES CONTEXTS ==================== -->')
for d in directors_master:
    din = d['in-ca:DirectorIdentificationNumberOfDirector']
    xml.append(f'  <xbrli:context id="Director_{din}">')
    xml.append('    <xbrli:entity>')
    xml.append(f'      <xbrli:identifier scheme="http://www.mca.gov.in/CIN">{cin}</xbrli:identifier>')
    xml.append('      <xbrli:segment>')
    xml.append('        <xbrldi:typedMember dimension="in-ca:DirectorsSigningFinancialStatementsAxis">')
    xml.append(f'          <in-ca:DirectorIdentificationNumberOfDirector>{din}</in-ca:DirectorIdentificationNumberOfDirector>')
    xml.append('        </xbrldi:typedMember>')
    xml.append('      </xbrli:segment>')
    xml.append('    </xbrli:entity>')
    xml.append('    <xbrli:period>')
    xml.append('      <xbrli:startDate>2025-04-01</xbrli:startDate>')
    xml.append('      <xbrli:endDate>2026-03-31</xbrli:endDate>')
    xml.append('    </xbrli:period>')
    xml.append('  </xbrli:context>')
xml.append('')

# 4. Units
xml.append('  <!-- ==================== 4. UNITS ==================== -->')
xml.append('  <xbrli:unit id="INR"><xbrli:measure>iso4217:INR</xbrli:measure></xbrli:unit>')
xml.append('  <xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>')
xml.append('  <xbrli:unit id="pure"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>')
xml.append('')

# 5. Master Facts
xml.append('  <!-- ==================== 5. COMPANY & AUDITOR FACTS ==================== -->')
for tag, val in company_master.items():
    xml.append(f'  <{tag} contextRef="CY_Duration">{html.escape(str(val))}</{tag}>')
for tag, val in auditor_master.items():
    xml.append(f'  <{tag} contextRef="CY_Duration">{html.escape(str(val))}</{tag}>')
xml.append('')

# 6. Director Facts
xml.append('  <!-- ==================== 6. DIRECTOR SIGNATORY FACTS ==================== -->')
for d in directors_master:
    din = d['in-ca:DirectorIdentificationNumberOfDirector']
    ctx = f"Director_{din}"
    for tag, val in d.items():
        xml.append(f'  <{tag} contextRef="{ctx}">{html.escape(str(val))}</{tag}>')
xml.append('')

# 7. Balance Sheet Facts
xml.append('  <!-- ==================== 7. BALANCE SHEET FACTS ==================== -->')
for idx, row in df_bs_tagged.iterrows():
    concept = row['XBRL_Concept']
    cy_amt = int(row['Current_Year_Amount'])
    py_amt = int(row['Previous_Year_Amount'])
    xml.append(f'  <ind-as:{concept} contextRef="CY_Instant" unitRef="INR" decimals="0">{cy_amt}</ind-as:{concept}>')
    xml.append(f'  <ind-as:{concept} contextRef="PY_Instant" unitRef="INR" decimals="0">{py_amt}</ind-as:{concept}>')
xml.append('')

# 8. Profit & Loss Facts
xml.append('  <!-- ==================== 8. PROFIT & LOSS FACTS ==================== -->')
for idx, row in df_pl_tagged.iterrows():
    concept = row['XBRL_Concept']
    cy_amt = int(row['Current_Year_Amount'])
    py_amt = int(row['Previous_Year_Amount'])
    xml.append(f'  <ind-as:{concept} contextRef="CY_Duration" unitRef="INR" decimals="0">{cy_amt}</ind-as:{concept}>')
    xml.append(f'  <ind-as:{concept} contextRef="PY_Duration" unitRef="INR" decimals="0">{py_amt}</ind-as:{concept}>')
xml.append('')

# 9. PPE Schedule Facts
xml.append('  <!-- ==================== 9. PPE SCHEDULE DIMENSIONAL FACTS ==================== -->')
for idx, row in df_ppe.iterrows():
    ac = row['Asset_Class']
    if ac == 'Total Property, Plant & Equipment':
        continue
    member = member_map[ac]
    c_dur = f"CY_Duration_{member}"
    c_inst_cy = f"CY_Instant_{member}"
    c_inst_py = f"PY_Instant_{member}"
    
    xml.append(f'  <ind-as:PropertyPlantAndEquipment contextRef="{c_inst_py}" unitRef="INR" decimals="0">{int(row["Gross_Opening"])}</ind-as:PropertyPlantAndEquipment>')
    xml.append(f'  <ind-as:AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment contextRef="{c_dur}" unitRef="INR" decimals="0">{int(row["Gross_Additions"])}</ind-as:AdditionsOtherThanThroughBusinessCombinationsPropertyPlantAndEquipment>')
    xml.append(f'  <ind-as:DisposalsPropertyPlantAndEquipment contextRef="{c_dur}" unitRef="INR" decimals="0">{int(row["Gross_Disposals"])}</ind-as:DisposalsPropertyPlantAndEquipment>')
    xml.append(f'  <ind-as:PropertyPlantAndEquipment contextRef="{c_inst_cy}" unitRef="INR" decimals="0">{int(row["Gross_Closing"])}</ind-as:PropertyPlantAndEquipment>')
    xml.append(f'  <ind-as:DepreciationPropertyPlantAndEquipment contextRef="{c_dur}" unitRef="INR" decimals="0">{int(row["Dep_For_Year"])}</ind-as:DepreciationPropertyPlantAndEquipment>')
xml.append('')

# 10. Narrative Notes TextBlock Facts
xml.append('  <!-- ==================== 10. NARRATIVE NOTES EXPLANATORY FACTS ==================== -->')
for idx, row in df_notes_tagged.iterrows():
    concept = row['XBRL_Concept']
    xml.append(f"  {row['XHTML_Snippet']}")
xml.append('')

# Close root
xml.append('</xbrli:xbrl>')

full_xml_content = chr(10).join(xml)

# Save to disk
with open(output_xml_path, 'w', encoding='utf-8') as f:
    f.write(full_xml_content)

# Validate XML Integrity
tree = ET.fromstring(full_xml_content)
all_elements = list(tree.iter())
facts_count = len([e for e in all_elements if not e.tag.endswith('context') and not e.tag.endswith('unit') and not e.tag.endswith('schemaRef') and not e.tag.endswith('xbrl') and not e.tag.startswith('{http://www.xbrl.org/')])

print("🎉 ==================================================================")
print("🎉 FINAL DETERMINISTIC MCA AOC-4 XBRL XML GENERATION COMPLETED!")
print("🎉 ==================================================================")
print(f"📁 Output File Path      : {output_xml_path}")
print(f"📊 Total File Size       : {len(full_xml_content)/1024:.2f} KB")
print(f"🏷️  Total XML Elements    : {len(all_elements)}")
print(f"💰 Tagged Facts Count    : {facts_count}")
print("✅ XML Validation Status : 100% Valid XML (Parsed successfully with ElementTree)")

# Preview first 35 lines of XML
print(); print("=== GENERATED XML PREVIEW (First 35 lines) ===")
for line in xml[:35]:
    print(line)
"""
    add_code(code_8, 8)

    notebook_data = {
        "cells": cells,
        "metadata": {
            "language_info": {
                "name": "python"
            }
        },
        "nbformat": 4,
        "nbformat_minor": 5
    }

    with open(notebook_path, "w") as f:
        json.dump(notebook_data, f, indent=2)

    print(f"Successfully generated and executed {notebook_path} with {len(cells)} cells!")

if __name__ == '__main__':
    create_and_run_notebook()
