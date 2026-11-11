"""The stored origin (first row, first column) of each worksheet.

Rule ids carry the source line (``SR-L<line>-n``), and lines have always been counted from the first row of
the sheet's *stored* range (what SheetJS calls ``!ref``): the BIFF8 DIMENSIONS record of an ``.xls``, the
``<dimension ref>`` of an ``.xlsx``. That range can start above the first non-empty cell (a formatted blank
row), which python-calamine skips, so it is read here directly to keep every rule id stable.
"""
from __future__ import annotations

import re
import struct
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

Origin = tuple[int, int]  # 0-based (row, column)

_ENDOFCHAIN = 0xFFFFFFFE


def sheet_origins(path: Path) -> dict[str, Origin]:
    data = path.read_bytes()
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return _xls_origins(_cfb_stream(data, "Workbook"))
    if data[:2] == b"PK":
        return _xlsx_origins(path)
    raise ValueError(f"Not an Excel workbook: {path.name}")


# ------------------------------------------------------------------------------------------------- .xls
def _cfb_stream(data: bytes, name: str) -> bytes:
    """One stream of an OLE2 compound file (only what a BIFF8 workbook needs: regular sectors, no mini stream)."""
    sector_size = 1 << struct.unpack_from("<H", data, 0x1E)[0]
    n_fat, first_dir = struct.unpack_from("<II", data, 0x2C)
    first_difat, n_difat = struct.unpack_from("<II", data, 0x44)

    def sector(i: int) -> bytes:
        off = (i + 1) * sector_size
        return data[off : off + sector_size]

    fat_sectors = list(struct.unpack_from("<109I", data, 0x4C))[: min(n_fat, 109)]
    d = first_difat
    for _ in range(n_difat):
        ids = struct.unpack(f"<{sector_size // 4}I", sector(d))
        fat_sectors.extend(ids[:-1])
        d = ids[-1]
    fat_sectors = fat_sectors[:n_fat]
    fat: list[int] = []
    for s in fat_sectors:
        fat.extend(struct.unpack(f"<{sector_size // 4}I", sector(s)))

    def chain(start: int) -> bytes:
        out, s, seen = [], start, 0
        while s != _ENDOFCHAIN and seen <= len(fat):
            out.append(sector(s))
            s, seen = fat[s], seen + 1
        return b"".join(out)

    directory = chain(first_dir)
    for off in range(0, len(directory), 128):
        entry = directory[off : off + 128]
        name_len = struct.unpack_from("<H", entry, 64)[0]
        entry_name = entry[: max(name_len - 2, 0)].decode("utf-16-le", "replace")
        if entry_name == name:
            start, size = struct.unpack_from("<II", entry, 116)
            return chain(start)[:size]
    raise ValueError(f"Stream '{name}' not found in the workbook")


def _records(stream: bytes, pos: int = 0):
    while pos + 4 <= len(stream):
        rtype, length = struct.unpack_from("<HH", stream, pos)
        yield pos, rtype, stream[pos + 4 : pos + 4 + length]
        pos += 4 + length


def _xls_origins(stream: bytes) -> dict[str, Origin]:
    sheets: list[tuple[str, int]] = []
    for _, rtype, body in _records(stream):
        if rtype == 0x0085:  # BOUNDSHEET8: lbPlyPos, hsState, dt, ShortXLUnicodeString
            offset = struct.unpack_from("<I", body, 0)[0]
            cch, flags = body[6], body[7]
            raw = body[8:]
            name = raw[: cch * 2].decode("utf-16-le") if flags & 1 else raw[:cch].decode("latin-1")
            sheets.append((name, offset))
        elif rtype == 0x000A:  # EOF of the workbook globals
            break
    out: dict[str, Origin] = {}
    for name, offset in sheets:
        origin: Origin = (0, 0)
        for _, rtype, body in _records(stream, offset):
            if rtype == 0x0200:  # DIMENSIONS: rwMic, rwMac (u32), colMic, colMac (u16)
                rw_mic, _, col_mic = struct.unpack_from("<IIH", body, 0)
                origin = (rw_mic, col_mic)
                break
            if rtype == 0x000A:
                break
        out[name] = origin
    return out


# ------------------------------------------------------------------------------------------------- .xlsx
_NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def _cell_origin(ref: str) -> Origin:
    m = re.match(r"([A-Z]+)(\d+)", ref.split(":")[0])
    if not m:
        return (0, 0)
    col = 0
    for ch in m.group(1):
        col = col * 26 + ord(ch) - 64
    return int(m.group(2)) - 1, col - 1


def _xlsx_origins(path: Path) -> dict[str, Origin]:
    with zipfile.ZipFile(path) as z:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        targets = {r.get("Id"): r.get("Target") for r in rels}
        out: dict[str, Origin] = {}
        for s in wb.iterfind("m:sheets/m:sheet", _NS):
            target = targets[s.get(_REL)].lstrip("/")
            part = target if target.startswith("xl/") else f"xl/{target}"
            origin: Origin = (0, 0)
            with z.open(part) as f:
                for _, el in ET.iterparse(f, events=("start",)):
                    if el.tag.endswith("}dimension"):
                        origin = _cell_origin(el.get("ref", "A1"))
                        break
                    if el.tag.endswith("}sheetData"):
                        break
            out[s.get("name")] = origin
        return out
