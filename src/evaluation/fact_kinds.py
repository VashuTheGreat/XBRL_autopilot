"""What kind of fact a filed fact is, as far as tagging is concerned (docs/06, end-to-end coverage).

Kinds (each needs a different way in from Excel):
- `amount`        numeric, no dimensions: a statement line or a note line (the Phase 8 tagger's job)
- `table_amount`  numeric, with dimensions: a cell of a note table (PPE classes, borrowings, related parties …)
- `value`         text / date / Yes-No / code, no dimensions (company name, accounting policies' choices …)
- `table_value`   the same inside a table (directors, KMP, auditors, related-party names …)
- `text_block`    a narrative block (policies, notes as text)

Section, from the title of the ELR the fact is presented in (`classify_elr`, as the catalog routes group them; never
by code: C&I has general information at [400100], Ind AS at [700300]): `statements`, `notes` and `general`
("Disclosure of general information…", "Disclosures - Auditors report / Directors report / Signatories …"), which a
workbook rarely holds.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from src.core.elr_groups import DISCLOSURES, NOTES, STATEMENTS, classify_elr
from src.evaluation.instance_facts import FiledFact

TEXT_BLOCK_TYPE = "nonnum:textBlockItemType"


class FactKind(str, Enum):
    AMOUNT = "amount"
    TABLE_AMOUNT = "table_amount"
    VALUE = "value"
    TABLE_VALUE = "table_value"
    TEXT_BLOCK = "text_block"


class ValueType(str, Enum):
    AMOUNT = "amount"
    TEXT = "text"
    DATE = "date"
    BOOLEAN = "boolean"
    TEXT_BLOCK = "text_block"


@dataclass(frozen=True)
class FactClass:
    kind: FactKind
    value_type: ValueType
    section: str  # statements | notes | general
    elr_code: str  # the table's ELR code for a dimensional fact, else the code of the concept's first ELR ("" when none)
    table_id: str | None


class FactClassifier:
    """Classifies filed facts against the engine authority of their taxonomy (knowledge_base/<kb>_engine_authority.json)."""

    def __init__(self, authority: dict):
        self._concepts = authority["concepts"]
        self._elr_code = {e["uri"]: e["code"] for e in authority["elrs"]}
        self._elr_section = {e["uri"]: _SECTION[classify_elr(e["title"])] for e in authority["elrs"]}
        self._concept_elrs = authority["conceptElrs"]
        self._tables_by_item: dict[str, list[dict]] = {}
        for t in authority["tables"]:
            for q in t["lineItems"]:
                self._tables_by_item.setdefault(q, []).append(t)

    def table_of(self, fact: FiledFact) -> dict | None:
        """The table that holds a dimensional fact: the concept is one of its line items and it has every axis used.
        Several can: the one with the fewest axes (the tightest fit) wins, then by id."""
        axes = {a for a, _ in fact.dims}
        fits = [t for t in self._tables_by_item.get(fact.concept, ()) if axes <= {ax["axis"] for ax in t["axes"]}]
        return min(fits, key=lambda t: (len(t["axes"]), t["id"])) if fits else None

    def classify(self, fact: FiledFact) -> FactClass:
        c = self._concepts.get(fact.concept) or {}
        ctype = c.get("type") or ""
        if ctype == TEXT_BLOCK_TYPE:
            value_type = ValueType.TEXT_BLOCK
        elif fact.numeric:
            value_type = ValueType.AMOUNT
        elif ctype == "xbrli:booleanItemType":
            value_type = ValueType.BOOLEAN
        elif ctype == "xbrli:dateItemType":
            value_type = ValueType.DATE
        else:
            value_type = ValueType.TEXT
        table = self.table_of(fact) if fact.dims else None
        if value_type is ValueType.TEXT_BLOCK:
            kind = FactKind.TEXT_BLOCK
        elif value_type is ValueType.AMOUNT:
            kind = FactKind.TABLE_AMOUNT if fact.dims else FactKind.AMOUNT
        else:
            kind = FactKind.TABLE_VALUE if fact.dims else FactKind.VALUE
        if table is not None:
            uris = [table["presentationElr"] or table["elr"]]
        else:
            uris = [u for u in self._concept_elrs.get(fact.concept, ()) if u in self._elr_code]
        # a concept presented in several ELRs counts where it is most prominent: a statement before a note
        uri = min(uris, key=lambda u: (_RANK[self._elr_section[u]], self._elr_code[u]), default=None)
        section = self._elr_section[uri] if uri in self._elr_section else "notes"
        return FactClass(kind, value_type, section, self._elr_code.get(uri, ""), table["id"] if table else None)


_SECTION = {STATEMENTS: "statements", NOTES: "notes", DISCLOSURES: "general"}
_RANK = {"statements": 0, "notes": 1, "general": 2}
