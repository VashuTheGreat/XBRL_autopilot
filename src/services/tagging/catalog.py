"""The taxonomy as the tagger sees it: reportable concepts with their labels, period type, data type, the statements
they appear on, and whether a plain cell (no dimensions) can report them.

Built once per taxonomy from knowledge_base/<kb>_engine_authority.json (ADR-0010), the same file the engine files
with, so a suggestion is always taggable by MappingService. Statements are found by ELR title, never by code.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from src.services.tagging.bm25 import Bm25Index
from src.services.tagging.text import norm_label, tokens

# label roles a row label is compared with, best first
MATCH_ROLES = ("label", "terseLabel", "totalLabel", "netLabel", "periodEndLabel", "periodStartLabel",
               "negatedLabel", "negatedTerseLabel", "negatedTotalLabel")
NEGATED_ROLES = frozenset({"negatedLabel", "negatedTerseLabel", "negatedTotalLabel"})
NUMERIC_TYPES = {
    "xbrli:monetaryItemType": "monetary",
    "xbrli:decimalItemType": "decimal",
    "xbrli:sharesItemType": "shares",
    "num:perShareItemType": "perShare",
    "num:percentItemType": "percent",
    "xbrli:pureItemType": "pure",
}


def statement_kind(title: str) -> str:
    """ELR title → the sheet kind it belongs to ("Balance sheet" → balance_sheet; any "Notes - …" → notes)."""
    t = title.lower()
    if "changes in equity" in t:
        return "equity"
    if "cash flow statement" in t and not t.startswith("notes"):
        return "cash_flow"
    if t.startswith("balance sheet"):
        return "balance_sheet"
    if t.startswith("statement of profit and loss") or t.startswith("statement of income and expenditure"):
        return "profit_loss"
    return "notes"


@dataclass(frozen=True)
class ConceptInfo:
    qname: str
    labels: dict[str, str]  # role → text
    period_type: str | None
    balance: str | None
    data_type: str  # monetary | decimal | shares | perShare | percent | pure
    kinds: frozenset[str]  # sheet kinds of the ELRs it is presented in
    elr_codes: tuple[str, ...]
    is_total: bool  # a calculation parent, or it has a total label

    @property
    def label(self) -> str:
        return self.labels.get("label") or self.qname


class TaggingCatalog:
    def __init__(self, authority: dict):
        self.taxonomy_id: str = authority.get("meta", {}).get("taxonomyId", "")
        elr_kind = {e["uri"]: statement_kind(e["title"]) for e in authority["elrs"]}
        elr_code = {e["uri"]: e["code"] for e in authority["elrs"]}
        calc_parents = {arc["from"] for arcs in authority.get("calculation", {}).values() for arc in arcs}
        self._authority = authority
        self.concepts: dict[str, ConceptInfo] = {}
        for qname, c in authority["concepts"].items():
            data_type = NUMERIC_TYPES.get(c.get("type") or "")
            if c.get("kind") != "item" or c.get("abstract") or not data_type:
                continue
            if not _nondim_allowed(authority, qname):
                continue
            elrs = authority["conceptElrs"].get(qname, [])
            labels = {r: t for r, t in (c.get("labels") or {}).items() if r in MATCH_ROLES and t}
            self.concepts[qname] = ConceptInfo(
                qname=qname, labels=labels, period_type=c.get("periodType"), balance=c.get("balance"),
                data_type=data_type, kinds=frozenset(elr_kind[u] for u in elrs if u in elr_kind),
                elr_codes=tuple(sorted({elr_code[u] for u in elrs if u in elr_code})),
                is_total=qname in calc_parents or "totalLabel" in labels,
            )
        # exact lookups: normalised text and order-free token set of every label role
        self.by_norm: dict[str, list[tuple[str, str]]] = {}
        self.by_tokens: dict[frozenset[str], list[tuple[str, str]]] = {}
        docs: dict[str, list[str]] = {}
        for q, info in self.concepts.items():
            words: list[str] = []
            for role, text in info.labels.items():
                self.by_norm.setdefault(norm_label(text), []).append((q, role))
                toks = tokens(text)
                self.by_tokens.setdefault(frozenset(toks), []).append((q, role))
                words.extend(t for t in toks if t not in words)
            docs[q] = words
        self.index = Bm25Index(docs)

    def get(self, qname: str) -> ConceptInfo | None:
        return self.concepts.get(qname)


def _nondim_allowed(a: dict, concept: str) -> bool:
    """Port of the engine's nondimAllowed: some base set accepts a context without dimensions."""
    base_sets = a["conceptHypercubes"].get(concept) or []
    if not base_sets:
        return True
    for bs in base_sets:
        pos = [h for h in bs["hypercubes"] if h["type"] == "all"]
        negs = [h for h in bs["hypercubes"] if h["type"] == "notAll"]
        if not pos or not all(_empty_context_satisfies(a, h) for h in pos):
            continue
        if any(_empty_context_satisfies(a, h) for h in negs):
            continue
        return True
    return False


def _empty_context_satisfies(a: dict, h: dict) -> bool:
    hc = a["hypercubes"].get(f"{h['hypercube']}@{h['hcElr']}")
    if hc is None:
        return False
    for ax in hc["axes"]:
        default = None if ax.get("typed") else a["dimensionDefaults"].get(ax["axis"])
        member = default and next((m for m in ax.get("members", []) if m["member"] == default), None)
        if not (member and member.get("usable")):
            return False
    return True


_ENGINE_AUTHORITY_FILE = re.compile(r"^[a-z_]+_engine_authority\.json$")


@lru_cache(maxsize=4)
def load_catalog(path: str) -> TaggingCatalog:
    p = Path(path)
    if not _ENGINE_AUTHORITY_FILE.match(p.name):
        raise ValueError(f"not an engine authority file: {p.name}")
    with p.open(encoding="utf-8") as f:
        return TaggingCatalog(json.load(f))


def catalog_for(taxonomy_id: str) -> TaggingCatalog:
    """The catalog of a filing taxonomy (ci_taxonomy | ind_as_taxonomy); LookupError when it has no engine authority."""
    from src.services.engine_authority.specs import SPECS

    spec = SPECS.get(taxonomy_id)
    if spec is None or not spec.output.exists():
        raise LookupError(f"Taxonomy '{taxonomy_id}' has no engine authority; auto-tagging supports {', '.join(SPECS)}")
    return load_catalog(str(spec.output))
