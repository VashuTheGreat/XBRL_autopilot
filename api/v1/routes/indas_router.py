import asyncio
import uuid
from typing import Optional
from fastapi import APIRouter
from fastapi.responses import FileResponse

from ...responses import error_response, success_response
from src.constants import BASE_DIR, INDAS_OUTPUT_JSON_PATH, IND_AS_TAXONOMY_VDB, OUTPUT_DIR
from src.core.logger import logger
from src.utils.main_utils import load_json
from src.pipeline.recom_taxonomies_pipeline import RecommendationPipeline
from api.v1.schemas.indas_schema import RecommendSchema, GenerateXML
from src.pipeline.xml_generation_pipeline import XMLGenerationPipeline
from api.helper.delete_file import delete_file_after, delete_folder

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
                asyncio.create_task(delete_file_after(file_path=file_path, after=900.0))

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
async def download_xml(unique_id: str, file_name: str):
    with logger.span("indas.download_xml", unique_id=unique_id, file_name=file_name):
        out_dir = BASE_DIR / OUTPUT_DIR / unique_id
        if not out_dir.exists():
            logger.warning("indas.download_dir_not_found", unique_id=unique_id, path=str(out_dir))
            return error_response(message="File not found or download link has expired", status_code=404)

        target_file = out_dir / file_name
        if not target_file.exists():
            logger.warning("indas.download_file_not_found", unique_id=unique_id, file_name=file_name)
            return error_response(message="XML file not found or expired", status_code=404)

        logger.info("indas.file_served_for_download", unique_id=unique_id, file_path=str(target_file))
        return FileResponse(
            path=str(target_file),
            filename=target_file.name,
            media_type="application/xml",
        )


@router.delete("/output/{unique_id}")
async def delete_output_folder(unique_id: str):
    with logger.span("indas.delete_output_folder", unique_id=unique_id):
        out_dir = BASE_DIR / OUTPUT_DIR / unique_id
        if not out_dir.exists():
            logger.warning("indas.delete_output_not_found", unique_id=unique_id)
            return error_response(message="Folder not found or already deleted", status_code=404)
        success = delete_folder(out_dir)
        if success:
            logger.info("indas.delete_output_success", unique_id=unique_id)
            return success_response(message=f"Output directory for '{unique_id}' successfully deleted", data={"uniqueId": unique_id})
        return error_response(message="Failed to delete output directory", status_code=500)
