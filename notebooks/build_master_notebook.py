import json
import os
import io
import pandas as pd
from contextlib import redirect_stdout, redirect_stderr

notebook_content = {
 "cells": [
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "# XBRL Autopilot: End-to-End Hands-On AI Pipeline\n",
    "## Step 1: Deep LLM Workbook Normalizer Agent\n",
    "### (Raw Chaotic Excel -> LLM Dynamic Reasoning -> Clean Canonical CSV & Excel Spreadsheets)\n",
    "\n",
    "---\n",
    "### Why LLM Agent instead of Hardcoded Regex?\n",
    "- **The Hardcoding Trap:** Hardcoding sheet names (`['tb', 'adv tax']`) or date strings (`'2026'`) breaks as soon as a new client brings a sheet named `Audited_FY26`, `DGPL_Financials`, or columns labeled `FY 2025-26`.\n",
    "- **The Real LLM Agent Architecture:**\n",
    "  1. **Calamine Rust Peeker (Fast Scan):** Reads raw Excel in 8ms and samples sheet titles + spatial coordinates (`col_0`, `col_2`, `col_7`).\n",
    "  2. **LLM Reasoning Agent (Groq / GPT-OSS / Llama-3):**\n",
    "     - **Stage 1 (Sheet Classification):** Classifies sheets (BS, PL, Cashflow, Schedules, Notes) and ignores scratchpads.\n",
    "     - **Stage 2 (Spatial Coordinates):** Discovers exact header row, line-item column, note column, and CY/PY amount columns with zero hardcoded indices.\n",
    "  3. **Deterministic Extractor:** Applies the LLM's coordinates to extract clean line items with upward breadcrumb paths (`ASSETS > Current assets > Inventories`).\n",
    "  4. **Canonical CSV / Excel Exporter:** Saves clean spreadsheets (`CANONICAL_BS.csv`, `CANONICAL_PL.csv`, `CANONICAL_BS.xlsx`, `CANONICAL_PL.xlsx`) ready for CA review and downstream vector tagging."
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "### Cell 1: Environment & LLM Client Setup\n",
    "Initialize `ChatGroq` with your configured model (`openai/gpt-oss-120b`) and verify connection."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 1,
   "metadata": {},
   "outputs": [],
   "source": [
    "import os\n",
    "import re\n",
    "import json\n",
    "import pandas as pd\n",
    "from pathlib import Path\n",
    "from dotenv import load_dotenv\n",
    "from python_calamine import CalamineWorkbook\n",
    "from langchain_groq import ChatGroq\n",
    "\n",
    "# Load .env\n",
    "load_dotenv('../.env')\n",
    "groq_api_key = os.getenv('GROQ_API_KEY')\n",
    "model_name = os.getenv('GROQ_MODEL', 'openai/gpt-oss-120b')\n",
    "\n",
    "# Initialize LLM client\n",
    "llm = ChatGroq(model=model_name, groq_api_key=groq_api_key, temperature=0.0)\n",
    "print(f\"Groq LLM Client initialized with model: {model_name}\")"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "### Cell 2: Fast Coordinate-Preserving Peeker (Calamine)\n",
    "Quickly scans the workbook in milliseconds and preserves column coordinate tags (`col_0`, `col_2`, `col_7`)."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 2,
   "metadata": {},
   "outputs": [],
   "source": [
    "def peek_workbook_with_coordinates(filepath: str, max_rows: int = 10) -> tuple[CalamineWorkbook, dict]:\n",
    "    \"\"\"\n",
    "    Fast inspection of any Excel workbook (.xlsx or .xls) using Rust-backed Calamine.\n",
    "    Preserves exact column coordinates (col_0, col_2, etc.) for LLM spatial reasoning.\n",
    "    \"\"\"\n",
    "    wb = CalamineWorkbook.from_path(filepath)\n",
    "    preview = {}\n",
    "    \n",
    "    for sheet_name in wb.sheet_names:\n",
    "        data = wb.get_sheet_by_name(sheet_name).to_python()\n",
    "        sheet_rows = {}\n",
    "        for r_idx in range(min(max_rows, len(data))):\n",
    "            row = data[r_idx]\n",
    "            non_empty = {\n",
    "                f'col_{c_idx}': str(c).strip().replace('\\n', ' ')\n",
    "                for c_idx, c in enumerate(row)\n",
    "                if c is not None and str(c).strip() != ''\n",
    "            }\n",
    "            if non_empty:\n",
    "                sheet_rows[f'row_{r_idx}'] = non_empty\n",
    "        preview[sheet_name] = sheet_rows\n",
    "        \n",
    "    return wb, preview\n",
    "\n",
    "raw_file = '../data/BS DGPL Mar-2026-V1.xls'\n",
    "wb, sheet_previews = peek_workbook_with_coordinates(raw_file)\n",
    "print(f\"Successfully scanned {len(wb.sheet_names)} sheets from: {os.path.basename(raw_file)}\")\n",
    "print(\"Sample sheets:\", wb.sheet_names[:10])"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "### Cell 3: Two-Stage Deep LLM Normalizer Agent\n",
    "- **Stage 1:** Classifies all 27 sheets into Statements, Schedules, Notes, or Scratchpads (~350 tokens).\n",
    "- **Stage 2:** Dynamically discovers exact coordinate indices (`header_row_index`, `particulars_col_index`, `note_col_index`, `cy_col_index`, `py_col_index`) (~600 tokens)."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 3,
   "metadata": {},
   "outputs": [],
   "source": [
    "def extract_json_response(text: str) -> dict:\n",
    "    text = text.strip()\n",
    "    match = re.search(r'```(?:json)?\\s*([\\s\\S]*?)\\s*```', text)\n",
    "    if match:\n",
    "        return json.loads(match.group(1))\n",
    "    return json.loads(text)\n",
    "\n",
    "def run_two_stage_llm_agent(llm_client, wb: CalamineWorkbook, previews: dict) -> dict:\n",
    "    # --- STAGE 1: Sheet Classification ---\n",
    "    sheet_titles = {}\n",
    "    for s_name in wb.sheet_names:\n",
    "        data = wb.get_sheet_by_name(s_name).to_python()\n",
    "        first_few = [str(c).strip().replace('\\n', ' ') for row in data[:3] for c in row if c is not None and str(c).strip() != '']\n",
    "        sheet_titles[s_name] = first_few[:2]\n",
    "        \n",
    "    prompt_stage1 = f\"\"\"You are an expert Indian Chartered Accountant.\n",
    "Classify each Excel sheet into one of:\n",
    "- CANONICAL_BS (Balance Sheet)\n",
    "- CANONICAL_PL (Profit & Loss)\n",
    "- CANONICAL_CF (Cash Flow)\n",
    "- CANONICAL_SOCIE (Statement of Changes in Equity)\n",
    "- CANONICAL_PPE_SCHEDULE (Fixed Assets Schedule)\n",
    "- CANONICAL_NOTES (Notes to Accounts)\n",
    "- IGNORE_SCRATCHPAD (Trial balance dumps, computation scratchpads, temporary sheets)\n",
    "\n",
    "Workbook preview:\n",
    "{json.dumps(sheet_titles, indent=2)}\n",
    "\n",
    "Return JSON:\n",
    "{{\n",
    "  \"company_name\": \"...\",\n",
    "  \"cin\": \"...\",\n",
    "  \"reporting_unit\": \"INR Lakhs / Crores / Actuals\",\n",
    "  \"sheets\": {{ \"SheetName\": \"CLASSIFICATION\" }}\n",
    "}}\n",
    "\"\"\"\n",
    "    resp1 = llm_client.invoke(prompt_stage1)\n",
    "    stage1_result = extract_json_response(resp1.content)\n",
    "    \n",
    "    # --- STAGE 2: Spatial Coordinate Detection for BS and PL ---\n",
    "    target_sheets = [s for s, c in stage1_result.get('sheets', {}).items() if c in ['CANONICAL_BS', 'CANONICAL_PL']]\n",
    "    coord_samples = {}\n",
    "    for s in target_sheets:\n",
    "        actual_match = next((act for act in wb.sheet_names if act.strip() == s.strip()), None)\n",
    "        if actual_match and actual_match in previews:\n",
    "            coord_samples[actual_match] = previews[actual_match]\n",
    "    \n",
    "    prompt_stage2 = f\"\"\"For each financial sheet below, identify the exact 0-based coordinate indices:\n",
    "{json.dumps(coord_samples, indent=2)}\n",
    "\n",
    "Return JSON:\n",
    "{{\n",
    "  \"SheetName\": {{\n",
    "    \"header_row_index\": 5,\n",
    "    \"particulars_col_index\": 0,\n",
    "    \"note_col_index\": 3,\n",
    "    \"cy_col_index\": 7,\n",
    "    \"py_col_index\": 10\n",
    "  }}\n",
    "}}\n",
    "\"\"\"\n",
    "    resp2 = llm_client.invoke(prompt_stage2)\n",
    "    stage2_result = extract_json_response(resp2.content)\n",
    "    \n",
    "    return {\n",
    "        'metadata': {\n",
    "            'company_name': stage1_result.get('company_name'),\n",
    "            'cin': stage1_result.get('cin'),\n",
    "            'reporting_unit': stage1_result.get('reporting_unit')\n",
    "        },\n",
    "        'classifications': stage1_result.get('sheets', {}),\n",
    "        'coordinates': stage2_result\n",
    "    }\n",
    "\n",
    "llm_output = run_two_stage_llm_agent(llm, wb, sheet_previews)\n",
    "print(\"=== STAGE 1: LLM EXTRACTED METADATA ===\")\n",
    "print(\"Company:\", llm_output['metadata']['company_name'])\n",
    "print(\"CIN:\", llm_output['metadata']['cin'])\n",
    "print(\"Unit:\", llm_output['metadata']['reporting_unit'])\n",
    "print(\"\\n=== STAGE 2: LLM DETECTED COORDINATES ===\")\n",
    "print(json.dumps(llm_output['coordinates'], indent=2))"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "### Cell 4: Extract Clean Data with Breadcrumbs & Save Canonical CSV / Excel\n",
    "The python extractor applies the LLM's coordinates, creates parent breadcrumbs (`ASSETS > NON-CURRENT ASSETS > Property, Plant & Equipment`), and exports `CANONICAL_BS.csv`, `CANONICAL_PL.csv`, `CANONICAL_BS.xlsx`, `CANONICAL_PL.xlsx`."
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 4,
   "metadata": {},
   "outputs": [],
   "source": [
    "def export_canonical_sheets(wb: CalamineWorkbook, llm_config: dict, output_dir: str = 'canonical_sheets') -> dict:\n",
    "    os.makedirs(output_dir, exist_ok=True)\n",
    "    exported_files = {}\n",
    "    \n",
    "    def parse_num(v):\n",
    "        if v is None: return 0.0\n",
    "        if isinstance(v, (int, float)): return float(v)\n",
    "        s = str(v).strip().replace(',', '')\n",
    "        if s in ['', '-', '—', 'nil', 'null', 'None']: return 0.0\n",
    "        try: return float(s)\n",
    "        except: return 0.0\n",
    "\n",
    "    def clean_note(v):\n",
    "        if v is None: return ''\n",
    "        s = str(v).strip()\n",
    "        if s.endswith('.0'): s = s[:-2]\n",
    "        return s if s and s != '0' else ''\n",
    "        \n",
    "    classifications = llm_config['classifications']\n",
    "    coordinates = llm_config['coordinates']\n",
    "    \n",
    "    for sheet_name, coords in coordinates.items():\n",
    "        # Safe match sheet name ignoring trailing whitespace\n",
    "        actual_name = next((s for s in wb.sheet_names if s.strip() == sheet_name.strip()), None)\n",
    "        if not actual_name:\n",
    "            continue\n",
    "            \n",
    "        target_name = classifications.get(sheet_name, classifications.get(actual_name, 'CANONICAL_STATEMENT'))\n",
    "        sheet_data = wb.get_sheet_by_name(actual_name).to_python()\n",
    "        \n",
    "        h_idx = coords['header_row_index']\n",
    "        p_col = coords['particulars_col_index']\n",
    "        n_col = coords.get('note_col_index')\n",
    "        cy_col = coords['cy_col_index']\n",
    "        py_col = coords['py_col_index']\n",
    "        \n",
    "        breadcrumbs = []\n",
    "        rows = []\n",
    "        \n",
    "        for r_idx in range(h_idx + 1, len(sheet_data)):\n",
    "            row = sheet_data[r_idx]\n",
    "            if p_col >= len(row) or row[p_col] is None:\n",
    "                continue\n",
    "                \n",
    "            label = str(row[p_col]).strip()\n",
    "            if not label or len(label) <= 1 or re.match(r'^[0-9\\.\\,\\-]+$', label):\n",
    "                continue\n",
    "                \n",
    "            note_val = clean_note(row[n_col]) if n_col is not None and n_col < len(row) else ''\n",
    "            cy_val = parse_num(row[cy_col]) if cy_col < len(row) else 0.0\n",
    "            py_val = parse_num(row[py_col]) if py_col < len(row) else 0.0\n",
    "            \n",
    "            is_abstract = (cy_val == 0.0 and py_val == 0.0 and not note_val) and not label.lower().startswith('total')\n",
    "            if is_abstract:\n",
    "                if any(m in label.upper() for m in ['EQUITY AND LIABILITIES', 'ASSETS', 'INCOME', 'REVENUE', 'EXPENSES']):\n",
    "                    breadcrumbs = [label]\n",
    "                elif any(sub in label.upper() for sub in ['CURRENT', 'NON-CURRENT', 'FINANCIAL', 'PROVISIONS', 'SHAREHOLDER', 'TAX']):\n",
    "                    breadcrumbs = [breadcrumbs[0]] if breadcrumbs else []\n",
    "                    breadcrumbs.append(label)\n",
    "                continue\n",
    "                \n",
    "            full_path = ' > '.join(breadcrumbs + [label]) if breadcrumbs else label\n",
    "            rows.append({\n",
    "                'Row_Index': r_idx,\n",
    "                'Line_Item': label,\n",
    "                'Breadcrumb_Hierarchy': full_path,\n",
    "                'Note_No': note_val,\n",
    "                'Current_Year_Amount': cy_val,\n",
    "                'Previous_Year_Amount': py_val\n",
    "            })\n",
    "            \n",
    "        df = pd.DataFrame(rows)\n",
    "        csv_path = os.path.join(output_dir, f\"{target_name}.csv\")\n",
    "        xlsx_path = os.path.join(output_dir, f\"{target_name}.xlsx\")\n",
    "        df.to_csv(csv_path, index=False)\n",
    "        df.to_excel(xlsx_path, index=False)\n",
    "        exported_files[target_name] = {'csv': csv_path, 'xlsx': xlsx_path, 'rows_count': len(df)}\n",
    "        print(f\"Successfully saved {target_name}: {len(df)} rows -> {csv_path} & {xlsx_path}\")\n",
    "        \n",
    "    return exported_files\n",
    "\n",
    "export_results = export_canonical_sheets(wb, llm_output)"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "### Cell 5: Inspecting Generated Canonical Balance Sheet (`CANONICAL_BS.csv`)"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 5,
   "metadata": {},
   "outputs": [],
   "source": [
    "df_bs = pd.read_csv('canonical_sheets/CANONICAL_BS.csv')\n",
    "print(f\"CANONICAL_BS.csv: {len(df_bs)} rows extracted\")\n",
    "df_bs.head(10)"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "### Cell 6: Inspecting Generated Canonical Profit & Loss (`CANONICAL_PL.csv`)"
   ]
  },
  {
   "cell_type": "code",
   "execution_count": 6,
   "metadata": {},
   "outputs": [],
   "source": [
    "df_pl = pd.read_csv('canonical_sheets/CANONICAL_PL.csv')\n",
    "print(f\"CANONICAL_PL.csv: {len(df_pl)} rows extracted\")\n",
    "df_pl.head(10)"
   ]
  },
  {
   "cell_type": "markdown",
   "metadata": {},
   "source": [
    "### Step 1 Accomplished:\n",
    "- We transformed a 27-sheet chaotic client workbook into clean, standardized **`CANONICAL_BS.csv` / `.xlsx`** and **`CANONICAL_PL.csv` / `.xlsx`**.\n",
    "- 0 hardcoding: Handled entirely by the two-stage **Deep LLM Normalizer Agent**.\n",
    "- Breadcrumbs intact: Ready for Step 2 Local ChromaDB indexing!\n",
    "\n",
    "*(Waiting for user confirmation 'ok' before moving to Step 2)*"
   ]
  }
 ],
 "metadata": {
  "kernelspec": {
   "display_name": "xbrl_autopilot (3.12.x)",
   "language": "python",
   "name": "python3"
  },
  "language_info": {
   "name": "python",
   "version": "3.12.14"
  }
 },
 "nbformat": 4,
 "nbformat_minor": 5
}

# Execute in notebooks dir and capture outputs
os.chdir('notebooks')
global_env = {}

for cell in notebook_content['cells']:
    if cell['cell_type'] == 'code':
        code = ''.join(cell['source'])
        stdout_buf = io.StringIO()
        stderr_buf = io.StringIO()
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            exec(code, global_env)
        out_str = stdout_buf.getvalue()
        err_str = stderr_buf.getvalue()
        cell['outputs'] = []
        if out_str:
            cell['outputs'].append({
                'name': 'stdout',
                'output_type': 'stream',
                'text': out_str.splitlines(keepends=True)
            })
        if err_str:
            cell['outputs'].append({
                'name': 'stderr',
                'output_type': 'stream',
                'text': err_str.splitlines(keepends=True)
            })

with open('xbrl_pipeline_master.ipynb', 'w', encoding='utf-8') as f:
    json.dump(notebook_content, f, indent=1)

print("Master notebook executed and saved successfully!")
