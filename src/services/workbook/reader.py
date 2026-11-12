"""Read an Excel workbook (.xls BIFF, also .xlsx/.xlsb/.ods) into the WorkbookModel the desktop app renders.

The shape mirrors `ui/shared/workbook.ts` (minus `source` / `fileName`, which the app owns):
    {"sheets": [{"name", "rowCount", "colCount", "cells": [{"r", "c", "v", "numFmt"?}], "merges": [{"r1","c1","r2","c2"}],
                 "colWidths": {}}]}

Stateless and pure: bytes in, dict out. python-calamine gives values, merges and visibility.
For .xls (BIFF) files, xlrd reads BIFF XF records to extract number formats (numFmt) so amounts round
to the format's decimal places, matching .xlsx behaviour (ADR-0013 step 6).
Hidden sheets are working papers, not statements, and are skipped (as the .xlsx reader does).
"""
from __future__ import annotations

import datetime as dt
import io
import math
from typing import Any

from python_calamine import CalamineWorkbook, SheetTypeEnum, SheetVisibleEnum


class UnreadableWorkbookError(ValueError):
    """The bytes are not a workbook calamine can read, or it has no visible worksheet."""


def _cell_value(v: Any) -> str | float | bool | None:
    """Calamine value → JSON cell value (same rules as the .xlsx reader: dates as yyyy-mm-dd, blanks dropped)."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if v.time() == dt.time() else v.isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, (dt.time, dt.timedelta)):
        return str(v)
    s = str(v)
    return s if s.strip() else None


def _load_xls_formats(data: bytes) -> dict[str, dict[tuple[int, int], str]]:
    """Map (sheet_name -> (r, c) -> numFmt) from BIFF XF records using xlrd."""
    if not data.startswith(b"\xd0\xcf\x11\xe0"):
        return {}
    try:
        import xlrd
        book = xlrd.open_workbook(file_contents=data, formatting_info=True)
    except Exception:
        return {}

    formats: dict[str, dict[tuple[int, int], str]] = {}
    for name in book.sheet_names():
        try:
            s = book.sheet_by_name(name)
        except Exception:
            continue
        sheet_fmts = {}
        for r in range(s.nrows):
            for c in range(s.ncols):
                try:
                    cell = s.cell(r, c)
                    if cell.ctype == xlrd.XL_CELL_EMPTY:
                        continue
                    xf = book.xf_list[cell.xf_index]
                    fmt = book.format_map.get(xf.format_key)
                    if fmt and fmt.format_str and fmt.format_str != "General":
                        sheet_fmts[(r, c)] = fmt.format_str
                except Exception:
                    continue
        formats[name] = sheet_fmts
    return formats


def read_workbook(data: bytes) -> dict:
    try:
        wb = CalamineWorkbook.from_filelike(io.BytesIO(data))
    except Exception as exc:  # calamine raises several error types for unreadable input
        raise UnreadableWorkbookError("The file could not be read as an Excel workbook.") from exc

    xls_formats = _load_xls_formats(data)

    sheets = []
    for meta in wb.sheets_metadata:
        if meta.typ != SheetTypeEnum.WorkSheet or meta.visible != SheetVisibleEnum.Visible:
            continue
        sheet = wb.get_sheet_by_name(meta.name)
        sheet_fmts = xls_formats.get(meta.name, {})
        rows = sheet.to_python(skip_empty_area=False)
        cells = []
        max_r = max_c = 0
        for r, row in enumerate(rows):
            for c, raw in enumerate(row):
                v = _cell_value(raw)
                if v is None:
                    continue
                cell_item: dict[str, Any] = {"r": r, "c": c, "v": v}
                if (r, c) in sheet_fmts:
                    cell_item["numFmt"] = sheet_fmts[(r, c)]
                cells.append(cell_item)
                max_r, max_c = max(max_r, r), max(max_c, c)
        merges = [
            {"r1": a[0], "c1": a[1], "r2": b[0], "c2": b[1]} for a, b in (sheet.merged_cell_ranges or [])
        ]
        sheets.append(
            {
                "name": meta.name,
                "rowCount": max_r + 1,
                "colCount": max_c + 1,
                "cells": cells,
                "merges": merges,
                "colWidths": {},
            }
        )
    if not sheets:
        raise UnreadableWorkbookError("The workbook has no visible worksheets.")
    return {"sheets": sheets}

