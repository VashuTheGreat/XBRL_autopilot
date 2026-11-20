import asyncio
import os
import shutil
from pathlib import Path
from src.core.logger import logger


def delete_folder(directory_path: str | Path) -> bool:
    """Synchronously delete a directory and its contents with structured logging."""
    path = Path(directory_path)
    with logger.span("cleanup.delete_folder", directory=str(path)):
        try:
            if path.exists() and path.is_dir():
                shutil.rmtree(path, ignore_errors=True)
                logger.info("cleanup.directory_deleted", directory=str(path))
                return True
            else:
                logger.debug("cleanup.directory_not_found_or_already_deleted", directory=str(path))
                return False
        except Exception as e:
            logger.error("cleanup.delete_folder_failed", directory=str(path), error=str(e))
            return False


async def delete_folder_after(directory_path: str | Path, after: float = 600.0) -> bool:
    """Asynchronously delete a directory after `after` seconds."""
    path = Path(directory_path)
    logger.info("cleanup.folder_cleanup_scheduled", directory=str(path), after_seconds=after)
    try:
        await asyncio.sleep(after)
        return delete_folder(path)
    except Exception as e:
        logger.error("cleanup.delete_folder_after_failed", directory=str(path), error=str(e))
        return False


async def delete_file_after(file_path: str | Path, after: float = 600.0) -> bool:
    """Deletes the parent output directory for file_path after `after` seconds."""
    target_dir = os.path.dirname(str(file_path))
    logger.info("cleanup.scheduled", file_path=str(file_path), directory=target_dir, after_seconds=after)
    try:
        await asyncio.sleep(after)
        if target_dir and os.path.exists(target_dir):
            shutil.rmtree(target_dir, ignore_errors=True)
            logger.info("cleanup.directory_deleted", directory=target_dir)
            return True
        else:
            logger.debug("cleanup.directory_already_gone", directory=target_dir)
            return False
    except Exception as e:
        logger.error("cleanup.failed", directory=target_dir, error=str(e))
        return False
