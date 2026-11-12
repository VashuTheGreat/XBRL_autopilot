"""The fact classifier is taxonomy-generic: sections come from ELR titles, never codes (C&I files general information
at [400100], Ind AS at [700300]; Costing numbers everything 1xxxxx)."""
import datetime as dt
import json

import pytest

from src.evaluation.fact_kinds import FactClassifier, FactKind, ValueType
from src.evaluation.instance_facts import FiledFact
from src.services.engine_authority.specs import SPECS

END = dt.date(2026, 3, 31)


def _authority(tid: str) -> dict:
    with SPECS[tid].output.open(encoding="utf-8") as fh:
        return json.load(fh)


def _only_in(a: dict, title: str) -> str:
    """A reportable item presented only in the ELR(s) with this title."""
    uris = {e["uri"] for e in a["elrs"] if e["title"] == title}
    for q, elrs in sorted(a["conceptElrs"].items()):
        c = a["concepts"][q]
        if elrs and set(elrs) <= uris and not c.get("abstract") and c.get("kind") == "item" and not a["conceptHypercubes"].get(q):
            return q
    raise AssertionError(f"no concept only in {title}")


@pytest.mark.parametrize("tid", ["ci_taxonomy", "ind_as_taxonomy"])
def test_sections_by_title_in_both_taxonomies(tid):
    a = _authority(tid)
    cls = FactClassifier(a)
    general = _only_in(a, "Disclosure of general information about company")
    g = cls.classify(FiledFact(general, END, False, (), None, None, "x"))
    assert g.section == "general" and g.kind in (FactKind.VALUE, FactKind.TEXT_BLOCK)
    assets = next(q for q in a["concepts"] if q.endswith(":Assets"))
    s = cls.classify(FiledFact(assets, END, True, (), "INR", -3, "100"))
    assert (s.section, s.kind, s.value_type) == ("statements", FactKind.AMOUNT, ValueType.AMOUNT)


@pytest.mark.parametrize("tid", ["ci_taxonomy", "ind_as_taxonomy"])
def test_a_dimensional_amount_belongs_to_its_table(tid):
    a = _authority(tid)
    t = next(t for t in a["tables"] if t["axes"] and not t["axes"][0]["typed"] and t["axes"][0]["members"]
             and any(a["concepts"][q].get("type") == "xbrli:monetaryItemType" for q in t["lineItems"]))
    q = next(q for q in t["lineItems"] if a["concepts"][q].get("type") == "xbrli:monetaryItemType")
    member = t["axes"][0]["members"][-1]["member"]
    c = FactClassifier(a).classify(FiledFact(q, END, True, ((t["axes"][0]["axis"], member),), "INR", -3, "5"))
    assert c.kind is FactKind.TABLE_AMOUNT and c.table_id is not None
