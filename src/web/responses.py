from __future__ import annotations
from typing import Any, Generic, List, Optional, TypeVar
from pydantic import BaseModel
from fastapi.responses import JSONResponse

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
    return JSONResponse(content=payload, status_code=status_code)


def error_response(
    message: str,
    status_code: int = 400,
    errors: Optional[List[dict]] = None,
    data: Any = None,
) -> JSONResponse:
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
    return JSONResponse(content=payload, status_code=status_code)
