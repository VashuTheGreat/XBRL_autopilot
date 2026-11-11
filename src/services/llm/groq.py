"""The one Groq client of the sidecar (stdlib urllib: no SDK dependency).

Shared by the auto-tagging rerank (src/services/tagging/rerank.py) and the fix agent (src/services/fix_agent):
- timeout per call (default 60 s, docs/07 guardrails);
- retries with backoff on 429 and 5xx (honours ``Retry-After``) and on connection errors; never on a timeout;
- the endpoint comes from ``GROQ_URL`` (AppConfig) so tests and the E2E run against a local mock LLM. Only https
  addresses or a loopback http address are accepted, so a stray variable cannot send data elsewhere in clear text.

Callers decide what goes into the messages; this module never logs message content.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


class GroqError(Exception):
    """The LLM call failed after retries (or was refused); ``status`` is the HTTP status when there was one."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def resolve_url(url: str | None) -> str:
    """``GROQ_URL`` or the Groq endpoint; ValueError for anything but https or a loopback http address."""
    u = (url or GROQ_URL).strip()
    parts = urllib.parse.urlsplit(u)
    if parts.scheme == "https" and parts.hostname:
        return u
    if parts.scheme == "http" and parts.hostname in LOOPBACK_HOSTS:
        return u
    raise ValueError(f"GROQ_URL must be an https address or a loopback http address, not {parts.scheme}://{parts.hostname}")


@dataclass
class Usage:
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens

    def add(self, other: "Usage") -> None:
        self.prompt_tokens += other.prompt_tokens
        self.completion_tokens += other.completion_tokens

    def to_json(self) -> dict[str, int]:
        return {"promptTokens": self.prompt_tokens, "completionTokens": self.completion_tokens, "totalTokens": self.total_tokens}


@dataclass
class ChatResult:
    """The assistant message (``content`` and/or ``tool_calls``) and the tokens the call used."""

    message: dict[str, Any]
    usage: Usage = field(default_factory=Usage)

    @property
    def content(self) -> str:
        return self.message.get("content") or ""

    @property
    def tool_calls(self) -> list[dict[str, Any]]:
        return self.message.get("tool_calls") or []


class ChatModel(Protocol):
    """What the fix agent and the rerank need from an LLM (a fake in tests)."""

    def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | None = None,
        response_format: dict[str, Any] | None = None,
        temperature: float = 0,
    ) -> ChatResult: ...


class GroqClient:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        url: str | None = None,
        timeout_s: float = 60.0,
        retries: int = 3,
        backoff_s: float = 1.0,
        sleep: Callable[[float], None] = time.sleep,
    ):
        if not api_key:
            raise ValueError("no Groq API key")
        self.model = model
        self._key = api_key
        self._url = resolve_url(url)
        self._timeout = timeout_s
        self._retries = retries
        self._backoff = backoff_s
        self._sleep = sleep

    def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | None = None,
        response_format: dict[str, Any] | None = None,
        temperature: float = 0,
    ) -> ChatResult:
        body: dict[str, Any] = {"model": self.model, "messages": messages, "temperature": temperature}
        if tools:
            body["tools"] = tools
            if tool_choice:
                body["tool_choice"] = tool_choice
        if response_format:
            body["response_format"] = response_format
        data = self._post(json.dumps(body).encode())
        try:
            message = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError) as exc:
            raise GroqError("unexpected response from the LLM") from exc
        u = data.get("usage") or {}
        return ChatResult(message, Usage(int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)))

    def _post(self, payload: bytes) -> dict[str, Any]:
        attempt = 0
        while True:
            req = urllib.request.Request(self._url, data=payload, method="POST", headers={
                "Authorization": f"Bearer {self._key}", "Content-Type": "application/json", "User-Agent": "xbrl-autopilot",
            })
            try:
                with urllib.request.urlopen(req, timeout=self._timeout) as resp:  # noqa: S310 (resolve_url checks the scheme)
                    return json.loads(resp.read())
            except urllib.error.HTTPError as exc:
                if exc.code not in RETRY_STATUS or attempt >= self._retries:
                    raise GroqError(f"LLM request failed (HTTP {exc.code}){_error_detail(exc)}", exc.code) from None
                self._sleep(_retry_after(exc) or self._backoff * 2**attempt)
            except TimeoutError as exc:
                raise GroqError(f"LLM request timed out after {self._timeout:.0f} s") from exc
            except urllib.error.URLError as exc:
                if isinstance(exc.reason, TimeoutError):
                    raise GroqError(f"LLM request timed out after {self._timeout:.0f} s") from exc
                if attempt >= self._retries:
                    raise GroqError("the LLM service is unreachable") from exc
                self._sleep(self._backoff * 2**attempt)
            except (json.JSONDecodeError, OSError) as exc:
                raise GroqError("unreadable response from the LLM") from exc
            attempt += 1


def _error_detail(exc: urllib.error.HTTPError) -> str:
    """The API's own error code and message (e.g. Groq's ``tool_use_failed``), short; never the request."""
    try:
        err = json.loads(exc.read() or b"{}").get("error") or {}
    except (json.JSONDecodeError, OSError, AttributeError, ValueError):
        return ""
    if not isinstance(err, dict):
        return ""
    parts = [str(err.get(k)) for k in ("code", "message") if err.get(k)]
    return (": " + ": ".join(parts))[:300] if parts else ""


def _retry_after(exc: urllib.error.HTTPError) -> float | None:
    try:
        v = float(exc.headers.get("retry-after", ""))
    except (TypeError, ValueError, AttributeError):
        return None
    return min(max(v, 0.0), 30.0)


def client_from_config(timeout_s: float = 60.0) -> GroqClient | None:
    """A client from AppConfig (key, model, GROQ_URL), or None without a key."""
    from src.app_config import get_app_config

    cfg = get_app_config()
    if not cfg.groq_api_key:
        return None
    return GroqClient(cfg.groq_api_key, cfg.groq_model, url=cfg.groq_url, timeout_s=timeout_s)
