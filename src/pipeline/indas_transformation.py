import asyncio
from typing import Any, Dict

from .base import Pipeline
from ..transformation.indas import MasterFinancialExtractor
from ..core.logger import logger


class IndasTransformationPipeline(Pipeline):
    def __init__(self):
        pass

    def _execute(self, input_file_path: str, output_file_path: str) -> Dict[str, Any]:
        master_financial_extractor = MasterFinancialExtractor(path=input_file_path)
        sheets, summary = master_financial_extractor.run(out_main=output_file_path)
        summary["canonical_sheets"] = {s: f"{df.shape[0]} rows, {df.shape[1]} cols" for s, df in sheets.items()}
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
