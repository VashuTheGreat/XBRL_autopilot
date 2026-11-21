import asyncio
import math
from typing import Any, Dict

import pandas as pd

from .base import Pipeline
from ..transformation.indas import MasterFinancialExtractor
from ..transformation.template import is_standard_template, read_standard_template
from ..core.logger import logger


def _cell(v: Any) -> Any:
    if v is None or v is pd.NaT or (isinstance(v, float) and math.isnan(v)):
        return None
    return v.item() if hasattr(v, "item") else v


def _records(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Rows as JSON-safe dicts (NaN -> None) so the app gets the canonical data without reading the xlsx back."""
    return [{str(k): _cell(v) for k, v in row.items()} for row in df.to_dict(orient="records")]


class IndasTransformationPipeline(Pipeline):
    def __init__(self):
        pass

    def _execute(self, input_file_path: str, output_file_path: str) -> Dict[str, Any]:
        if input_file_path.lower().endswith(".xlsx") and is_standard_template(input_file_path):
            # Path 1 (docs/17): the CA filled our standard template, so it is read as-is, without guessing.
            sheets = read_standard_template(input_file_path)
            with pd.ExcelWriter(output_file_path, engine="openpyxl") as xw:
                for name, df in sheets.items():
                    df.to_excel(xw, sheet_name=name, index=False)
            summary: Dict[str, Any] = {"source": "standard_template"}
        else:
            # Path 2: heuristic transformation of the client's own workbook.
            master_financial_extractor = MasterFinancialExtractor(path=input_file_path)
            sheets, summary = master_financial_extractor.run(out_main=output_file_path)
            summary["source"] = "heuristic"
        summary["canonical_sheets"] = {s: f"{df.shape[0]} rows, {df.shape[1]} cols" for s, df in sheets.items()}
        summary["sheets"] = {s: _records(df) for s, df in sheets.items()}
        return summary

    async def initiate(self, input_file_path: str, output_file_path: str) -> Dict[str, Any]:
        with logger.span("pipeline.indas_transformation", input=input_file_path, output=output_file_path):
            try:
                summary = await asyncio.to_thread(self._execute, input_file_path, output_file_path)
                return {
                    "success": True,
                    "file_path": output_file_path,
                    "summary": summary,
                }
            except Exception as e:
                logger.error("pipeline.indas_transformation_failed", error=str(e))
                return {"success": False, "err": str(e)}
