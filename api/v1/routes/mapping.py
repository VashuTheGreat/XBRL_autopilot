"""Auto-tagging suggestions powered by Hybrid Retrieval (Vector DB + BM25) and Reranking."""
from __future__ import annotations

import re
from typing import Any
from fastapi import APIRouter

from api.responses import success_response
from api.v1.schemas.mapping import ColumnSuggestRequest, SuggestRequest
from src.core.logger import logger
from src.pipeline.recom_taxonomies import RecommendTaxonomiesWithScores

router = APIRouter()


def col_to_letter(c: int) -> str:
    """0-based column index to Excel column letter (0 -> A, 1 -> B, 2 -> C)."""
    s = ""
    while c >= 0:
        s = chr(c % 26 + 65) + s
        c = c // 26 - 1
    return s


@router.post("/suggest_column")
async def suggest_column_mappings(body: ColumnSuggestRequest):
    """Auto-tags a user-specified column of line items, mapping them to CY and PY value cells."""
    valid_items = [item for item in body.items if item.label and item.label.strip()]
    if not valid_items:
        return success_response(
            {"suggestions": [], "total_items": 0, "matched_items": 0},
            message="No non-empty labels to tag",
        )

    keys = [item.label.strip() for item in valid_items]
    with logger.span("mapping.suggest_column", count=len(keys), sheet=body.sheet):
        rec_results = await RecommendTaxonomiesWithScores(
            keys=keys,
            collection=body.taxonomy,
            top_k=3,
        )

    rec_by_key = {r["key"]: r for r in rec_results}
    suggestions: list[dict[str, Any]] = []

    for item in valid_items:
        key = item.label.strip()
        rec_data = rec_by_key.get(key)
        if not rec_data or not rec_data.get("bestMatch"):
            continue

        best = rec_data["bestMatch"]
        alts = [
            {"concept": m["qname"], "label": m["label"], "score": m["score"]}
            for m in rec_data.get("matches", [])
            if m["qname"] != best["qname"]
        ]

        # CY Suggestion
        suggestions.append({
            "cell": {"workbook": body.workbook, "sheet": body.sheet, "ref": item.cy_cell},
            "concept": best["qname"],
            "label": item.label,
            "scope": "CY",
            "confidence": best["score"],
            "origin": "exact" if best["score"] >= 0.95 else "lexical",
            "rationale": f"Matched row label '{item.label}' via Hybrid Retrieval ({int(round(best['score'] * 100))}%)",
            "sign": 1,
            "dims": [],
            "alternatives": alts,
        })

        # PY Suggestion (if py_cell provided)
        if item.py_cell:
            suggestions.append({
                "cell": {"workbook": body.workbook, "sheet": body.sheet, "ref": item.py_cell},
                "concept": best["qname"],
                "label": item.label,
                "scope": "PY",
                "confidence": best["score"],
                "origin": "exact" if best["score"] >= 0.95 else "lexical",
                "rationale": f"Matched row label '{item.label}' via Hybrid Retrieval ({int(round(best['score'] * 100))}%)",
                "sign": 1,
                "dims": [],
                "alternatives": alts,
            })

    return success_response(
        {
            "suggestions": suggestions,
            "total_items": len(valid_items),
            "matched_items": len(suggestions),
        },
        message=f"{len(suggestions)} suggestions generated",
    )


@router.post("/suggest")
async def suggest_mappings(body: SuggestRequest):
    """Auto-tagging suggestions using Hybrid Search (Chroma + BM25 + Reranking)."""
    layout: list[dict[str, Any]] = []
    suggestions: list[dict[str, Any]] = []
    memory_map = {m.label.strip().lower(): m.concept for m in body.memory if m.label}

    for sheet in body.sheets:
        # Group cells by row
        rows: dict[int, list[Any]] = {}
        for c in sheet.cells:
            rows.setdefault(c.r, []).append(c)

        row_candidates: list[tuple[int, str, str, int, int | None]] = []
        for r, cells in sorted(rows.items()):
            text_cells = [
                c for c in cells
                if isinstance(c.v, str)
                and c.v.strip()
                and not re.match(r"^-?\d+(\.\d+)?$", c.v.strip())
                and len(c.v.strip()) > 1
            ]
            num_cells = [
                c for c in cells
                if (isinstance(c.v, (int, float)) or (isinstance(c.v, str) and re.match(r"^-?\d+(\.\d+)?$", c.v.strip())))
                and c.c >= 2
            ]
            # Exclude small note numbers if next to a figure
            if text_cells and num_cells:
                raw_label = text_cells[0].v.strip()
                clean_lbl = re.sub(r"^[-–•*]\s*", "", raw_label).strip()
                if clean_lbl:
                    cy_c = num_cells[0].c
                    py_c = num_cells[1].c if len(num_cells) > 1 else None
                    row_candidates.append((r, raw_label, clean_lbl, cy_c, py_c))

        if not row_candidates:
            layout.append({
                "sheet": sheet.name,
                "kind": "balance_sheet" if "BS" in sheet.name else ("profit_loss" if "PL" in sheet.name else "statement"),
                "scale": body.level,
                "periodColumns": {"CY": "C", "PY": "D"},
                "rows": 0,
                "note": None,
            })
            continue

        cy_letter = col_to_letter(row_candidates[0][3])
        py_letter = col_to_letter(row_candidates[0][4]) if row_candidates[0][4] is not None else None

        layout.append({
            "sheet": sheet.name,
            "kind": "balance_sheet" if "BS" in sheet.name else ("profit_loss" if "PL" in sheet.name else "statement"),
            "scale": body.level,
            "periodColumns": {"CY": cy_letter, **({"PY": py_letter} if py_letter else {})},
            "rows": len(row_candidates),
            "note": None,
        })

        unique_labels = list(dict.fromkeys(c[2] for c in row_candidates))
        rec_results = await RecommendTaxonomiesWithScores(
            keys=unique_labels,
            collection=body.taxonomy,
            top_k=3,
        )
        rec_by_key = {r["key"]: r for r in rec_results}

        for r, raw_lbl, clean_lbl, cy_c, py_c in row_candidates:
            cy_ref = f"{col_to_letter(cy_c)}{r + 1}"
            py_ref = f"{col_to_letter(py_c)}{r + 1}" if py_c is not None else None

            mem_concept = memory_map.get(clean_lbl.lower()) or memory_map.get(raw_lbl.lower())
            rec_data = rec_by_key.get(clean_lbl)
            best = rec_data.get("bestMatch") if rec_data else None

            if not best and not mem_concept:
                continue

            concept = mem_concept if mem_concept else best["qname"]
            score = 0.95 if mem_concept else (best["score"] if best else 0.8)
            origin = "memory" if mem_concept else ("exact" if score >= 0.95 else "lexical")
            alts = [
                {"concept": m["qname"], "label": m["label"], "score": m["score"]}
                for m in (rec_data.get("matches", []) if rec_data else [])
                if best and m["qname"] != best["qname"]
            ]

            suggestions.append({
                "cell": {"sheet": sheet.name, "ref": cy_ref},
                "concept": concept,
                "label": raw_lbl,
                "scope": "CY",
                "confidence": score,
                "origin": origin,
                "rationale": f"Matched row label '{raw_lbl}' via {'Mapping Memory' if mem_concept else 'Hybrid Retrieval'} ({int(round(score * 100))}%)",
                "sign": 1,
                "dims": [],
                "alternatives": alts,
            })

            if py_ref and body.periods.pyEnd:
                suggestions.append({
                    "cell": {"sheet": sheet.name, "ref": py_ref},
                    "concept": concept,
                    "label": raw_lbl,
                    "scope": "PY",
                    "confidence": score,
                    "origin": origin,
                    "rationale": f"Matched row label '{raw_lbl}' via {'Mapping Memory' if mem_concept else 'Hybrid Retrieval'} ({int(round(score * 100))}%)",
                    "sign": 1,
                    "dims": [],
                    "alternatives": alts,
                })

    data = {
        "layout": layout,
        "suggestions": suggestions,
        "blocks": [],
        "llmUsed": False,
        "level": body.level,
    }
    return success_response(data, message=f"{len(suggestions)} suggestions")
