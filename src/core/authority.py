"""Taxonomy engine: read-only accessor over the compiled MCA authority model.

The runtime never parses raw taxonomy XML files; everything comes from MCA_AUTHORITY.json.
"""

from __future__ import annotations
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

NUMERIC_BASES: Set[str] = {
    "xbrli:monetaryItemType",
    "xbrli:sharesItemType",
    "xbrli:decimalItemType",
    "xbrli:pureItemType",
    "num:percentItemType",
    "num:perShareItemType",
    "xbrli:integerItemType",
    "xbrli:nonNegativeIntegerItemType",
    "xbrli:positiveIntegerItemType",
    "xbrli:floatItemType",
    "xbrli:doubleItemType",
}

LANG_TYPES: Set[str] = {"xbrli:stringItemType", "nonnum:textBlockItemType"}

DATA_TYPE_MAP: Dict[str, str] = {
    "xbrli:monetaryItemType": "monetary",
    "xbrli:sharesItemType": "shares",
    "num:perShareItemType": "perShare",
    "num:percentItemType": "percent",
    "xbrli:decimalItemType": "decimal",
    "xbrli:pureItemType": "pure",
    "xbrli:dateItemType": "date",
    "xbrli:booleanItemType": "boolean",
    "nonnum:textBlockItemType": "textBlock",
    "xbrli:tokenItemType": "token",
    "xbrli:stringItemType": "string",
}


class Authority:
    def __init__(self, data: Dict[str, Any]):
        self.json = data
        self.meta = data.get("meta", {})
        self.concepts = data.get("concepts", {})
        self.types = data.get("types", {})
        self.namespaces = data.get("namespaces", {})
        self.elrs = data.get("elrs", [])
        self.tables = data.get("tables", [])
        self.rules = data.get("businessRules", {})
        self.defaults = data.get("dimensionDefaults", {})

        self._table_by_id: Dict[str, Any] = {t["id"]: t for t in self.tables if "id" in t}
        self._elr_by_uri: Dict[str, Any] = {e["uri"]: e for e in self.elrs if "uri" in e}
        self._elr_by_code: Dict[str, Any] = {e["code"]: e for e in self.elrs if "code" in e}

        self._tables_by_concept: Dict[str, List[Any]] = {}
        for t in self.tables:
            for q in t.get("lineItems", []):
                self._tables_by_concept.setdefault(q, []).append(t)

        self._axis_info: Optional[Dict[str, Any]] = None
        self._pres_children: Dict[str, Dict[str, List[Any]]] = {}

        for elr, arcs in data.get("presentation", {}).items():
            m: Dict[str, List[Any]] = {}
            for a in arcs:
                m.setdefault(a["from"], []).append(a)
            for v in m.values():
                v.sort(key=lambda x: x.get("order", 0))
            self._pres_children[elr] = m

        self._by_local: Dict[str, str] = {}
        for q, c in self.concepts.items():
            if isinstance(c, dict) and "name" in c:
                self._by_local[c["name"]] = q

    # ---------- concepts
    def concept(self, q: str) -> Optional[Dict[str, Any]]:
        return self.concepts.get(q)

    def has(self, q: str) -> bool:
        return q in self.concepts

    def qname_of_local(self, local: str) -> Optional[str]:
        return self._by_local.get(local)

    qnameOfLocal = qname_of_local

    def label(self, q: str, role: str = "label") -> str:
        c = self.concepts.get(q)
        if not c:
            return q
        labels = c.get("labels", {})
        return (
            labels.get(role)
            or labels.get("label")
            or labels.get("terseLabel")
            or c.get("name", q)
        )

    def base_type(self, q: str) -> Optional[str]:
        c = self.concepts.get(q)
        t = c.get("type") if c else None
        seen: Set[str] = set()
        while t and t in self.types and t not in seen:
            seen.add(t)
            t = self.types[t].get("base")
        return t

    baseType = base_type

    def type_facets(self, q: str) -> Optional[Dict[str, Any]]:
        c = self.concepts.get(q)
        t = c.get("type") if c else None
        return self.types.get(t) if t else None

    typeFacets = type_facets

    def enumerations(self, q: str) -> Optional[List[str]]:
        c = self.concepts.get(q)
        t = c.get("type") if c else None
        while t and t in self.types:
            enums = self.types[t].get("enumerations")
            if enums:
                return enums
            t = self.types[t].get("base")
        return None

    def is_numeric(self, q: str) -> bool:
        return self.base_type(q) in NUMERIC_BASES

    isNumeric = is_numeric

    def is_monetary(self, q: str) -> bool:
        return self.base_type(q) == "xbrli:monetaryItemType"

    isMonetary = is_monetary

    def data_type(self, q: str) -> str:
        b = self.base_type(q)
        if self.enumerations(q):
            return "enum"
        return DATA_TYPE_MAP.get(b or "", "decimal" if self.is_numeric(q) else "string")

    dataType = data_type

    def lang_allowed(self, q: str) -> bool:
        c = self.concepts.get(q)
        return bool(c and c.get("type") in LANG_TYPES)

    langAllowed = lang_allowed

    def is_reportable(self, q: str) -> bool:
        c = self.concepts.get(q)
        return bool(
            c
            and c.get("kind") == "item"
            and c.get("substitutionGroup") == "xbrli:item"
        )

    isReportable = is_reportable

    # ---------- ELRs / presentation
    def elr(self, uri: str) -> Optional[Dict[str, Any]]:
        return self._elr_by_uri.get(uri)

    def elr_by_code(self, code: str) -> Optional[Dict[str, Any]]:
        return self._elr_by_code.get(code)

    elrByCode = elr_by_code

    def presentation_children(self, elr: str, from_concept: str) -> List[Dict[str, Any]]:
        return self._pres_children.get(elr, {}).get(from_concept, [])

    presentationChildren = presentation_children

    def concept_elrs(self, q: str) -> List[str]:
        return self.json.get("conceptElrs", {}).get(q, [])

    conceptElrs = concept_elrs

    # ---------- tables / dimensions
    def table(self, table_id: str) -> Optional[Dict[str, Any]]:
        return self._table_by_id.get(table_id)

    def tables_for_concept(self, q: str) -> List[Dict[str, Any]]:
        return self._tables_by_concept.get(q, [])

    tablesForConcept = tables_for_concept

    def tables_in_elr(self, uri: str) -> List[Dict[str, Any]]:
        return [t for t in self.tables if t.get("presentationElr") == uri]

    tablesInElr = tables_in_elr

    def concept_hypercubes(self, q: str) -> List[Dict[str, Any]]:
        return self.json.get("conceptHypercubes", {}).get(q, [])

    conceptHypercubes = concept_hypercubes

    def hypercube(self, hc: str, elr: str) -> Optional[Dict[str, Any]]:
        return self.json.get("hypercubes", {}).get(f"{hc}@{elr}")

    def dimension_default(self, axis: str) -> Optional[str]:
        return self.defaults.get(axis)

    dimensionDefault = dimension_default

    def is_typed_axis(self, axis: str) -> bool:
        c = self.concepts.get(axis)
        return bool(c and c.get("kind") == "typedAxis")

    isTypedAxis = is_typed_axis

    def typed_domain(self, axis: str) -> Optional[str]:
        c = self.concepts.get(axis)
        return c.get("typedDomain") if c else None

    typedDomain = typed_domain

    def axis_info(self, axis: str) -> Optional[Dict[str, Any]]:
        if self._axis_info is None:
            self._axis_info = {}
            for hc in self.json.get("hypercubes", {}).values():
                for ax in hc.get("axes", []):
                    axis_name = ax["axis"]
                    info = self._axis_info.get(axis_name)
                    if not info:
                        info = {
                            "axis": axis_name,
                            "typed": ax.get("typed", False),
                            "typedDomain": ax.get("typedDomain"),
                            "members": {},
                            "parents": {},
                        }
                        self._axis_info[axis_name] = info
                    for m in ax.get("members", []):
                        mem_name = m["member"]
                        prev = info["members"].get(mem_name)
                        info["members"][mem_name] = {
                            "member": mem_name,
                            "usable": (prev.get("usable", False) if prev else False) or m.get("usable", False),
                            "depth": m.get("depth", 0),
                        }
                        if m.get("parent") and mem_name not in info["parents"]:
                            info["parents"][mem_name] = m["parent"]
        return self._axis_info.get(axis)

    axisInfo = axis_info

    def member_parent(self, axis: str, member: str) -> Optional[str]:
        info = self.axis_info(axis)
        return info.get("parents", {}).get(member) if info else None

    memberParent = member_parent

    def member_children(self, axis_def: Dict[str, Any], member: str) -> List[str]:
        return [m["member"] for m in axis_def.get("members", []) if m.get("parent") == member]

    memberChildren = member_children


_AUTHORITY_REGISTRY: Dict[str, Authority] = {}


def get_authority(
    taxonomy: str = "ci",
    path: Optional[Union[str, Path]] = None,
) -> Authority:
    """Returns an Authority instance for the specified taxonomy ('ci', 'ind_as', 'costing').

    Maintains backward compatibility when invoked with a path or no arguments.
    """
    global _AUTHORITY_REGISTRY
    
    # If path is provided directly as first arg
    if isinstance(taxonomy, (Path, str)) and ("/" in str(taxonomy) or "\\" in str(taxonomy) or str(taxonomy).endswith(".json")):
        path = taxonomy
        tax_key = "custom"
    else:
        tax_key = (taxonomy or "ci").lower().replace("-", "_")

    if tax_key not in _AUTHORITY_REGISTRY:
        if path:
            p = Path(path)
        else:
            root = Path(__file__).resolve().parents[2]
            filename_map = {
                "ci": "ci_knowledge_base.json",
                "ind_as": "ind_as_knowledge_base.json",
                "costing": "costing_knowledge_base.json",
            }
            fname = filename_map.get(tax_key, "ci_knowledge_base.json")
            candidates = [
                root / "Knowlege_base" / fname,
                root / "Knowledge_base" / fname,
            ]
            if tax_key == "ci":
                candidates.extend([
                    root / "Knowlege_base" / "MCA_AUTHORITY.json",
                    root / "Knowledge_base" / "MCA_AUTHORITY.json",
                    root / "MCA_AUTHORITY.json",
                ])
            p = next((c for c in candidates if c.exists()), candidates[0])

        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        _AUTHORITY_REGISTRY[tax_key] = Authority(data)

    return _AUTHORITY_REGISTRY[tax_key]
