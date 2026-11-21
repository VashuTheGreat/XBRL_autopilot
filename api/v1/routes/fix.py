from fastapi import APIRouter
from api.responses import error_response
from api.v1.schemas.fix import FixRequest
from src.core.logger import logger

router = APIRouter()


@router.post("/propose")
async def propose_fix(body: FixRequest | None = None):
    with logger.span("fix.propose"):
        logger.warning("fix.disabled_for_refactoring")
        return error_response(
            "Fix agent is temporarily disabled for architectural refactoring.",
            status_code=503,
        )
