"""The built business-rule files, served by ``GET /api/v1/taxonomies/{id}/engine-rules`` (ADR-0011)."""
from __future__ import annotations

from src.services.engine_authority.store import EngineAuthorityStore
from src.services.engine_rules.specs import RULE_SPECS

default_store = EngineAuthorityStore(
    {tid: spec.rules_file for tid, spec in RULE_SPECS.items()},
    what="executable business rules",
    build="make engine-rules",
)
