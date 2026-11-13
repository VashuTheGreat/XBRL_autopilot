from fastapi import APIRouter
from api.responses import error_response
from api.v1.schemas.fix import FixRequest

router = APIRouter()


@router.post("/propose")
async def propose_fix(body: FixRequest | None = None):
    return error_response(
        "Fix agent is temporarily disabled for architectural refactoring.",
        status_code=503,
    )
