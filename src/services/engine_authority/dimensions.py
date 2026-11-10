"""The dimensional model (hypercubes, axes, members, defaults, tables, base sets) from definition relationships.

Nothing here is table-specific: every structure is discovered from the effective arcs.
"""
from __future__ import annotations

import re
from typing import Callable

from src.services.engine_authority.dts import ARC

Rel = Callable[[str, str, str], list[dict]]


def index_arcs(arcs: list[dict]) -> Rel:
    idx: dict[tuple[str, str, str], list[dict]] = {}
    for a in arcs:
        idx.setdefault((a["arcrole"], a["elr"], a["from"]), []).append(a)
    for v in idx.values():
        v.sort(key=lambda x: x["order"])  # stable, like Array.prototype.sort
    return lambda arcrole, elr, frm: idx.get((arcrole, elr, frm), [])


def walk_domain(rel: Rel, root: str, elr: str, visit, depth: int = 0, seen: set | None = None) -> None:
    """Domain-member network walk with XDT consecutive-relationship semantics (targetRole switches the ELR)."""
    if seen is None:
        seen = set()
    for arc in rel(ARC.dom_mem, elr, root):
        key = (elr, arc["from"], arc["to"])
        if key in seen:
            continue
        seen.add(key)
        visit(arc, depth + 1)
        walk_domain(rel, arc["to"], arc.get("targetRole") or elr, visit, depth + 1, seen)


_LINE_ITEMS = re.compile(r"LineItems$")


def build_dimensional_model(def_arcs: list[dict], concepts: dict[str, dict], role_code: Callable[[str], str]) -> dict:
    rel = index_arcs(def_arcs)
    defaults = {a["from"]: a["to"] for a in def_arcs if a["arcrole"] == ARC.dim_default}

    hc_cache: dict[tuple[str, str], dict] = {}

    def hypercube(hc: str, hc_elr: str) -> dict:
        key = (hc, hc_elr)
        if key in hc_cache:
            return hc_cache[key]
        axes = []
        for hd in rel(ARC.hc_dim, hc_elr, hc):
            axis = hd["to"]
            c = concepts[axis]
            dim_elr = hd.get("targetRole") or hc_elr
            if c.get("typedDomain"):
                axes.append({"axis": axis, "typed": True, "typedDomain": c["typedDomain"], "order": hd["order"]})
                continue
            members: list[dict] = []
            domains: list[str] = []
            for dd in rel(ARC.dim_dom, dim_elr, axis):
                dom_elr = dd.get("targetRole") or dim_elr
                domains.append(dd["to"])
                members.append({"member": dd["to"], "parent": None, "depth": 0, "usable": dd.get("usable") is not False, "order": dd["order"]})
                walk_domain(
                    rel, dd["to"], dom_elr,
                    lambda arc, depth: members.append(
                        {"member": arc["to"], "parent": arc["from"], "depth": depth, "usable": arc.get("usable") is not False, "order": arc["order"]}
                    ),
                )
            axes.append({"axis": axis, "typed": False, "domains": domains, "members": members, "default": defaults.get(axis), "order": hd["order"]})
        out = {"hypercube": hc, "elr": hc_elr, "axes": axes}
        hc_cache[key] = out
        return out

    has_hc = [a for a in def_arcs if a["arcrole"] in (ARC.all, ARC.not_all)]
    base_sets: dict[str, dict[str, list[dict]]] = {}
    for a in has_hc:
        base_sets.setdefault(a["elr"], {}).setdefault(a["from"], []).append({
            "type": "all" if a["arcrole"] == ARC.all else "notAll",
            "hypercube": a["to"],
            "hcElr": a.get("targetRole") or a["elr"],
            "closed": a.get("closed") is True,
            "contextElement": a.get("contextElement") or "scenario",
            "order": a["order"],
        })

    # hypercubes declared on a primary item apply to its domain-member descendants in the same ELR
    concept_hypercubes: dict[str, list[dict]] = {}
    for elr, prims in base_sets.items():
        acc: dict[str, list[dict]] = {}
        for primary, hcs in prims.items():
            acc.setdefault(primary, []).extend(hcs)
            walk_domain(rel, primary, elr, lambda arc, _d, hcs=hcs: acc.setdefault(arc["to"], []).extend(hcs))
        for q, lst in acc.items():
            seen: set[tuple] = set()
            uniq = []
            for h in lst:
                k = (h["type"], h["hypercube"], h["hcElr"])
                if k in seen:
                    continue
                seen.add(k)
                uniq.append(h)
            concept_hypercubes.setdefault(q, []).append({"elr": elr, "hypercubes": uniq})

    tables = []
    for a in (x for x in has_hc if x["arcrole"] == ARC.all):
        hc = hypercube(a["to"], a.get("targetRole") or a["elr"])
        tree: list[dict] = []
        walk_domain(rel, a["from"], a["elr"], lambda arc, depth: tree.append({"concept": arc["to"], "parent": arc["from"], "depth": depth, "order": arc["order"]}))
        line_items = [n["concept"] for n in tree if not concepts[n["concept"]]["abstract"]]
        line_item_nodes = [
            n["concept"] for n in tree
            if concepts[n["concept"]]["abstract"] and _LINE_ITEMS.search(concepts[n["concept"]]["name"])
        ]
        not_all = []
        tree_concepts = {n["concept"] for n in tree}
        for prim, hcs in base_sets.get(a["elr"], {}).items():
            if prim != a["from"] and prim not in tree_concepts:
                continue
            for h in hcs:
                if h["type"] != "notAll":
                    continue
                nh = hypercube(h["hypercube"], h["hcElr"])
                affected = [prim]
                walk_domain(rel, prim, a["elr"], lambda arc, _d: affected.append(arc["to"]))
                not_all.append({
                    "hypercube": h["hypercube"],
                    "elr": h["hcElr"],
                    "primary": prim,
                    "appliesTo": [q for q in affected if not concepts[q]["abstract"]],
                    "axes": [{"axis": x["axis"], "members": None if x["typed"] else [m["member"] for m in x["members"]]} for x in nh["axes"]],
                })
        tables.append({
            "id": f"{role_code(a['elr'])}:{concepts[a['to']]['name']}",
            "elr": a["elr"],
            "code": role_code(a["elr"]),
            "hypercube": a["to"],
            "primaryItem": a["from"],
            "closed": a.get("closed") is True,
            "contextElement": a.get("contextElement") or "scenario",
            "axes": hc["axes"],
            "lineItemNodes": line_item_nodes,
            "lineItemTree": tree,
            "lineItems": line_items,
            "notAll": not_all,
        })

    hypercubes: dict[str, dict] = {}
    for prims in base_sets.values():
        for hcs in prims.values():
            for h in hcs:
                hypercubes[f"{h['hypercube']}@{h['hcElr']}"] = hypercube(h["hypercube"], h["hcElr"])
    return {"defaults": defaults, "baseSets": base_sets, "conceptHypercubes": concept_hypercubes, "tables": tables, "hypercubes": hypercubes}
