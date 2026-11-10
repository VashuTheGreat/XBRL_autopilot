"""Cached access to taxonomy knowledge bases (one Authority per taxonomy id)."""
from typing import Dict

from src.core.authority import Authority, clear_kb_cache


class TaxonomyLoader:
    _cache: Dict[str, Authority] = {}

    @classmethod
    def load(cls, taxonomy_id: str) -> Authority:
        if taxonomy_id not in cls._cache:
            cls._cache[taxonomy_id] = Authority(taxonomy_id)
        return cls._cache[taxonomy_id]

    @classmethod
    def clear_cache(cls) -> None:
        cls._cache.clear()
        clear_kb_cache()


def load_taxonomy(taxonomy_id: str) -> Authority:
    return TaxonomyLoader.load(taxonomy_id)
