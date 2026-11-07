from __future__ import annotations
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.core.logger import logger
from src.core.model import FactValueError
from src.engine.applicability import ApplicabilityError
from src.engine.gate import GateError
from src.services.importer import CashFlowChoiceError
from src.services.session import CalculatedCellError, DimensionError, PyLockedError

from src.web.middlewares.correlation_id import CorrelationIdMiddleware
from src.web.responses import error_response
from src.web.routes.facts import router as facts_router
from src.web.routes.filing import router as filing_router
from src.web.routes.projects import router as projects_router
from src.web.routes.taxonomies import router as taxonomies_router
from src.web.routes.tools import router as tools_router
from src.web.routes.validation import router as validation_router
from src.web.state import get_session

BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="XBRL Autopilot",
    description="Python & FastAPI MCA C&I 2016 XBRL Instance Preparation, Validation, and Filing System",
    version="1.0.0",
)

app.add_middleware(CorrelationIdMiddleware)

if not STATIC_DIR.exists():
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
if not TEMPLATES_DIR.exists():
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    err_list = []
    for err in exc.errors():
        loc = ".".join(str(x) for x in err.get("loc", []))
        err_list.append({
            "field": loc or None,
            "message": err.get("msg", "Validation error"),
            "type": err.get("type", "validation_error"),
        })
    logger.warning("request_validation_failed", path=request.url.path, errors=err_list)
    return error_response(
        message="Request validation failed",
        status_code=422,
        errors=err_list,
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    logger.warning("http_exception", path=request.url.path, status_code=exc.status_code, detail=exc.detail)
    detail_msg = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return error_response(
        message=detail_msg,
        status_code=exc.status_code,
    )


@app.exception_handler(FactValueError)
@app.exception_handler(DimensionError)
@app.exception_handler(CalculatedCellError)
@app.exception_handler(PyLockedError)
@app.exception_handler(ApplicabilityError)
@app.exception_handler(CashFlowChoiceError)
@app.exception_handler(GateError)
async def domain_exception_handler(request: Request, exc: Exception):
    logger.warning("domain_exception", path=request.url.path, exception_type=type(exc).__name__, message=str(exc))
    return error_response(
        message=str(exc),
        status_code=400,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("unhandled_server_error", path=request.url.path, error=str(exc))
    return error_response(
        message="An unexpected internal server error occurred",
        status_code=500,
    )


app.include_router(filing_router)
app.include_router(facts_router)
app.include_router(validation_router)
app.include_router(tools_router)
app.include_router(taxonomies_router, prefix="/api/taxonomies", tags=["taxonomies"])
app.include_router(projects_router, prefix="/api/projects", tags=["projects"])


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    s = get_session("default")
    groups: dict[str, list[dict]] = {}
    for e in s.A.elrs:
        grp = e.get("group", "Other")
        groups.setdefault(grp, []).append(e)

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "meta": s.filing.meta,
            "groups": groups,
            "revision": s.filing.revision,
        },
    )


def create_app() -> FastAPI:
    return app
