"""Standard template (docs/17, input path 1): build it, fill it, and read it back through /indas/transform's pipeline."""
import asyncio
import pathlib
import pickle
from io import BytesIO

from openpyxl import load_workbook

from src.pipeline.indas_transformation import IndasTransformationPipeline
from src.transformation.template import (
    CANONICAL_SCHEMA,
    README_SHEET,
    build_standard_template,
    is_standard_template,
    read_standard_template,
)
from src.utils.main_utils import load_object


def _write_template(path: pathlib.Path) -> None:
    path.write_bytes(build_standard_template())


def test_template_has_readme_then_the_six_canonical_sheets_with_their_headers():
    wb = load_workbook(BytesIO(build_standard_template()))
    assert wb.sheetnames == [README_SHEET, *CANONICAL_SCHEMA]
    for name, cols in CANONICAL_SCHEMA.items():
        header = [c.value for c in wb[name][1]][: len(cols)]
        assert header == cols
        assert wb[name].max_row == 1 or all(c.value is None for c in wb[name][2])


def test_blank_template_is_recognised(tmp_path):
    f = tmp_path / "t.xlsx"
    _write_template(f)
    assert is_standard_template(f)


def test_a_client_workbook_is_not_a_template(tmp_path):
    f = tmp_path / "t.xlsx"
    _write_template(f)
    wb = load_workbook(f)
    wb["CANONICAL_BS"]["B1"] = "Particulars"
    wb.save(f)
    assert not is_standard_template(f)
    assert not is_standard_template(tmp_path / "missing.xlsx")


def _filled(tmp_path) -> pathlib.Path:
    f = tmp_path / "filled.xlsx"
    _write_template(f)
    wb = load_workbook(f)
    ws = wb["CANONICAL_BS"]
    ws.append([1, "Property, plant and equipment", "Assets > Non-current assets", "3", 1500000, 1200000])
    ws.append([None, None, None, None, None, None])
    ws.append([2, "Total assets", "Assets", None, 1500000, 1200000])
    wb["CANONICAL_PL"].append([1, "Revenue from operations", "Income", "18", 9000000, None])
    wb.save(f)
    return f


def test_filled_template_reads_back_rows_and_drops_blank_lines(tmp_path):
    sheets = read_standard_template(_filled(tmp_path))
    assert list(sheets) == list(CANONICAL_SCHEMA)
    bs = sheets["CANONICAL_BS"]
    assert bs["Line_Item"].tolist() == ["Property, plant and equipment", "Total assets"]
    assert sheets["CANONICAL_CF"].empty


def test_transform_passes_a_filled_template_through_without_heuristics(tmp_path):
    out = tmp_path / "out" / "CANONICAL_MASTER.xlsx"
    out.parent.mkdir()
    res = asyncio.run(IndasTransformationPipeline().initiate(str(_filled(tmp_path)), str(out)))
    assert res["success"], res
    summary = res["summary"]
    assert summary["source"] == "standard_template"
    bs = summary["sheets"]["CANONICAL_BS"]
    assert bs[0]["Line_Item"] == "Property, plant and equipment"
    assert bs[0]["Current_Year_Amount"] == 1500000
    assert summary["sheets"]["CANONICAL_PL"][0]["Previous_Year_Amount"] is None  # NaN -> None (JSON-safe)
    assert load_workbook(out).sheetnames == list(CANONICAL_SCHEMA)


def test_pickles_with_a_foreign_os_path_load_here(tmp_path):
    # db/*.pkl is built on Linux; a PosixPath inside must still load on Windows (and vice versa).
    foreign = "WindowsPath" if isinstance(pathlib.Path(), pathlib.PosixPath) else "PosixPath"
    # protocol 0 names classes as plain text lines, so the class name can be swapped without breaking lengths
    data = pickle.dumps({"p": pathlib.Path("db/x.pkl")}, protocol=0).replace(type(pathlib.Path()).__name__.encode(), foreign.encode())
    f = tmp_path / "x.pkl"
    f.write_bytes(data)
    obj = asyncio.run(load_object(f))
    assert pathlib.Path(obj["p"]).name == "x.pkl"


def test_master_fields_come_from_the_mandatory_rules_and_skip_tables():
    from src.services.master_fields import master_fields

    kb = {
        "concepts": {
            "in-ca:NameOfCompany": {"name": "NameOfCompany", "type": "stringItemType", "labels": {"label": "Name of company"}},
            "in-ca:DetailsRegardingAuditorsTable": {"name": "DetailsRegardingAuditorsTable", "abstract": True},
            "in-ca:WhetherAuditorsReportHasBeenQualified": {"name": "W", "type": "booleanItemType", "labels": {}},
        },
        "businessRules": {"mandatoryByELR": {
            "700300": ["in-ca:NameOfCompany", "in-ca:Unknown"],
            "700400": ["in-ca:DetailsRegardingAuditorsTable", "in-ca:WhetherAuditorsReportHasBeenQualified"],
        }},
    }
    out = master_fields(kb)
    assert out["company"] == [{"qname": "in-ca:NameOfCompany", "label": "Name of company", "type": "stringItemType"}]
    assert out["auditor"] == [{"qname": "in-ca:WhetherAuditorsReportHasBeenQualified", "label": "W", "type": "booleanItemType"}]
