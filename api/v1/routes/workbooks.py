"""Workbook reading for formats the desktop app can't parse itself (.xls BIFF). Stateless: bytes in, model out."""
import base64
import binascii

from fastapi import APIRouter

from api.responses import error_response, success_response
from api.v1.schemas.workbooks import ReadWorkbookRequest
from src.services.workbook.reader import UnreadableWorkbookError, read_workbook

router = APIRouter()

@router.post("/read")
async def read(body: ReadWorkbookRequest):
    try:
        data = base64.b64decode(body.contentBase64, validate=True)
    except (binascii.Error, ValueError):
        return error_response("contentBase64 is not valid base64.", status_code=422)
    try:
        model = read_workbook(data)
    except UnreadableWorkbookError as exc:
        return error_response(f"{body.fileName}: {exc}", status_code=422)
    return success_response(model, message="Workbook read")
