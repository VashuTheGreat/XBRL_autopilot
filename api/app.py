import hmac

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from api.v1.routes import taxonomies
from src.app_config import get_app_config
from src.constants import CI_TAXONOMY_VDB, COSTING_TAXONOMY_VDB, IND_AS_TAXONOMY_VDB

SIDECAR_VERSION = "0.1.0"
PUBLIC_PATHS = {"/health"}

app = FastAPI(title="XBRL Autopilot sidecar", version=SIDECAR_VERSION)


@app.middleware("http")
async def require_token(request: Request, call_next):
    """When launched by the desktop app, every route except /health needs the per-launch token.

    `make dev` (no XAP_TOKEN) keeps the API open for local development.
    """
    expected = get_app_config().xap_token
    if expected and request.url.path not in PUBLIC_PATHS:
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied, f"Bearer {expected}"):
            return JSONResponse(
                status_code=401,
                content={"data": None, "message": "Unauthorized", "success": False, "errors": None},
            )
    return await call_next(request)


@app.get("/health")
async def health():
    cfg = get_app_config()
    return {
        "status": "ok",
        "version": SIDECAR_VERSION,
        "taxonomies": [CI_TAXONOMY_VDB, IND_AS_TAXONOMY_VDB, COSTING_TAXONOMY_VDB],
        "ai": {"enabled": bool(cfg.groq_api_key), "model": cfg.groq_model if cfg.groq_api_key else None},
    }


app.include_router(router=taxonomies.router, prefix="/api/v1/taxonomies")
