import os
import shutil
from typing import List
from fastapi import File, HTTPException, Request, UploadFile

from src.constants import BASE_DIR
from src.core.logger import logger

PUBLIC_DIRECTOR_NAME = str(BASE_DIR / "static")
INGESTION_FOLDER_NAME = "ingestion"
PUBLIC_TEMP_DIR = os.path.join(PUBLIC_DIRECTOR_NAME, INGESTION_FOLDER_NAME)
os.makedirs(PUBLIC_TEMP_DIR, exist_ok=True)


async def multer_middleware(
    request: Request,
    file: UploadFile = File(default=None),
):
    saved_paths: List[str] = []
    with logger.span("middleware.upload_processing"):
        try:
            if not file:
                logger.debug("middleware.upload_no_file")
                yield []
                return

            thread_id = getattr(request.state, "thread_id", "default")
            dest_dir = os.path.join(PUBLIC_TEMP_DIR, str(thread_id))
            os.makedirs(dest_dir, exist_ok=True)
            file_path = os.path.join(dest_dir, file.filename)

            logger.info("middleware.upload_storing", file_name=file.filename, destination=file_path)
            with open(file_path, "wb") as f:
                shutil.copyfileobj(file.file, f)
            saved_paths.append(file_path)
            logger.info("middleware.upload_stored", file_path=file_path)

            yield saved_paths

        except HTTPException:
            raise
        except Exception as e:
            logger.error("middleware.upload_failed", error=str(e))
            raise HTTPException(status_code=500, detail=str(e))

        finally:
            for file_path in saved_paths:
                try:
                    if os.path.exists(file_path):
                        os.remove(file_path)
                        logger.info("middleware.upload_cleaned", file_path=file_path)
                except Exception as clean_err:
                    logger.error("middleware.upload_cleanup_failed", file_path=file_path, error=str(clean_err))

            if saved_paths:
                dest_dir = os.path.dirname(saved_paths[0])
                if os.path.exists(dest_dir) and not os.listdir(dest_dir):
                    os.rmdir(dest_dir)
                    logger.debug("middleware.empty_dir_cleaned", directory=dest_dir)
