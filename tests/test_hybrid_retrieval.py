import pytest
from src.pipeline.recom_taxonomies import RecommendTaxonomies, RecommendTaxonomiesWithScores
from src.services.retrieval.hybrid import get_hybrid_search_service
from src.services.retrieval.reranking import get_reranker_service


@pytest.mark.asyncio
async def test_hybrid_search_service():
    hybrid_svc = get_hybrid_search_service()
    candidates = await hybrid_svc.asearch("Trade payables", collection="ind_as_taxonomy", k=5)
    assert len(candidates) > 0
    top = candidates[0]
    assert "payables" in top.page_content.lower() or "payables" in top.metadata.get("qname", "").lower()


@pytest.mark.asyncio
async def test_recommend_taxonomies_with_scores():
    keys = ["Trade payables", "Plant and equipment", "   ", "Cash and cash equivalents"]
    results = await RecommendTaxonomiesWithScores(keys, collection="ind_as_taxonomy", top_k=3)
    assert len(results) == 3  # empty string skipped
    for res in results:
        assert res["key"] in ("Trade payables", "Plant and equipment", "Cash and cash equivalents")
        assert res["bestMatch"] is not None
        assert res["bestMatch"]["score"] > 0.5
        assert res["bestMatch"]["confidencePercent"] >= 50
        assert "qname" in res["bestMatch"]
        assert "label" in res["bestMatch"]


@pytest.mark.asyncio
async def test_recommend_taxonomies_skips_empty():
    keys = ["", "   ", None]
    results = await RecommendTaxonomies(keys, collection="ind_as_taxonomy")
    assert all(r is None for r in results)
