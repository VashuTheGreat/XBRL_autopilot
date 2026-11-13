"""Bridge module providing backward compatibility for imports from src.services.retrieval.reranking."""
from .reranker import (
    RankedDocument,
    RerankerService,
    flaskreranker,
    get_reranker_service,
)

__all__ = [
    "RankedDocument",
    "RerankerService",
    "get_reranker_service",
    "flaskreranker",
]
