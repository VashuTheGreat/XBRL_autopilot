from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from src.core.logger import logger
from src.services.mandatory_marks import mandatory_cell
from src.web.responses import success_response
from src.web.schemas.facts import (
    FactValueUpdate,
    SuggestTypedRequest,
    TableCellValueUpdate,
)
from src.web.state import get_session

router = APIRouter(prefix="/api/facts", tags=["facts"])


@router.get("/tab/{elr_uri:path}")
def get_tab_data(elr_uri: str, session_id: str = "default"):
    with logger.span("facts.get_tab", elr_uri=elr_uri, session_id=session_id):
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

        return success_response(
            data={
                "elr": elr,
                "applicable": {"CY": st_cy["applicable"], "PY": st_py["applicable"]},
                "rows": rendered_rows,
                "tables": view.get("tables", []),
            },
            message="Tab data retrieved successfully",
        )


@router.get("/table/{table_id}")
def get_table_data(table_id: str, scope: str = Query("CY"), session_id: str = "default"):
    with logger.span("facts.get_table", table_id=table_id, scope=scope, session_id=session_id):
        s = get_session(session_id)
        A = s.A
        t = A.table(table_id)
        if not t:
            raise HTTPException(status_code=404, detail="Table not found")

        opened = s.open_table(table_id, scope)
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

        return success_response(
            data={
                "tableId": table_id,
                "scope": scope,
                "title": view.get("title"),
                "axes": view.get("axes", []),
                "slices": slices,
                "rows": matrix_rows,
                "status": opened["status"],
            },
            message="Table data retrieved successfully",
        )


@router.post("/value")
def set_cell_value(payload: FactValueUpdate, session_id: str = "default"):
    with logger.span("facts.set_value", concept=payload.concept, scope=payload.scope, session_id=session_id):
        s = get_session(session_id)
        fact = s.set_value(
            concept=payload.concept,
            scope=payload.scope,
            display=payload.display,
            preferred_label=payload.preferred_label,
            tab=payload.tab,
            recalc=payload.recalc,
            override=payload.override,
            unlock_py=payload.unlock_py,
            strict=payload.strict,
        )
        logger.info("facts.value_set", concept=payload.concept, scope=payload.scope)
        return success_response(
            data={
                "fact": fact.to_dict() if fact else None,
                "revision": s.filing.revision,
            },
            message="Cell value updated successfully",
        )


@router.post("/table-value")
def set_table_cell_value(payload: TableCellValueUpdate, session_id: str = "default"):
    with logger.span("facts.set_table_value", table_id=payload.table_id, concept=payload.concept, scope=payload.scope, session_id=session_id):
        s = get_session(session_id)
        fact = s.set_table_value(
            table_id=payload.table_id,
            scope=payload.scope,
            dims=payload.dims,
            concept=payload.concept,
            display=payload.display,
            preferred_label=payload.preferred_label,
            recalc=payload.recalc,
            override=payload.override,
            lock_calculated=payload.lock_calculated,
            unlock_py=payload.unlock_py,
            strict=payload.strict,
        )
        logger.info("facts.table_value_set", table_id=payload.table_id, concept=payload.concept)
        return success_response(
            data={
                "fact": fact.to_dict() if fact else None,
                "revision": s.filing.revision,
            },
            message="Table cell value updated successfully",
        )


@router.post("/suggest-typed")
def suggest_typed(payload: SuggestTypedRequest, session_id: str = "default"):
    with logger.span("facts.suggest_typed", table_id=payload.table_id, axis=payload.axis, session_id=session_id):
        s = get_session(session_id)
        suggestion = s.suggest_typed_domain(payload.table_id, payload.scope, payload.axis)
        return success_response(
            data={"suggestion": suggestion},
            message="Typed dimension suggestion generated successfully",
        )
