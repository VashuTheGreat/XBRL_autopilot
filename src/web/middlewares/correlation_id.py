from __future__ import annotations
import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from src.core.logger import logger


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id

        start_time = time.perf_counter()
        with logger.span("http_request", method=request.method, path=request.url.path, request_id=request_id):
            try:
                response = await call_next(request)
            except Exception as exc:
                logger.exception("request_failed", method=request.method, path=request.url.path, request_id=request_id, error=str(exc))
                raise exc

            duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
            response.headers["X-Request-ID"] = request_id
            logger.info("http_response", status_code=response.status_code, duration_ms=duration_ms, request_id=request_id)
            return response
