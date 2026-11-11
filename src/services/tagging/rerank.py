"""Optional LLM rerank of undecided rows (Groq, OpenAI-compatible chat API, stdlib urllib: no new dependency).

Only labels travel: the row label, its headings, the sheet kind and the candidate elements. Never amounts, company
names or CINs (docs/11-security-privacy.md). The model may only pick one of the given candidates or none; the
caller treats its answer as one more suggestion, never as a fact (CLAUDE.md non-negotiable 2).
"""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
BATCH = 30
LLM_CONFIDENCE_CAP = 0.9


@dataclass(frozen=True)
class RerankOption:
    qname: str
    label: str
    period_type: str | None
    balance: str | None


@dataclass(frozen=True)
class RerankItem:
    id: int
    label: str
    context: list[str]
    sheet_kind: str
    options: list[RerankOption]


@dataclass(frozen=True)
class RerankChoice:
    qname: str | None
    confidence: float
    rationale: str


class Reranker(Protocol):
    def rerank(self, items: list[RerankItem]) -> dict[int, RerankChoice]: ...


SYSTEM_PROMPT = (
    "You map rows of Indian company financial statements (Schedule III / Ind AS) to XBRL taxonomy elements for MCA "
    "AOC-4 filings. For every row pick the one candidate element that reports exactly that line, or null when none "
    "does. Use the headings above the row (current / non-current, assets / liabilities) and the sheet kind. "
    'Answer JSON only: {"rows":[{"id":<id>,"concept":"<qname or null>","confidence":<0..1>,"reason":"<= 15 words"}]}'
)


def build_messages(items: list[RerankItem]) -> list[dict]:
    rows = [
        {
            "id": it.id,
            "row": it.label,
            "headings": it.context,
            "sheet": it.sheet_kind,
            "candidates": [
                {"concept": o.qname, "label": o.label, "period": o.period_type, "balance": o.balance} for o in it.options
            ],
        }
        for it in items
    ]
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": json.dumps({"rows": rows})}]


def parse_choices(text: str, items: list[RerankItem]) -> dict[int, RerankChoice]:
    """The model's JSON → choices, keeping only ids we asked about and concepts we offered."""
    try:
        rows = json.loads(text).get("rows", [])
    except (json.JSONDecodeError, AttributeError):
        return {}
    offered = {it.id: {o.qname for o in it.options} for it in items}
    out: dict[int, RerankChoice] = {}
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict) or r.get("id") not in offered:
            continue
        concept = r.get("concept")
        if concept is not None and concept not in offered[r["id"]]:
            continue
        try:
            conf = max(0.0, min(LLM_CONFIDENCE_CAP, float(r.get("confidence", 0.5))))
        except (TypeError, ValueError):
            conf = 0.5
        out[r["id"]] = RerankChoice(concept, conf, str(r.get("reason", ""))[:200])
    return out


class GroqReranker:
    def __init__(self, api_key: str, model: str, timeout_s: float = 30.0, url: str = GROQ_URL):
        self._key, self._model, self._timeout, self._url = api_key, model, timeout_s, url

    def rerank(self, items: list[RerankItem]) -> dict[int, RerankChoice]:
        out: dict[int, RerankChoice] = {}
        for i in range(0, len(items), BATCH):
            batch = items[i : i + BATCH]
            try:
                out.update(parse_choices(self._complete(build_messages(batch)), batch))
            except (urllib.error.URLError, TimeoutError, OSError, KeyError, ValueError):
                continue  # the LLM is optional: those rows keep their lexical suggestion
        return out

    def _complete(self, messages: list[dict]) -> str:
        body = json.dumps({
            "model": self._model, "messages": messages, "temperature": 0,
            "response_format": {"type": "json_object"},
        }).encode()
        req = urllib.request.Request(self._url, data=body, method="POST", headers={
            "Authorization": f"Bearer {self._key}", "Content-Type": "application/json", "User-Agent": "xbrl-autopilot",
        })
        with urllib.request.urlopen(req, timeout=self._timeout) as resp:  # noqa: S310 (fixed https URL)
            return json.loads(resp.read())["choices"][0]["message"]["content"]
