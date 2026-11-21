"""The standard XBRL Autopilot template (docs/17, input path 1).

One workbook with the six canonical sheets the transformation produces (columns from `indas.py`, the single
source), plus a README sheet. A CA fills it (by hand or with any AI tool) and uploads it; `/indas/transform`
then reads it as-is instead of guessing the layout (`read_standard_template`).
"""
from __future__ import annotations

from collections import OrderedDict
from io import BytesIO
from pathlib import Path

import pandas as pd
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .indas import BS_COLS, CF_COLS, FINANCIAL_NOTES_COLS, PL_COLS, PPE_COLS, SOCIE_COLS

TEMPLATE_FILE_NAME = "XBRL_Autopilot_Standard_Template.xlsx"
README_SHEET = "README"

CANONICAL_SCHEMA: "OrderedDict[str, list[str]]" = OrderedDict([
    ("CANONICAL_BS", BS_COLS),
    ("CANONICAL_PL", PL_COLS),
    ("CANONICAL_CF", CF_COLS),
    ("CANONICAL_SOCIE", SOCIE_COLS),
    ("CANONICAL_PPE_SCHEDULE", PPE_COLS),
    ("CANONICAL_FINANCIAL_NOTES", FINANCIAL_NOTES_COLS),
])

SHEET_HELP = {
    "CANONICAL_BS": "Balance Sheet, one row per line in the printed order (headings, items and totals).",
    "CANONICAL_PL": "Statement of Profit and Loss, one row per line in the printed order.",
    "CANONICAL_CF": "Cash Flow Statement, one row per line in the printed order.",
    "CANONICAL_SOCIE": "Statement of Changes in Equity: one row per movement of each equity component.",
    "CANONICAL_PPE_SCHEDULE": "Property, plant and equipment schedule: one row per asset class (gross block, depreciation, net block).",
    "CANONICAL_FINANCIAL_NOTES": "Notes to accounts: one row per numeric line of each note, with its note number.",
}

COLUMN_HELP = {
    "Row_Index": "1, 2, 3 ... in the printed order",
    "Line_Item": "The particulars exactly as printed",
    "Breadcrumb_Hierarchy": "Parent headings joined by ' > ', e.g. Assets > Non-current assets > Property, plant and equipment",
    "Note_No": "Note reference as printed (e.g. 3, 4.1); blank if none",
    "Current_Year_Amount": "Number in full rupees (no commas, no 'Lakhs'); negative with a minus sign",
    "Previous_Year_Amount": "Same as above, for the previous year",
    "Equity_Component": "Equity Share Capital / Retained Earnings / other reserve",
    "Transaction_Description": "The movement, e.g. Profit for the year, Dividends paid",
    "Asset_Class": "e.g. Buildings, Plant and machinery, Computers",
    "Gross_* / Dep_* / Net_*": "PPE amounts: gross block opening, additions, disposals, closing; depreciation the same; net block CY and PY",
}

TEXT_COLUMNS = frozenset({
    "Row_Index", "Line_Item", "Breadcrumb_Hierarchy", "Note_No", "Equity_Component", "Transaction_Description", "Asset_Class",
})
WIDE_COLUMNS = frozenset({"Line_Item", "Breadcrumb_Hierarchy", "Transaction_Description"})

_HEADER_FONT = Font(bold=True, color="FFFFFF")
_HEADER_FILL = PatternFill("solid", fgColor="1F4E78")
_AMOUNT_FORMAT = "#,##0.00;-#,##0.00"
_FORMATTED_ROWS = 500


def build_standard_template() -> bytes:
    """The template workbook as .xlsx bytes (README first, then the six canonical sheets with headers only)."""
    wb = Workbook()
    readme = wb.active
    readme.title = README_SHEET
    readme.append(["XBRL Autopilot - standard financial statements template"])
    readme.append([])
    readme.append(["Fill each sheet below. Keep the sheet names and the header row unchanged, then upload this file in XBRL Autopilot."])
    readme.append(["Amounts are in full rupees. Leave a cell blank if there is no amount (do not type '-')."])
    readme.append([])
    sheet_header_row = readme.max_row + 1
    readme.append(["Sheet", "What goes in it"])
    for name in CANONICAL_SCHEMA:
        readme.append([name, SHEET_HELP[name]])
    readme.append([])
    column_header_row = readme.max_row + 1
    readme.append(["Column", "How to fill it"])
    for col, text in COLUMN_HELP.items():
        readme.append([col, text])
    readme["A1"].font = Font(bold=True, size=14)
    for r in (sheet_header_row, column_header_row):
        readme.cell(row=r, column=1).font = Font(bold=True)
        readme.cell(row=r, column=2).font = Font(bold=True)
    readme.column_dimensions["A"].width = 30
    readme.column_dimensions["B"].width = 110

    for name, cols in CANONICAL_SCHEMA.items():
        ws = wb.create_sheet(name)
        ws.append(cols)
        for i, col in enumerate(cols, start=1):
            header = ws.cell(row=1, column=i)
            header.font, header.fill, header.alignment = _HEADER_FONT, _HEADER_FILL, Alignment(vertical="center")
            ws.column_dimensions[get_column_letter(i)].width = 45 if col in WIDE_COLUMNS else 20
            if col not in TEXT_COLUMNS:
                for r in range(2, _FORMATTED_ROWS + 2):
                    ws.cell(row=r, column=i).number_format = _AMOUNT_FORMAT
        ws.freeze_panes = "A2"

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def is_standard_template(path: str | Path) -> bool:
    """True when the workbook has all six canonical sheets with exactly the canonical header rows."""
    try:
        wb = load_workbook(path, read_only=True, data_only=True)
    except Exception:
        return False
    try:
        for name, cols in CANONICAL_SCHEMA.items():
            if name not in wb.sheetnames:
                return False
            header = next(wb[name].iter_rows(min_row=1, max_row=1, values_only=True), ())
            found = [str(h).strip() if h is not None else "" for h in header[: len(cols)]]
            if found != cols:
                return False
        return True
    finally:
        wb.close()


def read_standard_template(path: str | Path) -> "OrderedDict[str, pd.DataFrame]":
    """The six canonical sheets of a filled template, blank rows dropped, columns in canonical order."""
    out: "OrderedDict[str, pd.DataFrame]" = OrderedDict()
    for name, cols in CANONICAL_SCHEMA.items():
        df = pd.read_excel(path, sheet_name=name, dtype=object, engine="openpyxl")
        df = df.reindex(columns=cols).dropna(how="all")
        out[name] = df.reset_index(drop=True)
    return out
