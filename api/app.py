import hmac
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from api.v1.routes import (
    chat_router,
    conversation_router,
    fix,
    workbooks,
    indas_router
)
from src.app_config import get_app_config
from src.constants import (
    
    IND_AS_TAXONOMY_VDB,
    AGENT_COLLECTION_NAME,
)
from src.core.logger import initialise_logger, logger

SIDECAR_VERSION = "0.1.0"
PUBLIC_PATHS = {"/health", "/docs", "/openapi.json"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialise_logger()
    logger.info("app.startup", version=SIDECAR_VERSION)
    yield
    logger.info("app.shutdown")


app = FastAPI(title="XBRL Autopilot sidecar", version=SIDECAR_VERSION, lifespan=lifespan)
try:
    logger.instrument_fastapi(app)
except Exception:
    pass




@app.get("/health")
async def health():
    cfg = get_app_config()
    return {
        "status": "ok",
        "version": SIDECAR_VERSION,
        "taxonomies": [IND_AS_TAXONOMY_VDB],
        "collections": [IND_AS_TAXONOMY_VDB, AGENT_COLLECTION_NAME],
        "ai": {"enabled": bool(cfg.groq_api_key), "model": cfg.groq_model if cfg.groq_api_key else None},
    }


# Sidecar core routes
app.include_router(router=workbooks.router, prefix="/api/v1/workbooks")
app.include_router(router=fix.router, prefix="/api/v1/fix")
app.include_router(router=indas_router.router,prefix="/api/v1/indas")

# In-memory chatbot and ingestion routes
app.include_router(router=conversation_router.router, prefix="/api/v1")
app.include_router(router=chat_router.router, prefix="/api/v1")


