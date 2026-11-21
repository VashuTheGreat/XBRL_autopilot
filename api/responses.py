from __future__ import annotations
from typing import Any, Generic, List, Optional, TypeVar
from pydantic import BaseModel
from fastapi.responses import JSONResponse
from src.core.logger import logger

T = TypeVar("T")


class ErrorDetail(BaseModel):
    field: Optional[str] = None
    message: str
    type: Optional[str] = None


class ApiResponse(BaseModel, Generic[T]):
    data: Optional[T] = None
    message: str
    success: bool
    errors: Optional[List[ErrorDetail]] = None


def _sanitize_payload(obj: Any) -> Any:
    if obj is None:
        return None
    if hasattr(obj, "item"):
        return obj.item()
    if hasattr(obj, "dict") and callable(obj.dict):
        return _sanitize_payload(obj.dict())
    if hasattr(obj, "model_dump") and callable(obj.model_dump):
        return _sanitize_payload(obj.model_dump())
    if isinstance(obj, dict):
        return {str(k): _sanitize_payload(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_sanitize_payload(v) for v in obj]
    return obj


def success_response(
    data: Any = None,
    message: str = "Operation completed successfully",
    status_code: int = 200,
) -> JSONResponse:
    payload = ApiResponse[Any](
        data=data,
        message=message,
        success=True,
        errors=None,
    ).model_dump(by_alias=True)
    return JSONResponse(content=_sanitize_payload(payload), status_code=status_code)


def error_response(
    message: str,
    status_code: int = 400,
    errors: Optional[List[dict]] = None,
    data: Any = None,
) -> JSONResponse:
    logger.warning("api.error_response", status_code=status_code, message=message, error_count=len(errors) if errors else 0)
    formatted_errors: Optional[List[ErrorDetail]] = None
    if errors:
        formatted_errors = [
            err if isinstance(err, ErrorDetail) else ErrorDetail(**err)
            for err in errors
        ]
    payload = ApiResponse[Any](
        data=data,
        message=message,
        success=False,
        errors=formatted_errors,
    ).model_dump(by_alias=True)
    return JSONResponse(content=_sanitize_payload(payload), status_code=status_code)
