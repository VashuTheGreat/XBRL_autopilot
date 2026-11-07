"""Taxonomy Catalog & Hierarchy Service.

Provides structured presentation tree hierarchies, concept searching,
and live filing values for the right-hand taxonomy viewer.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Tuple
from src.core.logger import logger


def get_taxonomy_tree(
    filing_session: Any,
    elr_uri: Optional[str] = None,
    filter_query: Optional[str] = None,
) -> Dict[str, Any]:
    """Builds the presentation tree hierarchy with current values for the taxonomy viewer pane."""
    with logger.span("taxonomy_catalog.get_tree", elr_uri=elr_uri, filter_query=filter_query):
        A = filing_session.A
        s = filing_session

        # Handle 'both' or specific ELRs
        target_elrs = []
        if elr_uri == "both":
            bs_elr = next((e for e in A.elrs if e.get("code") == "100100"), None)
            pl_elr = next((e for e in A.elrs if e.get("code") == "100200"), None)
            if bs_elr: target_elrs.append(bs_elr)
            if pl_elr: target_elrs.append(pl_elr)
            target_elr = {"code": "Both", "title": "Balance Sheet & Profit and Loss", "uri": "both"}
        elif elr_uri:
            target_elr = A.elr(elr_uri) or A.elr_by_code(elr_uri)
            if target_elr:
                target_elrs.append(target_elr)

        if not target_elrs:
            # Pick first statement ELR (typically Balance Sheet 100100)
            target_elr = next((e for e in A.elrs if e.get("code") == "100100"), A.elrs[0] if A.elrs else None)
            if target_elr:
                target_elrs.append(target_elr)

        if not target_elrs or not target_elr:
            return {"elr": None, "tree": [], "availableElrs": []}

        filter_lower = filter_query.strip().lower() if filter_query else None
        items: List[Dict[str, Any]] = []

        for e_elr in target_elrs:
            uri = e_elr["uri"]
            view = s.elr_view(uri)

            # If displaying multiple ELRs, add statement group header
            if len(target_elrs) > 1:
                items.append({
                    "kind": "header",
                    "concept": None,
                    "label": f"[{e_elr.get('code', '')}] {e_elr.get('title', 'Statement')}",
                    "depth": 0,
                    "isAbstract": True,
                    "cy": "",
                    "py": "",
                    "calculated": False,
                    "tagged": False,
                })

            base_depth = 1 if len(target_elrs) > 1 else 0
            for r in view.get("rows", []):
                kind = r.get("kind")
                label = r.get("label", "")
                concept = r.get("concept")

                # Check search filter
                if filter_lower:
                    label_match = filter_lower in label.lower()
                    concept_match = concept and filter_lower in concept.lower()
                    if not (label_match or concept_match):
                        continue

                d = r.get("depth", 0) + base_depth

                if kind == "item":
                    pref = r.get("preferredLabel")
                    val_cy = s.get_value(concept, "CY", [], pref)
                    val_py = s.get_value(concept, "PY", [], pref)
                    calc_cy = s.calculated_cell(concept, "CY", [], uri, pref)
                    calc_py = s.calculated_cell(concept, "PY", [], uri, pref)

                    has_value = bool(val_cy and val_cy.value) or bool(val_py and val_py.value)

                    items.append({
                        "kind": "item",
                        "concept": concept,
                        "label": label,
                        "depth": d,
                        "dataType": r.get("dataType"),
                        "preferredLabel": pref,
                        "isAbstract": False,
                        "cy": s.display_of(val_cy) if val_cy else "",
                        "py": s.display_of(val_py) if val_py else "",
                        "calculated": bool(calc_cy or calc_py),
                        "tagged": has_value,
                    })
                elif kind == "header":
                    items.append({
                        "kind": "header",
                        "concept": concept,
                        "label": label,
                        "depth": d,
                        "isAbstract": True,
                        "cy": "",
                        "py": "",
                        "calculated": False,
                        "tagged": False,
                    })

        # Backward propagation: If any concept is tagged, mark ancestor abstract headers as tagged
        # so they render in bold red, matching WebXBRL Screenshot 11-01-58 & 11-00-59!
        header_stack: List[Tuple[int, int]] = []  # (index in items, depth)
        for idx, itm in enumerate(items):
            d = itm.get("depth", 0)
            while header_stack and header_stack[-1][1] >= d:
                header_stack.pop()

            if itm.get("kind") == "header":
                header_stack.append((idx, d))
            elif itm.get("tagged"):
                for h_idx, _ in header_stack:
                    items[h_idx]["tagged"] = True

        available_elrs = [
            {
                "uri": e["uri"],
                "code": e.get("code"),
                "title": e.get("title"),
                "group": e.get("group"),
            }
            for e in A.elrs
        ]

        return {
            "elr": target_elr,
            "items": items,
            "availableElrs": available_elrs,
        }


def search_concepts_catalog(
    A: Any,
    query: str,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Instant text search across all concepts in the authority model."""
    q_norm = query.strip().lower()
    if not q_norm:
        return []

    results: List[Dict[str, Any]] = []
    for qname, c in A.concepts.items():
        if not isinstance(c, dict):
            continue
        labels = c.get("labels", {})
        label = labels.get("label") or labels.get("terseLabel") or c.get("name") or qname
        name = c.get("name") or qname.split(":")[-1]

        if q_norm in label.lower() or q_norm in name.lower() or q_norm in qname.lower():
            results.append({
                "concept": qname,
                "name": name,
                "label": label,
                "type": c.get("type"),
                "periodType": c.get("periodType"),
                "abstract": c.get("abstract", False),
            })
            if len(results) >= limit:
                break

    return results
