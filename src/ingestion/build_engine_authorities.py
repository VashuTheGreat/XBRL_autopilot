"""Builds knowledge_base/*_engine_authority.json for every taxonomy the engine files (C&I 2016, Ind AS 2017).

    uv run python -m src.ingestion.build_engine_authorities [ci_taxonomy|ind_as_taxonomy ...]
"""
from __future__ import annotations

import sys
import time

from src.services.engine_authority.builder import write
from src.services.engine_authority.specs import SPECS


def main(ids: list[str] | None = None) -> None:
    for tid in ids or list(SPECS):
        spec = SPECS[tid]
        t0 = time.perf_counter()
        a = write(spec)
        s = a["meta"]["relationshipStats"]
        print(
            f"{tid}: concepts={len(a['concepts'])} elrs={len(a['elrs'])} tables={len(a['tables'])} "
            f"all={s['all']} notAll={s['notAll']} defaults={s['dimensionDefault']} calcArcs={s['calculationArcs']} "
            f"-> {spec.output.name} ({spec.output.stat().st_size / 1e6:.1f} MB, {time.perf_counter() - t0:.1f}s)"
        )


if __name__ == "__main__":
    main(sys.argv[1:] or None)
