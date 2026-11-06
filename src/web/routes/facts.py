"""Facts editing, table navigation, and calculated cell endpoints."""

from __future__ import annotations
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Query, Body

from src.web.state import get_session
from src.services.mandatory_marks import mandatory_cell

router = APIRouter(prefix="/api/facts", tags=["facts"])


@router.get("/tab/{elr_uri:path}")
def get_tab_data(elr_uri: str, session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    A = s.A
    elr = A.elr(elr_uri) or A.elr_by_code(elr_uri)
    if not elr:
        raise HTTPException(status_code=404, detail="ELR not found")

    uri = elr["uri"]
    view = s.elr_view(uri)
    st_cy = s.elr_status(uri, "CY")
    st_py = s.elr_status(uri, "PY")

    rendered_rows = []
    for r in view.get("rows", []):
        kind = r.get("kind")
        if kind == "item":
            concept = r["concept"]
            pref = r.get("preferredLabel")
            val_cy = s.get_value(concept, "CY", [], pref)
            val_py = s.get_value(concept, "PY", [], pref)

            calc_cy = s.calculated_cell(concept, "CY", [], uri, pref)
            calc_py = s.calculated_cell(concept, "PY", [], uri, pref)

            m_cy = mandatory_cell(s, concept, "CY", [])
            m_py = mandatory_cell(s, concept, "PY", [])

            rendered_rows.append({
                "kind": "item",
                "concept": concept,
                "label": r.get("label"),
                "depth": r.get("depth", 0),
                "dataType": r.get("dataType"),
                "preferredLabel": pref,
                "cy": {
                    "value": s.display_of(val_cy) if val_cy else "",
                    "raw": val_cy.value if val_cy else None,
                    "decimals": val_cy.decimals if val_cy else None,
                    "origin": val_cy.origin if val_cy else None,
                    "calculated": bool(calc_cy),
                    "mandatory": m_cy.get("mandatory", False),
                },
                "py": {
                    "value": s.display_of(val_py) if val_py else "",
                    "raw": val_py.value if val_py else None,
                    "decimals": val_py.decimals if val_py else None,
                    "origin": val_py.origin if val_py else None,
                    "calculated": bool(calc_py),
                    "mandatory": m_py.get("mandatory", False),
                },
            })
        elif kind == "header":
            rendered_rows.append({
                "kind": "header",
                "concept": r.get("concept"),
                "label": r.get("label"),
                "depth": r.get("depth", 0),
            })
        elif kind == "table":
            rendered_rows.append({
                "kind": "table",
                "tableId": r.get("tableId"),
                "label": r.get("label"),
                "depth": r.get("depth", 0),
            })

    return {
        "elr": elr,
        "applicable": {"CY": st_cy["applicable"], "PY": st_py["applicable"]},
        "rows": rendered_rows,
        "tables": view.get("tables", []),
    }


@router.get("/table/{table_id}")
def get_table_data(table_id: str, scope: str = Query("CY"), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    A = s.A
    t = A.table(table_id)
    if not t:
        raise HTTPException(status_code=404, detail="Table not found")

    try:
        opened = s.open_table(table_id, scope)
    except Exception as e:
        return {
            "tableId": table_id,
            "scope": scope,
            "status": s.table_status(table_id, scope),
            "error": str(e),
        }

    view = opened["view"]
    slices = opened["slices"]

    matrix_rows = []
    for l in view.get("lineItems", []):
        concept = l["concept"]
        pref = l.get("preferredLabel")
        is_abs = bool(l.get("abstract"))

        cells = []
        for dims in slices:
            if is_abs:
                cells.append(None)
                continue
            val = s.get_value(concept, scope, dims, pref)
            calc = s.calculated_cell(concept, scope, dims, t.get("presentationElr"), pref)
            m = mandatory_cell(s, concept, scope, dims, table_id)
            cells.append({
                "value": s.display_of(val) if val else "",
                "raw": val.value if val else None,
                "decimals": val.decimals if val else None,
                "origin": val.origin if val else None,
                "calculated": bool(calc),
                "mandatory": m.get("mandatory", False),
            })

        matrix_rows.append({
            "concept": concept,
            "label": l.get("label"),
            "depth": l.get("depth", 0),
            "abstract": is_abs,
            "dataType": l.get("dataType"),
            "preferredLabel": pref,
            "cells": cells,
        })

    return {
        "tableId": table_id,
        "scope": scope,
        "title": view.get("title"),
        "axes": view.get("axes", []),
        "slices": slices,
        "rows": matrix_rows,
        "status": opened["status"],
    }


@router.post("/value")
def set_cell_value(payload: Dict[str, Any] = Body(...), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    try:
        fact = s.set_value(
            concept=payload["concept"],
            scope=payload.get("scope", "CY"),
            display=payload.get("display"),
            preferred_label=payload.get("preferredLabel"),
            tab=payload.get("tab"),
            recalc=payload.get("recalc", True),
            override=payload.get("override", False),
            unlock_py=payload.get("unlockPY", False),
            strict=payload.get("strict", False),
        )
        return {
            "status": "ok",
            "fact": fact.to_dict() if fact else None,
            "revision": s.filing.revision,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/table-value")
def set_table_cell_value(payload: Dict[str, Any] = Body(...), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    try:
        fact = s.set_table_value(
            table_id=payload["tableId"],
            scope=payload.get("scope", "CY"),
            dims=payload.get("dims", []),
            concept=payload["concept"],
            display=payload.get("display"),
            preferred_label=payload.get("preferredLabel"),
            recalc=payload.get("recalc", True),
            override=payload.get("override", False),
            lock_calculated=payload.get("lockCalculated", True),
            unlock_py=payload.get("unlockPY", False),
            strict=payload.get("strict", False),
        )
        return {
            "status": "ok",
            "fact": fact.to_dict() if fact else None,
            "revision": s.filing.revision,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/suggest-typed")
def suggest_typed(payload: Dict[str, Any] = Body(...), session_id: str = "default") -> Dict[str, Any]:
    s = get_session(session_id)
    suggestion = s.suggest_typed_value(
        table_id=payload["tableId"],
        scope=payload.get("scope", "CY"),
        axis=payload["axis"],
    )
    return {"suggestion": suggestion}
