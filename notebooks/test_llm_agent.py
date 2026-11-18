import os
import json
import re
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from python_calamine import CalamineWorkbook

load_dotenv('.env')
groq_api_key = os.getenv('GROQ_API_KEY')
model = os.getenv('GROQ_MODEL', 'openai/gpt-oss-120b')
llm = ChatGroq(model=model, groq_api_key=groq_api_key, temperature=0.0)

def extract_json(text: str) -> dict:
    text = text.strip()
    match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
    if match:
        return json.loads(match.group(1))
    return json.loads(text)

wb = CalamineWorkbook.from_path('data/BS DGPL Mar-2026-V1.xls')

# Stage 1: Fast sheet classification (~350 tokens)
sheet_titles = {}
for s in wb.sheet_names:
    data = wb.get_sheet_by_name(s).to_python()
    first_few = [str(c).strip().replace('\n', ' ') for row in data[:3] for c in row if c is not None and str(c).strip() != '']
    sheet_titles[s] = first_few[:2]

prompt1 = f"""You are an Indian Chartered Accountant.
Classify each sheet into: CANONICAL_BS, CANONICAL_PL, CANONICAL_CF, CANONICAL_SOCIE, CANONICAL_PPE_SCHEDULE, CANONICAL_NOTES, or IGNORE_SCRATCHPAD.
Input sheet titles:
{json.dumps(sheet_titles, indent=2)}

Return JSON:
{{
  "company_name": "...",
  "cin": "...",
  "reporting_unit": "...",
  "sheets": {{ "SheetName": "CLASSIFICATION" }}
}}
"""

resp1 = llm.invoke(prompt1)
stage1 = extract_json(resp1.content)
print("=== STAGE 1: LLM Sheet Classification ===")
print("Company:", stage1.get('company_name'), "| CIN:", stage1.get('cin'), "| Unit:", stage1.get('reporting_unit'))
for s, c in stage1.get('sheets', {}).items():
    if c != 'IGNORE_SCRATCHPAD':
        print(f"  [KEEP] {s:25s} -> {c}")

# Stage 2: Deep Coordinate Detection ONLY for BS and PL (~600 tokens)
target_sheets = [s for s, c in stage1.get('sheets', {}).items() if c in ['CANONICAL_BS', 'CANONICAL_PL']]
previews = {}
for s in target_sheets:
    data = wb.get_sheet_by_name(s).to_python()
    rows_dict = {}
    for r_idx in range(min(8, len(data))):
        row = data[r_idx]
        non_empty = {f'col_{c_idx}': str(cell).strip().replace('\n', ' ') for c_idx, cell in enumerate(row) if cell is not None and str(cell).strip() != ''}
        if non_empty:
            rows_dict[f'row_{r_idx}'] = non_empty
    previews[s] = rows_dict

prompt2 = f"""For each sheet below, identify the exact 0-based coordinate indices:
{json.dumps(previews, indent=2)}

Return JSON:
{{
  "SheetName": {{
    "header_row_index": 5,
    "particulars_col_index": 0,
    "note_col_index": 3,
    "cy_col_index": 7,
    "py_col_index": 10
  }}
}}
"""

resp2 = llm.invoke(prompt2)
stage2 = extract_json(resp2.content)
print("\n=== STAGE 2: LLM Exact Spatial Coordinates ===")
print(json.dumps(stage2, indent=2))
