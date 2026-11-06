"""FastAPI application for XBRL Autopilot."""

from __future__ import annotations
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from src.web.routes.filing import router as filing_router
from src.web.routes.facts import router as facts_router
from src.web.routes.validation import router as validation_router
from src.web.routes.tools import router as tools_router
from src.web.state import get_session

BASE_DIR = Path(__file__).resolve().parent.parent.parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(
    title="XBRL Autopilot",
    description="Python & FastAPI MCA C&I 2016 XBRL Instance Preparation, Validation, and Filing System",
    version="1.0.0",
)

if not STATIC_DIR.exists():
    STATIC_DIR.mkdir(parents=True, exist_ok=True)
if not TEMPLATES_DIR.exists():
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))

app.include_router(filing_router)
app.include_router(facts_router)
app.include_router(validation_router)
app.include_router(tools_router)


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
