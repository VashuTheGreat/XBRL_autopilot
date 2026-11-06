"""Excel financial statements importer.

Extracts line items, CY, and PY figures from Balance Sheet and P&L tabs of Excel workbooks.
"""

from __future__ import annotations
import io
import re
import unicodedata
from typing import Any, Dict, List, Optional, Set, Tuple, Union
import openpyxl

from src.core.scaling import to_canonical, to_display

LABEL_HEADERS = {"particulars", "line item", "description", "account", "account name", "item", "head"}


def normalize_excel_label(value: Any) -> str:
    s = str(value or "")
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


normalizeExcelLabel = normalize_excel_label


def parse_excel_amount(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).strip()
    if not text or re.match(r"^[-–—]$", text):
        return None
    negative = text.startswith("(") and text.endswith(")")
    cleaned = re.sub(r"[₹,\s]", "", text)
    cleaned = re.sub(r"^(?:INR|Rs\.?)", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^\((.*)\)$", r"\1", cleaned)
    if not re.match(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$", cleaned):
        return None
    normalized = f"-{cleaned}" if (negative and not cleaned.startswith("-")) else cleaned
    try:
        float(normalized)
        return normalized
    except ValueError:
        return None


parseExcelAmount = parse_excel_amount


def excel_display_value(value: Any, concept: str, A: Any, source_level: str, filing_level: str) -> Any:
    return to_display(to_canonical(value, source_level), filing_level) if A.is_monetary(concept) else value


excelDisplayValue = excel_display_value


def excel_import_readiness(periods: Optional[Dict[str, Any]], first_financial_year: bool, rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not periods or not periods.get("cy", {}).get("start") or not periods.get("cy", {}).get("end"):
        return {"ready": False, "reason": "Set the current-year start and end dates on the Company information page before importing."}
    has_previous_values = any(row.get("py") is not None for row in rows)
    if has_previous_values and not first_financial_year and (not periods.get("py", {}).get("start") or not periods.get("py", {}).get("end")):
        return {"ready": False, "reason": "Set the previous-year start and end dates on the Company information page before importing both workbook years."}
    return {"ready": True, "skipPrevious": has_previous_values and bool(first_financial_year), "reason": ""}


excelImportReadiness = excel_import_readiness


def sheet_type(name: str, rows: List[List[Any]]) -> Optional[str]:
    key = normalize_excel_label(name)
    if re.search(r"balance sheet|financial position|\bbs\b", key):
        return "balance"
    if re.search(r"profit|loss|income statement|\bp and l\b|\bp l\b", key):
        return "profit-loss"
    sample = " ".join(normalize_excel_label(cell) for r in rows[:12] for cell in r)
    if "balance sheet" in sample or "statement of financial position" in sample:
        return "balance"
    if "statement of profit and loss" in sample or "profit and loss statement" in sample or "income statement" in sample:
        return "profit-loss"
    return None


def header_scope(value: Any, periods: Optional[Dict[str, Any]]) -> Optional[str]:
    key = normalize_excel_label(value)
    if re.search(r"\b(current|current year|cy)\b", key):
        return "CY"
    if re.search(r"\b(previous|prior|previous year|prior year|py)\b", key):
        return "PY"
    years = [int(m.group(1)) for m in re.finditer(r"\b(20\d{2})\b", key)]
    if periods and periods.get("cy", {}).get("end"):
        cy_year = int(periods["cy"]["end"][:4])
        if cy_year in years:
            return "CY"
    if periods and periods.get("py", {}).get("end"):
        py_year = int(periods["py"]["end"][:4])
        if py_year in years:
            return "PY"
    return None


def parse_sheet(sheet_name: str, rows: List[List[Any]], st_type: str, periods: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    header_row = -1
    label_col = 0
    for r in range(min(len(rows), 20)):
        cells = rows[r] or []
        for c, v in enumerate(cells):
            if normalize_excel_label(v) in LABEL_HEADERS:
                header_row = r
                label_col = c
                break
        if header_row >= 0:
            break

    value_columns: Dict[str, Optional[int]] = {"CY": None, "PY": None}
    if header_row >= 0:
        cells = rows[header_row] or []
        for c, v in enumerate(cells):
            sc = header_scope(v, periods)
            if sc and value_columns[sc] is None:
                value_columns[sc] = c
        numeric_columns = [c for c in range(len(cells)) if c != label_col]
        if value_columns["CY"] is None and len(numeric_columns) > 0:
            value_columns["CY"] = numeric_columns[0]
        if value_columns["PY"] is None and len(numeric_columns) > 1:
            value_columns["PY"] = next((c for c in numeric_columns if c != value_columns["CY"]), None)
    else:
        value_columns["CY"] = 1
        value_columns["PY"] = 2

    start = header_row + 1
    items = []
    for i in range(start, len(rows)):
        row = rows[i] or []
        if label_col >= len(row):
            continue
        line_item = str(row[label_col] or "").strip()
        if not line_item:
            continue
        cy_val = None
        if value_columns["CY"] is not None and value_columns["CY"] < len(row):
            cy_val = parse_excel_amount(row[value_columns["CY"]])
        py_val = None
        if value_columns["PY"] is not None and value_columns["PY"] < len(row):
            py_val = parse_excel_amount(row[value_columns["PY"]])
        if cy_val is None and py_val is None:
            continue
        items.append({
            "lineItem": line_item,
            "cy": cy_val,
            "py": py_val,
            "type": st_type,
            "sheetName": sheet_name,
            "sourceRow": i + 1,
        })
    return items


def parse_excel_workbook(data: Union[bytes, bytearray], periods: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    wb = openpyxl.load_workbook(io.BytesIO(data), data_only=True)
    rows: List[Dict[str, Any]] = []
    ignored_sheets: List[str] = []

    for name in wb.sheetnames:
        ws = wb[name]
        sheet_rows = list(ws.iter_rows(values_only=True))
        sheet_list = [list(r) for r in sheet_rows]
        st_type = sheet_type(name, sheet_list)
        if not st_type:
            ignored_sheets.append(name)
            continue
        rows.extend(parse_sheet(name, sheet_list, st_type, periods))

    if not rows:
        raise ValueError("No Balance Sheet or Profit and Loss rows with numeric values were found.")

    return {"rows": rows, "ignoredSheets": ignored_sheets}


parseExcelWorkbook = parse_excel_workbook


def statement_targets(A: Any, S: Any, st_type: str) -> List[Dict[str, Any]]:
    code = "100100" if st_type == "balance" else "100200"
    elr = A.elr_by_code(code)
    if not elr:
        return []
    seen = set()
    out = []
    for row in S.elr_view(elr["uri"])["rows"]:
        if row.get("kind") != "item" or not A.is_numeric(row.get("concept")) or row.get("concept") in seen:
            continue
        seen.add(row["concept"])
        out.append({"concept": row["concept"], "label": row.get("label") or A.label(row["concept"]), "elrUri": elr["uri"]})
    return out


statementTargets = statement_targets


def suggest_excel_targets(A: Any, targets: List[Dict[str, Any]], line_item: str) -> List[Dict[str, Any]]:
    wanted = normalize_excel_label(line_item)
    if not wanted:
        return []
    res = []
    for target in targets:
        c_info = A.concept(target["concept"])
        labels = list((c_info.get("labels", {}) if c_info else {}).values())
        cand_labels = [target["label"], A.label(target["concept"])] + labels + [target["concept"].split(":")[-1]]
        if any(normalize_excel_label(l) == wanted for l in cand_labels):
            res.append(target)
    return res


suggestExcelTargets = suggest_excel_targets
