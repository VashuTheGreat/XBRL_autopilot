"""Read access to the built engine files in knowledge_base/, for the routes: the engine authority
(*_engine_authority.json, ADR-0010) and the executable business rules (*_engine_rules.json, ADR-0011)."""
from __future__ import annotations

from pathlib import Path

from src.services.engine_authority.specs import SPECS


class AuthorityNotAvailable(LookupError):
    pass


class EngineAuthorityStore:
    """Serves each file as bytes, read once. The JSON is passed through without parsing."""

    def __init__(self, files: dict[str, Path], what: str = "engine authority", build: str = "make rebuild"):
        self._files = files
        self._what = what
        self._build = build
        self._cache: dict[str, bytes] = {}

    def ids(self) -> list[str]:
        return list(self._files)

    def raw(self, taxonomy_id: str) -> bytes:
        if taxonomy_id not in self._cache:
            path = self._files.get(taxonomy_id)
            if path is None:
                raise AuthorityNotAvailable(f"Taxonomy '{taxonomy_id}' has no {self._what} (available: {', '.join(self._files)})")
            if not path.exists():
                raise AuthorityNotAvailable(f"The {self._what} for '{taxonomy_id}' is not built yet ({path.name}); run {self._build}")
            self._cache[taxonomy_id] = path.read_bytes()
        return self._cache[taxonomy_id]


default_store = EngineAuthorityStore({tid: spec.output for tid, spec in SPECS.items()})
