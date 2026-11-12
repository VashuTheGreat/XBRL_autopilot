"""The tools the fix agent may call (docs/07). Two sources, and nothing else:
- the knowledge base (taxonomy concepts, calculation networks, the MCA rules: raw text and executable form);
- the bundle the app sent (facts of the filing, Excel source rows).
Every answer is compact JSON with a size cap, so a tool call cannot flood the model's context.
"""
from __future__ import annotations

import json
from functools import lru_cache
from typing import Any, Callable

from src.core.taxonomy_loader import load_taxonomy
from src.services.fix_agent.bundle import FixRequest
from src.services.tagging.catalog import catalog_for
from src.services.tagging.text import tokens

MAX_RESULT_CHARS = 6000
MAX_FACTS_PER_CALL = 80


def _fn(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required, "additionalProperties": False},
        },
    }


TOOL_SPECS: list[dict[str, Any]] = [
    _fn("get_concept", "Taxonomy element: labels, documentation, data type, period type, balance, mandatory flags, "
        "the statements (ELR codes) it is presented in.", {"qname": {"type": "string"}}, ["qname"]),
    _fn("get_rule", "MCA business rule: the executable form of a rule id, and the raw MCA rule texts for an element.",
        {"rule_id": {"type": "string"}, "concept": {"type": "string"}}, []),
    _fn("get_calc_tree", "Calculation parents and children of an element, with weights, per statement; values of the "
        "filing's facts for them when the bundle has them.", {"concept": {"type": "string"}, "elr_code": {"type": "string"}},
        ["concept"]),
    _fn("facts_in_elr", "The filing's facts presented in one statement / note (ELR code such as 100100), from the bundle.",
        {"elr_code": {"type": "string"}}, ["elr_code"]),
    _fn("search_taxonomy", "Find taxonomy elements by words (for a re-tag): best matches with label, period type, "
        "balance and statements.", {"text": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 10}},
        ["text"]),
    _fn("get_source_row", "The Excel row of a cell: its label, value, and the other value cells of the row (with the "
        "period of their column when known).", {"sheet": {"type": "string"}, "ref": {"type": "string"}}, ["sheet", "ref"]),
]


@lru_cache(maxsize=2)
def _engine_rules(taxonomy_id: str) -> dict[str, dict[str, Any]]:
    from src.services.engine_rules.specs import RULE_SPECS

    spec = RULE_SPECS.get(taxonomy_id)
    if spec is None or not spec.rules_file.exists():
        return {}
    with spec.rules_file.open(encoding="utf-8") as f:
        rules = json.load(f)["businessRules"]["rules"]
    return {r["id"]: r for r in rules}


class FixTools:
    def __init__(self, bundle: FixRequest):
        self.bundle = bundle
        self.taxonomy_id = bundle.taxonomy
        self._catalog = catalog_for(bundle.taxonomy)
        self._engine = self._catalog._authority  # the engine authority JSON (ADR-0010)
        self._elr_code = {e["uri"]: e["code"] for e in self._engine["elrs"]}
        self._handlers: dict[str, Callable[..., Any]] = {
            "get_concept": self.get_concept,
            "get_rule": self.get_rule,
            "get_calc_tree": self.get_calc_tree,
            "facts_in_elr": self.facts_in_elr,
            "search_taxonomy": self.search_taxonomy,
            "get_source_row": self.get_source_row,
        }

    # ------------------------------------------------------------------ dispatch
    def known_concept(self, qname: str) -> bool:
        return qname in self._engine["concepts"]

    def call(self, name: str, arguments: str | dict | None) -> str:
        """Runs one tool call; always returns JSON text (errors included), capped in size."""
        fn = self._handlers.get(name)
        if fn is None:
            return _json({"error": f"unknown tool {name}"})
        try:
            args = json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
            if not isinstance(args, dict):
                raise TypeError("arguments must be an object")
            return _json(fn(**{k: v for k, v in args.items() if isinstance(k, str)}))
        except TypeError as exc:
            return _json({"error": f"bad arguments for {name}: {exc}"})
        except Exception as exc:  # a tool failure is an answer for the model, not a crash of the request
            return _json({"error": f"{name} failed: {type(exc).__name__}"})

    # ------------------------------------------------------------------ knowledge base
    def get_concept(self, qname: str) -> dict[str, Any]:
        c = self._engine["concepts"].get(qname)
        if not c:
            return {"error": f"{qname} is not an element of this taxonomy"}
        kb = load_taxonomy(self.taxonomy_id)
        summary = kb.concept_summary(qname) if kb.get_concept(qname) else {}
        labels = c.get("labels") or {}
        doc = labels.get("documentation") or ""
        return {
            "qname": qname,
            "labels": {k: v for k, v in labels.items() if k != "documentation"},
            "documentation": doc[:800],
            "type": c.get("type"),
            "periodType": c.get("periodType"),
            "balance": c.get("balance"),
            "nillable": c.get("nillable"),
            "mandatory": summary.get("mandatory", False),
            "elrCodes": sorted({self._elr_code[u] for u in self._engine["conceptElrs"].get(qname, []) if u in self._elr_code}),
            "inTable": bool(self._engine.get("conceptHypercubes", {}).get(qname)),
        }

    def get_rule(self, rule_id: str | None = None, concept: str | None = None) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if rule_id:
            r = _engine_rules(self.taxonomy_id).get(rule_id)
            if r:
                out["rule"] = {k: r.get(k) for k in ("id", "family", "status", "implementation", "elr", "text", "scope", "subject")}
                out["rule"]["ast"] = _clip(r.get("ast"), 1500)
            else:
                out["rule"] = {"error": f"no rule {rule_id}"}
        if concept:
            kb = load_taxonomy(self.taxonomy_id)
            rules = kb.rules_for_concept(concept) if kb.get_concept(concept) else {"rules": []}
            out["mcaRules"] = [
                {"type": r.get("type"), "elr": r.get("elr"), "text": (r.get("ruleText") or "")[:600]} for r in rules["rules"][:10]
            ]
            out["mandatory"] = rules.get("mandatory", False)
        return out or {"error": "give rule_id or concept"}

    def get_calc_tree(self, concept: str, elr_code: str | None = None) -> dict[str, Any]:
        label = lambda q: (self._engine["concepts"].get(q, {}).get("labels") or {}).get("label") or q  # noqa: E731
        values = self._values_by_concept()
        networks = []
        for uri, arcs in self._engine.get("calculation", {}).items():
            code = self._elr_code.get(uri)
            if elr_code and code != elr_code:
                continue
            parents = [{"concept": a["from"], "label": label(a["from"]), "weight": a["weight"], "values": values.get(a["from"], [])}
                       for a in arcs if a["to"] == concept]
            children = [{"concept": a["to"], "label": label(a["to"]), "weight": a["weight"], "values": values.get(a["to"], [])}
                        for a in arcs if a["from"] == concept]
            if parents or children:
                networks.append({"elrCode": code, "parents": parents, "children": children})
        return {"concept": concept, "label": label(concept), "networks": networks[:8]}

    def search_taxonomy(self, text: str, limit: int = 8) -> dict[str, Any]:
        limit = max(1, min(10, int(limit)))
        query = {t: 1.0 for t in tokens(text)}
        hits = self._catalog.index.search(query, limit=limit) if query else []
        items = []
        for q, score in hits:
            info = self._catalog.get(q)
            items.append({"qname": q, "label": info.label if info else q, "periodType": info.period_type if info else None,
                          "balance": info.balance if info else None, "elrCodes": list(info.elr_codes) if info else [],
                          "score": round(score, 2)})
        if len(items) < limit:  # text elements are not in the amount index: plain word search in the knowledge base
            seen = {i["qname"] for i in items}
            for c in load_taxonomy(self.taxonomy_id).search_concepts(text, limit=limit)["items"]:
                if c["qname"] not in seen and len(items) < limit:
                    items.append({k: c.get(k) for k in ("qname", "label", "periodType", "balance", "elrCodes")})
        return {"items": items}

    # ------------------------------------------------------------------ bundle
    def facts_in_elr(self, elr_code: str) -> dict[str, Any]:
        facts = [f for f in self.bundle.facts if elr_code in f.elrs]
        return {"elrCode": elr_code, "count": len(facts), "facts": [_fact(f) for f in facts[:MAX_FACTS_PER_CALL]]}

    def get_source_row(self, sheet: str, ref: str) -> dict[str, Any]:
        for s in self.bundle.sources:
            if s.cell.sheet == sheet and s.cell.ref.upper() == ref.upper():
                return s.model_dump(exclude_none=True)
        return {"error": f"{sheet}!{ref} is not among the source rows the app sent"}

    def _values_by_concept(self) -> dict[str, list[dict[str, Any]]]:
        out: dict[str, list[dict[str, Any]]] = {}
        for f in self.bundle.facts:
            if not f.dims:
                out.setdefault(f.concept, []).append({"key": f.key, "scope": f.scope, "display": f.display, "nil": f.nil})
        return out


def _fact(f) -> dict[str, Any]:
    d = f.model_dump(exclude_none=True, exclude={"elrs"})
    if not d.get("dims"):
        d.pop("dims", None)
    return d


def _clip(node: Any, limit: int) -> Any:
    text = json.dumps(node, separators=(",", ":"))
    return node if len(text) <= limit else text[:limit] + "…"


def _json(data: Any) -> str:
    text = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    return text if len(text) <= MAX_RESULT_CHARS else text[:MAX_RESULT_CHARS] + "…(truncated)"
