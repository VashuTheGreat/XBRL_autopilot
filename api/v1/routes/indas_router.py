import asyncio
import os
import uuid
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, Form
from fastapi.responses import FileResponse, Response

from ...responses import error_response, success_response
from src.constants import BASE_DIR, INDAS_OUTPUT_JSON_PATH, IND_AS_TAXONOMY_VDB, OUTPUT_DIR, DELETE_FILE_AFTER
from src.core.logger import logger
from src.utils.main_utils import load_file, load_json, save_file
from src.pipeline.recom_taxonomies_pipeline import RecommendationPipeline
from api.v1.schemas.indas_schema import RecommendSchema, GenerateXML
from src.pipeline.xml_generation_pipeline import XMLGenerationPipeline
from api.helper.delete_file import delete_file_after
from src.pipeline.indas_transformation import IndasTransformationPipeline
from api.middlewares.multi_middleware import multer_middleware
from src.transformation.template import TEMPLATE_FILE_NAME, build_standard_template
from src.services.master_fields import master_fields
recomm_pipeline = RecommendationPipeline()
router = APIRouter()


@router.get("/authority")
async def get_autherity():
    with logger.span("indas.get_authority"):
        try:
            data = await load_json(path=INDAS_OUTPUT_JSON_PATH)
            logger.info("indas.authority_served", path=str(INDAS_OUTPUT_JSON_PATH))
            return success_response(data=data)
        except FileNotFoundError as e:
            logger.error("indas.authority_not_found", path=str(INDAS_OUTPUT_JSON_PATH), error=str(e))
            return error_response(message="Knowledge Base file not found", status_code=500, errors=e)
        except Exception as e:
            logger.error("indas.authority_error", error=str(e))
            return error_response(message=f"Failed to load authority: {str(e)}", status_code=500)


@router.get("/master-fields")
async def get_master_fields():
    """Mandatory company and auditor fields (qname, label, type) for the master-data form."""
    with logger.span("indas.master_fields"):
        try:
            kb = await load_json(path=INDAS_OUTPUT_JSON_PATH)
            return success_response(data=master_fields(kb), message="master fields", status_code=200)
        except Exception as e:
            logger.error("indas.master_fields_failed", error=str(e))
            return error_response(message=f"Failed to load master fields: {str(e)}", status_code=500)


@router.get("/template")
async def download_template():
    """The standard template (docs/17, input path 1): README + the six canonical sheets, from the canonical columns."""
    with logger.span("indas.download_template"):
        content = await asyncio.to_thread(build_standard_template)
        return Response(
            content=content,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{TEMPLATE_FILE_NAME}"'},
        )


@router.post("/recommend/")
async def recommend_taxonomies(payload: RecommendSchema):
    with logger.span("indas.recommend_taxonomies", keys_count=len(payload.keys), top_k=payload.top_k):
        try:
            data = await recomm_pipeline.initiate(
                keys=payload.keys,
                collection=IND_AS_TAXONOMY_VDB,
                top_k=payload.top_k,
                filter=payload.filter,
            )
            logger.info("indas.recommend_taxonomies_completed", count=len(data) if data else 0)
            return success_response(data=data, message="taxonomies taged returned", status_code=200)
        except TimeoutError as e:
            logger.error("indas.recommend_taxonomies_timeout", error=str(e))
            return error_response(message="timeout", status_code=500, errors=e)
        except Exception as e:
            logger.error("indas.recommend_taxonomies_failed", error=str(e))
            return error_response(message=f"Recommendation failed: {str(e)}", status_code=500)


@router.post("/generateXML")
async def generate_xml(payload: GenerateXML):
    unique_id = payload.unique_id or str(uuid.uuid4())[:8]
    with logger.span("indas.generate_xml", unique_id=unique_id):
        try:
            pipeline = XMLGenerationPipeline(payload=payload.model_dump())
            data = await pipeline.initiate(unique_id=unique_id)

            if data.get("success"):
                file_path = data["file_path"]
                file_name = data.get("file_name", "MCA_AOC4_XML.xml")
                download_url = f"/api/v1/indas/download/{unique_id}/{file_name}"

                # Auto cleanup directory after 15 minutes (non-blocking)
                asyncio.create_task(delete_file_after(file_path=file_path, after=DELETE_FILE_AFTER))

                logger.info(
                    "indas.xml_generated_successfully",
                    unique_id=unique_id,
                    file_name=file_name,
                    file_size_kb=data.get("file_size_kb", 0.0),
                    download_url=download_url,
                )

                return success_response(
                    data={
                        "status": "SUCCESS",
                        "canExport": True,
                        "uniqueId": unique_id,
                        "fileName": file_name,
                        "filePath": file_path,
                        "fileSizeKb": data.get("file_size_kb", 0.0),
                        "downloadUrl": download_url,
                        "xmlContent": data.get("xml_content"),
                    },
                    message="XML generated successfully. Download URL is valid for 15 minutes.",
                    status_code=200,
                )

            logger.warning(
                "indas.xml_validation_rejected",
                unique_id=unique_id,
                error_count=len(data.get("errors", [])),
            )
            return error_response(
                message="Failed to generate XML: statutory validation failed",
                status_code=422,
                errors=data.get("errors", []),
            )
        except Exception as e:
            logger.error("indas.generate_xml_failed", unique_id=unique_id, error=str(e))
            return error_response(message=f"XML generation failed: {str(e)}", status_code=500)


@router.get("/download/{unique_id}/{file_name}")
async def download_file(unique_id: str, file_name: str):
    with logger.span("indas.download_file", unique_id=unique_id, file_name=file_name):
        out_dir = BASE_DIR / OUTPUT_DIR / unique_id
        if not out_dir.exists():
            logger.warning("indas.download_dir_not_found", unique_id=unique_id, path=str(out_dir))
            return error_response(message="File not found or download link has expired", status_code=404)

        target_file = out_dir / file_name
        if not target_file.exists():
            logger.warning("indas.download_file_not_found", unique_id=unique_id, file_name=file_name)
            return error_response(message="File not found or expired", status_code=404)

        lower_name = file_name.lower()
        if lower_name.endswith(".xlsx"):
            media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        elif lower_name.endswith(".xls"):
            media_type = "application/vnd.ms-excel"
        elif lower_name.endswith(".xml"):
            media_type = "application/xml"
        elif lower_name.endswith(".json"):
            media_type = "application/json"
        else:
            media_type = "application/octet-stream"

        logger.info("indas.file_served_for_download", unique_id=unique_id, file_path=str(target_file))
        return FileResponse(
            path=str(target_file),
            filename=target_file.name,
            media_type=media_type,
        )



@router.post("/transform")
async def transform_file(
    saved_paths: List[str] = Depends(multer_middleware),
    unique_id: Optional[str] = Form(None),
):
    unique_id = unique_id or str(uuid.uuid4())[:8]
    with logger.span("indas.transform_file", unique_id=unique_id):
        try:
            if not saved_paths or not saved_paths[0]:
                logger.warning("indas.transform_no_file_uploaded")
                return error_response(
                    message="No file uploaded. Please upload a valid .xls or .xlsx file under field 'file'.",
                    status_code=400,
                )

            input_file_path = saved_paths[0]
            filename = Path(input_file_path).name
            lower_name = filename.lower()
            if not (lower_name.endswith(".xlsx") or lower_name.endswith(".xls")):
                logger.warning("indas.transform_invalid_file_type", filename=filename)
                return error_response(
                    message="Invalid file format. Only Excel files (.xls, .xlsx) are supported.",
                    status_code=400,
                )

            work_dir = BASE_DIR / OUTPUT_DIR / unique_id
            work_dir.mkdir(parents=True, exist_ok=True)

            output_file_name = f"CANONICAL_MASTER_{Path(filename).stem}.xlsx"
            output_file_path = work_dir / output_file_name

            # Initiate transformation pipeline
            pipeline = IndasTransformationPipeline()
            data = await pipeline.initiate(
                input_file_path=str(input_file_path),
                output_file_path=str(output_file_path),
            )

            if data.get("success"):
                file_size_kb = round(os.path.getsize(output_file_path) / 1024, 2)
                download_url = f"/api/v1/indas/download/{unique_id}/{output_file_name}"

                # Auto cleanup output directory after 15 minutes (non-blocking)
                asyncio.create_task(delete_file_after(file_path=output_file_path, after=DELETE_FILE_AFTER))

                logger.info(
                    "indas.workbook_transformed_successfully",
                    unique_id=unique_id,
                    file_name=output_file_name,
                    file_size_kb=file_size_kb,
                    download_url=download_url,
                )

                return success_response(
                    data={
                        "status": "SUCCESS",
                        "canExport": True,
                        "uniqueId": unique_id,
                        "fileName": output_file_name,
                        "filePath": str(output_file_path),
                        "fileSizeKb": file_size_kb,
                        "downloadUrl": download_url,
                        "summary": {k: v for k, v in data.get("summary", {}).items() if k != "sheets"},
                        # canonical rows as JSON (sheet -> rows), so the app needn't read the xlsx back
                        "sheets": data.get("summary", {}).get("sheets", {}),
                    },
                    message="Workbook transformed successfully. Download URL is valid for 15 minutes.",
                    status_code=200,
                )

            logger.error("indas.transform_failed", unique_id=unique_id, error=data.get("err"))
            return error_response(
                message=f"Transformation failed: {data.get('err', 'Unknown error')}",
                status_code=500,
            )
        except Exception as e:
            logger.error("indas.transform_exception", unique_id=unique_id, error=str(e))
            return error_response(message=f"Workbook transformation failed: {str(e)}", status_code=500)

