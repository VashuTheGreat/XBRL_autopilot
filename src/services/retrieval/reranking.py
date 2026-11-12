"""Reranking Service powered by LangChain FlashrankRerank."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from langchain_community.document_compressors.flashrank_rerank import FlashrankRerank
from langchain_core.documents import Document

from src.core.logger import logger
from src.utils.main_utils import restore_metadata
from src.utils.text_utils import norm_label


@dataclass
class RankedDocument:
    document: Document
    qname: str
    label: str
    score: float
    metadata: dict[str, Any]


class RerankerService:
    """Fast, accurate neural reranker powered by LangChain FlashRank with exact match awareness."""

    def __init__(self, top_k: int = 3):
        self.top_k = top_k
        self._ranker = FlashrankRerank(top_n=20)

    def rerank(
        self,
        query: str,
        candidates: list[Document],
        top_k: int | None = None,
    ) -> list[RankedDocument]:
        """Reranks LangChain candidate documents against query using LangChain FlashRank."""
        if not candidates or not query:
            return []

        k = top_k or self.top_k
        self._ranker.top_n = len(candidates)

        with logger.span("reranker.flashrank", query=query, candidates_count=len(candidates), top_k=k):
            try:
                compressed_docs = self._ranker.compress_documents(candidates, query)
            except Exception as e:
                logger.warning("reranker.flashrank_failed", error=str(e), fallback_to_candidates=True)
                compressed_docs = candidates

            results: list[RankedDocument] = []
            q_norm = norm_label(query)
            for doc in compressed_docs:
                raw_meta = getattr(doc, "metadata", {}) or {}
                meta = restore_metadata(raw_meta)
                if isinstance(meta.get("labels"), str):
                    try:
                        meta["labels"] = json.loads(meta["labels"])
                    except Exception:
                        pass

                qname = meta.get("qname") or (doc.page_content.split(" | ")[1] if " | " in doc.page_content else "")
                label = (meta.get("labels") or {}).get("label") or (doc.page_content.split(" | ")[0] if " | " in doc.page_content else "")
                meta["label"] = label
                meta["qname"] = qname

                score = float(meta.get("relevance_score", 0.8))
                score = max(0.0, min(1.0, score))

                # Exact label match gets top score
                if q_norm and q_norm == norm_label(label):
                    score = 1.0

                results.append(RankedDocument(
                    document=doc,
                    qname=qname,
                    label=label,
                    score=score,
                    metadata=meta,
                ))

            results.sort(key=lambda r: r.score, reverse=True)
            return results[:k]


_default_reranker: RerankerService | None = None


def get_reranker_service() -> RerankerService:
    global _default_reranker
    if _default_reranker is None:
        _default_reranker = RerankerService()
    return _default_reranker


# -------------------------------------------------------------------------
# Optional Groq LLM Reranker for fix-agent / LLM arbitration
# -------------------------------------------------------------------------

@dataclass(frozen=True)
class RerankOption:
    concept: str
    label: str
    period_type: str | None = None
    balance: str | None = None
    is_total: bool = False


@dataclass(frozen=True)
class RerankItem:
    id: int
    label: str
    context: list[str]
    sheet_kind: str
    options: list[RerankOption]


@dataclass(frozen=True)
class RerankChoice:
    id: int
    qname: str
    confidence: float
    reason: str


class GroqReranker:
    """LLM reranker via Groq for fix-agent tools."""

    def __init__(self, api_key: str, model: str = "llama-3.3-70b-versatile", url: str | None = None, client: Any = None):
        self.api_key = api_key
        self.model = model
        self.url = url
        self._client = client

    def rerank(self, items: list[RerankItem]) -> dict[int, RerankChoice]:
        if not items:
            return {}
        if self._client:
            return self._run_client(items)
        return {
            item.id: RerankChoice(id=item.id, qname=item.options[0].concept if item.options else "", confidence=0.8, reason="")
            for item in items
        }

    def _run_client(self, items: list[RerankItem]) -> dict[int, RerankChoice]:
        try:
            choices: dict[int, RerankChoice] = {}
            for item in items:
                opts = [{"concept": o.concept, "label": o.label} for o in item.options]
                resp = self._client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": "Pick the best taxonomy concept for the row label."},
                        {"role": "user", "content": json.dumps({"label": item.label, "options": opts})},
                    ],
                )
                txt = resp.choices[0].message.content or "{}"
                data = json.loads(txt)
                rows = data.get("rows", [])
                if rows:
                    r = rows[0]
                    choices[item.id] = RerankChoice(
                        id=item.id,
                        qname=r.get("concept", ""),
                        confidence=float(r.get("confidence", 0.8)),
                        reason=r.get("reason", ""),
                    )
                else:
                    choices[item.id] = RerankChoice(
                        id=item.id,
                        qname=item.options[0].concept if item.options else "",
                        confidence=0.8,
                        reason="",
                    )
            return choices
        except Exception:
            return {
                item.id: RerankChoice(id=item.id, qname=item.options[0].concept if item.options else "", confidence=0.8, reason="")
                for item in items
            }
