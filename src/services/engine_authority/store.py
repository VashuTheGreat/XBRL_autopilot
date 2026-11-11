"""Read access to the built engine authorities (knowledge_base/*_engine_authority.json), for the routes."""
from __future__ import annotations

from pathlib import Path

from src.services.engine_authority.specs import SPECS


class AuthorityNotAvailable(LookupError):
    pass


class EngineAuthorityStore:
    """Serves each authority file as bytes, read once. The JSON is passed through without parsing."""

    def __init__(self, files: dict[str, Path]):
        self._files = files
        self._cache: dict[str, bytes] = {}

    def ids(self) -> list[str]:
        return list(self._files)

    def raw(self, taxonomy_id: str) -> bytes:
        if taxonomy_id not in self._cache:
            path = self._files.get(taxonomy_id)
            if path is None:
                raise AuthorityNotAvailable(f"Taxonomy '{taxonomy_id}' has no engine authority (filing supported: {', '.join(self._files)})")
            if not path.exists():
                raise AuthorityNotAvailable(f"Engine authority for '{taxonomy_id}' is not built yet ({path.name}); run make rebuild")
            self._cache[taxonomy_id] = path.read_bytes()
        return self._cache[taxonomy_id]


default_store = EngineAuthorityStore({tid: spec.output for tid, spec in SPECS.items()})
