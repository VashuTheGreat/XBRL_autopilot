"""Read access to one taxonomy knowledge base (knowledge_base/*.json), plus the indexes the API needs.

The knowledge base is built by src/ingestion (rebuild_knowledge_base). This class never mutates it; indexes are
built lazily and cached per taxonomy (see get_authority in the routes and TaxonomyLoader).
"""
import json
from functools import cached_property
from pathlib import Path
from typing import Any, Dict, List, Optional

from src.constants import (
    CI_OUTPUT_JSON,
    COST_OUTPUT_JSON,
    COSTING_TAXONOMY_VDB,
    CI_TAXONOMY_VDB,
    IND_AS_TAXONOMY_VDB,
    INDAS_OUTPUT_JSON,
)
from src.core.elr_groups import classify_elr, elr_code, elr_title

_KB_CACHE: Dict[str, Dict[str, Any]] = {}

SUPPORTED_TAXONOMIES: Dict[str, Path] = {
    CI_TAXONOMY_VDB: CI_OUTPUT_JSON,
    IND_AS_TAXONOMY_VDB: INDAS_OUTPUT_JSON,
    COSTING_TAXONOMY_VDB: COST_OUTPUT_JSON,
}


def _load_kb(path: Path | str) -> Dict[str, Any]:
    key = str(path)
    if key not in _KB_CACHE:
        with open(key, "r", encoding="utf-8") as f:
            _KB_CACHE[key] = json.load(f)
    return _KB_CACHE[key]


def clear_kb_cache() -> None:
    _KB_CACHE.clear()


class Authority:
    def __init__(self, taxonomy_id: str):
        if taxonomy_id not in SUPPORTED_TAXONOMIES:
            raise ValueError(f"taxonomy id not found: {taxonomy_id}")
        self.taxonomy_id = taxonomy_id
        self.taxonomy_type = taxonomy_id  # alias used by the integrity tests
        self.knowledge_base = _load_kb(SUPPORTED_TAXONOMIES[taxonomy_id])

    # ------------------------------------------------------------------ raw sections
    def get_meta(self) -> Dict[str, Any]:
        return self.knowledge_base.get("meta", {})

    def get_namespaces(self) -> Dict[str, str]:
        return self.knowledge_base.get("namespaces", {})

    def get_roles(self) -> Dict[str, Any]:
        return self.knowledge_base.get("roles", {})

    def get_presentation(self) -> Dict[str, Any]:
        return self.knowledge_base.get("presentation", {})

    def get_calculation(self) -> Dict[str, Any]:
        return self.knowledge_base.get("calculation", {})

    def get_definition(self) -> Dict[str, Any]:
        return self.knowledge_base.get("definition", {})

    def get_concepts(self) -> Dict[str, Any]:
        return self.knowledge_base.get("concepts", {})

    def get_types(self) -> Dict[str, Any]:
        return self.knowledge_base.get("types", {})

    def get_business_rules(self) -> Dict[str, Any]:
        return self.knowledge_base.get("businessRules", {})

    # property aliases (used by tests/test_taxonomy_integrity.py via TaxonomyLoader)
    meta = property(get_meta)
    namespaces = property(get_namespaces)
    roles = property(get_roles)
    presentation = property(get_presentation)
    calculation = property(get_calculation)
    definition = property(get_definition)
    concepts = property(get_concepts)
    types = property(get_types)
    business_rules = property(get_business_rules)

    # ------------------------------------------------------------------ concepts
    def get_concept(self, qname: str) -> Optional[Dict[str, Any]]:
        return self.get_concepts().get(qname)

    def label(self, qname: str) -> str:
        c = self.get_concept(qname) or {}
        labels = c.get("labels") or {}
        return labels.get("label") or labels.get("terseLabel") or c.get("name") or qname

    def is_mandatory(self, qname: str) -> bool:
        c = self.get_concept(qname) or {}
        return bool(c.get("isMandatory")) or qname in set(self.get_business_rules().get("mandatoryConcepts", []))

    def is_reportable(self, qname: str) -> bool:
        """An item a value can be reported for (not an abstract heading, axis, member or hypercube)."""
        c = self.get_concept(qname)
        return bool(c) and not c.get("abstract") and c.get("type") != "nonnum:domainItemType" and not c.get("isTypedDomain")

    @cached_property
    def _concept_elr_codes(self) -> Dict[str, List[str]]:
        out: Dict[str, List[str]] = {}
        codes = {uri: elr_code(r.get("definition", "")) for uri, r in self.get_roles().items()}
        for uri, arcs in self.get_presentation().items():
            code = codes.get(uri)
            if not code:
                continue
            for arc in arcs:
                for q in (arc.get("from"), arc.get("to")):
                    lst = out.setdefault(q, [])
                    if code not in lst:
                        lst.append(code)
        return {q: sorted(v) for q, v in out.items()}

    def concept_summary(self, qname: str) -> Dict[str, Any]:
        c = self.get_concept(qname) or {}
        return {
            "qname": qname,
            "label": self.label(qname),
            "type": c.get("type"),
            "periodType": c.get("periodType"),
            "balance": c.get("balance"),
            "abstract": bool(c.get("abstract")),
            "reportable": self.is_reportable(qname),
            "mandatory": self.is_mandatory(qname),
            "elrCodes": self._concept_elr_codes.get(qname, []),
        }

    def search_concepts(self, query: str, limit: int = 50, offset: int = 0, reportable_only: bool = True) -> Dict[str, Any]:
        """Every word must appear in the label or qname. Exact > prefix > contains; statement elements first."""
        words = [w for w in query.lower().split() if w]
        if not words:
            return {"total": 0, "items": []}
        phrase = " ".join(words)
        scored = []
        for qname in self.get_concepts():
            if reportable_only and not self.is_reportable(qname):
                continue
            label = self.label(qname)
            hay = f"{label} {qname}".lower()
            if not all(w in hay for w in words):
                continue
            lab = label.lower()
            score = 100 if lab == phrase else 50 if lab.startswith(phrase) else 20 if phrase in lab else 0
            codes = self._concept_elr_codes.get(qname, [])
            if codes and codes[0][0] == "1":
                score += 5  # appears on a primary statement
            scored.append((-score, len(label), label, qname))
        scored.sort()
        page = scored[offset : offset + limit]
        return {"total": len(scored), "items": [self.concept_summary(q) for *_, q in page]}

    def get_business_rule(self, rule_id: str) -> Optional[Dict[str, Any]]:
        """Rules have no ids in the knowledge base: rule_id is the rule's index or its element name."""
        rules = self.get_business_rules().get("rules", [])
        if rule_id.isdigit():
            i = int(rule_id)
            return {"index": i, **rules[i]} if 0 <= i < len(rules) else None
        matches = [{"index": i, **r} for i, r in enumerate(rules) if r.get("element") == rule_id or r.get("concept") == rule_id]
        return {"element": rule_id, "rules": matches} if matches else None

    def rules_for_concept(self, qname: str) -> Dict[str, Any]:
        br = self.get_business_rules()
        c = self.get_concept(qname) or {}
        return {
            "mandatory": self.is_mandatory(qname),
            "mandatoryConditional": bool(c.get("isMandatoryConditional")),
            "mandatoryConsolidated": bool(c.get("isMandatoryConsolidated")),
            "rules": [r for r in br.get("rules", []) if r.get("concept") == qname],
        }

    # ------------------------------------------------------------------ ELRs (statements / notes / disclosures)
    @cached_property
    def _elrs(self) -> List[Dict[str, Any]]:
        presentation = self.get_presentation()
        out = []
        for uri, role in self.get_roles().items():
            if not presentation.get(uri):
                continue  # only roles that present something are user-facing statements
            definition = role.get("definition", "")
            title = elr_title(definition)
            out.append({
                "uri": uri,
                "id": role.get("id"),
                "code": role.get("code") or elr_code(definition),
                "title": title,
                "group": classify_elr(title),
            })
        return sorted(out, key=lambda e: (e["code"] or "~", e["title"]))

    def list_elrs(self) -> List[Dict[str, Any]]:
        return list(self._elrs)

    def get_role(self, key: str) -> Optional[Dict[str, Any]]:
        """Find a role by id, code ('100100') or URI. Returns the role plus its uri."""
        roles = self.get_roles()
        if key in roles:
            return {"uri": key, **roles[key]}
        for uri, role in roles.items():
            if role.get("id") == key or role.get("code") == key or elr_code(role.get("definition", "")) == key:
                return {"uri": uri, **role}
        return None

    def elr_tree(self, key: str) -> Optional[Dict[str, Any]]:
        """Presentation tree of one ELR: nested {qname, label, abstract, type, periodType, balance, children}."""
        role = self.get_role(key)
        if not role:
            return None
        arcs = self.get_presentation().get(role["uri"], [])
        children: Dict[str, List[Dict[str, Any]]] = {}
        froms, tos = set(), set()
        for arc in arcs:
            children.setdefault(arc["from"], []).append(arc)
            froms.add(arc["from"])
            tos.add(arc["to"])

        def node(qname: str, path: frozenset) -> Dict[str, Any]:
            c = self.get_concept(qname) or {}
            kids = sorted(children.get(qname, []), key=lambda a: (a.get("order") or 0))
            return {
                "qname": qname,
                "label": self.label(qname),
                "abstract": bool(c.get("abstract")),
                "type": c.get("type"),
                "periodType": c.get("periodType"),
                "balance": c.get("balance"),
                "children": [node(a["to"], path | {qname}) for a in kids if a["to"] not in path],  # cycle-safe
            }

        title = elr_title(role.get("definition", ""))
        return {
            "uri": role["uri"],
            "code": role.get("code") or elr_code(role.get("definition", "")),
            "title": title,
            "group": classify_elr(title),
            "tree": [node(r, frozenset()) for r in sorted(froms - tos)],
        }
