"""Builds knowledge_base/*_engine_rules.json + *_rule_coverage.json and docs/generated/rule-coverage-*.md (ADR-0011).

Needs the engine authorities first (make engine-authority).

    uv run python -m src.ingestion.build_engine_rules [ci_taxonomy|ind_as_taxonomy ...]
"""
from __future__ import annotations

import sys
import time

from src.core.logger import logger
from src.services.engine_rules.builder import write
from src.services.engine_rules.specs import RULE_SPECS


def main(ids: list[str] | None = None) -> None:
    for tid in ids or list(RULE_SPECS):
        spec = RULE_SPECS[tid]
        t0 = time.perf_counter()
        _, coverage = write(spec)
        m = coverage["measure"]
        logger.info(
            "engine_rules.built",
            taxonomy_id=tid,
            summary=coverage["summary"],
            executable=m["executable"],
            denominator=m["denominator"],
            duration_s=round(time.perf_counter() - t0, 2),
            output=spec.rules_file.name,
        )


if __name__ == "__main__":
    main(sys.argv[1:] or None)
