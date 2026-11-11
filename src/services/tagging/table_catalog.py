"""The taxonomy's tables, as the table producers read them (ADR-0013): each table with axes, its numeric line items in
presentation order (with their label roles), its axes' members (default, usable, parent), and the word matching
between a row label or a column header and those labels. Built from the engine authority
(knowledge_base/<kb>_engine_authority.json), so any taxonomy works; nothing keys on table codes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from src.services.tagging.text import tokens

MIN_MATCH = 0.5

PERIOD_ROLES = ("periodStartLabel", "periodEndLabel")
# accountants' words for the taxonomy's (applied before tokenising)
PHRASES = [
    (re.compile(r"\bgross\s+block\b", re.I), "gross carrying amount"),
    (re.compile(r"\bnet\s+(?:block|carrying\s+(?:amount|value))\b", re.I), "carrying amount"),
    (re.compile(r"\baccumulated\s+depreciation\b", re.I), "accumulated depreciation impairment"),
    (re.compile(r"\b(?:charge|depreciation)\s+for\s+the\s+(?:year|period)\b", re.I), "depreciation"),
    (re.compile(r"\bprofit\s*/?\s*\(?\s*loss\s*\)?\s+for\s+the\s+(?:year|period)\b", re.I), "profit loss for period"),
    (re.compile(r"\bdeletions?\b", re.I), "disposals"),
    (re.compile(r"\bfvtpl\b", re.I), "fair value through profit or loss"),
    (re.compile(r"\bfvt?oci\b", re.I), "fair value through other comprehensive income"),
    (re.compile(r"\bholding\s+compan(?:y|ies)\b", re.I), "parent"),
    (re.compile(r"\b(?:key\s+manag\w*\s+person\w*|kmp)\b", re.I), "key management personnel"),
    # how an amount is stated, not what it is ("Purchase including taxes", "Sales of goods inclusive of taxes")
    (re.compile(r"\b(?:including|inclusive\s+of|incl\.?|excluding|exclusive\s+of|net\s+of)\s+(?:all\s+)?(?:taxes|tax|gst)\b", re.I), " "),
]

def text_tokens(s: str) -> frozenset[str]:
    t = str(s)
    for rx, rep in PHRASES:
        t = rx.sub(rep, t)
    return frozenset(w for w in tokens(t) if w not in ("member", "table", "axis", "abstract", "category"))


def contains(text: frozenset[str], label: frozenset[str]) -> float:
    """A label all of whose words appear in a longer text ("Gross Block Balance as at …" names "Gross carrying amount")."""
    return min(0.99, 0.85 + 0.03 * len(label)) if label and label <= text else 0.0  # the longest named member wins


def similarity(text: frozenset[str], label: frozenset[str]) -> float:
    """How well a row / header text names a label: all its words in the label scores high, then by overlap."""
    if not text or not label:
        return 0.0
    common = len(text & label)
    if not common:
        return 0.0
    if text <= label:
        return 0.6 + 0.4 * len(text) / len(label)
    return 2 * common / (len(text) + len(label)) * 0.8



# ------------------------------------------------------------------ the taxonomy's tables
@dataclass(frozen=True)
class TableItem:
    concept: str
    label: str
    tokens: frozenset[str]
    preferred_label: str | None
    period_type: str | None
    data_type: str | None


@dataclass(frozen=True)
class TableMember:
    member: str
    label: str
    tokens: frozenset[str]
    usable: bool
    is_default: bool
    parent: str | None = None


@dataclass(frozen=True)
class TableAxis:
    axis: str
    typed: bool
    members: tuple[TableMember, ...]

    @property
    def domain(self) -> frozenset[str]:
        """Words of the axis's root members ("financial assets"): every member repeats them, so they name nothing."""
        return frozenset().union(*(m.tokens for m in self.members if m.parent is None)) if self.members else frozenset()

    def own(self, m: TableMember) -> frozenset[str]:
        own = m.tokens - self.domain
        return own or m.tokens

    def numbered_families(self) -> dict[str, list[TableMember]]:
        """Numbered members by family ("Other financial assets at amortised cost, class 1 … 10"), in number order."""
        out: dict[str, list[tuple[int, TableMember]]] = {}
        for m in self.members:
            hit = _NUMBERED.match(m.member.split(":")[-1])
            if m.usable and hit:
                out.setdefault(hit.group(1), []).append((int(hit.group(2)), m))
        return {k: [m for _, m in sorted(v, key=lambda x: x[0])] for k, v in out.items() if len(v) >= 2}


@dataclass(frozen=True)
class TableInfo:
    id: str
    title: str
    items: tuple[TableItem, ...]
    axes: tuple[TableAxis, ...]
    # words most of the table's line items share (its subject: "property plant equipment"); rows rarely repeat them
    subject: frozenset[str] = frozenset()

    def item_tokens(self, item: TableItem) -> frozenset[str]:
        own = item.tokens - self.subject
        return own or item.tokens

    @property
    def balance_concept(self) -> str | None:
        """The element the table rolls forward (it has both an opening and a closing row), if exactly one."""
        roles: dict[str, set] = {}
        for i in self.items:
            if i.preferred_label in PERIOD_ROLES:
                roles.setdefault(i.concept, set()).add(i.preferred_label)
        both = [q for q, r in roles.items() if len(r) == 2]
        return both[0] if len(both) == 1 else None


NUMERIC = {"xbrli:monetaryItemType", "xbrli:sharesItemType", "num:perShareItemType", "xbrli:decimalItemType", "num:percentItemType", "xbrli:pureItemType"}


class TableCatalog:
    def __init__(self, authority: dict):
        concepts = authority["concepts"]
        defaults = authority.get("dimensionDefaults", {})
        presentation = authority.get("presentation", {})

        def label(q: str, role: str | None) -> str:
            labels = (concepts.get(q) or {}).get("labels") or {}
            return labels.get(role or "label") or labels.get("label") or q

        self.tables: list[TableInfo] = []
        for t in authority["tables"]:
            if not t["axes"]:
                continue
            items = _line_items(t, presentation.get(t.get("presentationElr") or "", []), concepts, label)
            axes = tuple(
                TableAxis(
                    ax["axis"], bool(ax.get("typed")),
                    tuple(
                        TableMember(m["member"], label(m["member"], None), text_tokens(label(m["member"], None)), bool(m.get("usable")), defaults.get(ax["axis"]) == m["member"], m.get("parent"))
                        for m in ax.get("members", [])
                    ),
                )
                for ax in t["axes"]
            )
            self.tables.append(TableInfo(t["id"], label(t["hypercube"], None), items, axes, _subject(items)))


def _subject(items: tuple[TableItem, ...]) -> frozenset[str]:
    if len(items) < 4:
        return frozenset()
    counts: dict[str, int] = {}
    for i in {x.concept: x for x in items}.values():
        for w in i.tokens:
            counts[w] = counts.get(w, 0) + 1
    n = len({x.concept for x in items})
    return frozenset(w for w, k in counts.items() if k >= 0.4 * n)


def _line_items(t: dict, arcs: list[dict], concepts: dict, label) -> tuple[TableItem, ...]:
    """The table's line items in presentation order, one per (element, label role) — the engine's buildTableView."""
    line = {n["concept"] for n in t.get("lineItemTree", [])}
    children: dict[str, list[dict]] = {}
    for a in arcs:
        children.setdefault(a["from"], []).append(a)
    for v in children.values():
        v.sort(key=lambda a: a.get("order", 0))
    out: list[TableItem] = []
    seen: set[tuple[str, str]] = set()

    def walk(q: str) -> None:
        for a in children.get(q, []):
            key = (a["to"], a.get("preferredLabel") or "")
            if a["to"] not in line or key in seen:
                continue
            seen.add(key)
            c = concepts.get(a["to"]) or {}
            if not c.get("abstract") and c.get("type") in NUMERIC:
                text = label(a["to"], a.get("preferredLabel"))
                out.append(TableItem(a["to"], text, text_tokens(label(a["to"], None)) | text_tokens(text), a.get("preferredLabel"), c.get("periodType"), c.get("type")))
            walk(a["to"])

    walk(t.get("primaryItem") or "")
    for n in t.get("lineItemNodes", []):
        walk(n)
    return tuple(out)


_NUMBERED_FIRST = re.compile(r"^[A-Za-z]+?1Member$")
_NUMBERED = re.compile(r"^([A-Za-z]+?)(\d+)Member$")
ONE_CLASS_CONFIDENCE = 0.7  # under 0.9: never accepted in bulk


def one_class_also(catalog: TableCatalog, concept: str) -> list[dict]:
    """'Also report as' for a company with one class (ADR-0013): the element under the first numbered member of the
    table's one "classes" axis (Equity shares 1), when every other axis of that table can stay at its default. MCA
    filings report a single class of shares this way (share capital, the share counts, EPS)."""
    out = []
    for t in catalog.tables:
        items = [i for i in t.items if i.concept == concept and i.preferred_label != "periodStartLabel"]
        if not items:
            continue
        numbered = [(a, m) for a in t.axes if not a.typed for m in a.members if m.usable and _NUMBERED_FIRST.match(m.member.split(":")[-1])]
        axes_with_first = {a.axis for a, _ in numbered}
        if len(axes_with_first) != 1:
            continue
        axis, member = numbered[0]
        others_ok = all(any(m.is_default and m.usable for m in a.members) for a in t.axes if a.axis != axis.axis)
        if not others_ok:
            continue
        item = next((i for i in items if i.preferred_label == "periodEndLabel"), items[0])
        out.append({"concept": concept, "tableId": t.id, "preferredLabel": item.preferred_label, "dims": [{"axis": axis.axis, "member": member.member}], "confidence": ONE_CLASS_CONFIDENCE, "reason": "one class"})
    return sorted(out, key=lambda x: x["tableId"])[:1]


@lru_cache(maxsize=4)
def table_catalog_for(taxonomy_id: str) -> TableCatalog:
    import json

    from src.services.engine_authority.specs import SPECS

    spec = SPECS.get(taxonomy_id)
    if spec is None or not spec.output.exists():
        raise LookupError(f"Taxonomy '{taxonomy_id}' has no engine authority")
    with spec.output.open(encoding="utf-8") as fh:
        return TableCatalog(json.load(fh))



def best_member(axis: TableAxis, text: frozenset[str]) -> tuple[TableMember | None, float]:
    best, score = None, 0.0
    for m in axis.members:
        if not m.usable:
            continue
        own = axis.own(m)
        s = max(similarity(text, m.tokens), similarity(text, own), covered(text, own))
        if s > score or (s == score and best is not None and len(m.tokens) < len(best.tokens)):
            best, score = m, s
    return best, score


def covered(text: frozenset[str], own: frozenset[str]) -> float:
    """A header that contains all of a member's own words (2+) names it ("Fair value at amortised cost")."""
    return 0.55 + 0.4 * len(own) / len(text) if len(own) >= 2 and own <= text else 0.0
