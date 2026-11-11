"""Facts of an XBRL instance (stdlib ElementTree), for evaluation: concept, period, dimensions, unit, decimals, value."""
from __future__ import annotations

import datetime as dt
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path

XBRLI = "http://www.xbrl.org/2003/instance"
XBRLDI = "http://xbrl.org/2006/xbrldi"
LINK = "http://www.xbrl.org/2003/linkbase"


@dataclass(frozen=True)
class InstanceFact:
    concept: str  # prefixed qname, e.g. ind-as:TradeReceivablesCurrent
    end: dt.date
    instant: bool
    dims: tuple[tuple[str, str], ...]
    unit: str | None
    decimals: int | None
    value: Decimal


def _prefixes(path: Path) -> dict[str, str]:
    """namespace URI → prefix as declared in the file."""
    out: dict[str, str] = {}
    for _, (prefix, uri) in ET.iterparse(path, events=("start-ns",)):
        out.setdefault(uri, prefix)
    return out


def read_numeric_facts(path: Path) -> list[InstanceFact]:
    prefixes = _prefixes(path)
    root = ET.parse(path).getroot()
    contexts: dict[str, tuple[dt.date, bool, tuple]] = {}
    for ctx in root.iter(f"{{{XBRLI}}}context"):
        period = ctx.find(f"{{{XBRLI}}}period")
        inst = period.find(f"{{{XBRLI}}}instant")
        end = inst if inst is not None else period.find(f"{{{XBRLI}}}endDate")
        dims = []
        for m in ctx.iter(f"{{{XBRLDI}}}explicitMember"):
            dims.append((m.get("dimension"), (m.text or "").strip()))
        for m in ctx.iter(f"{{{XBRLDI}}}typedMember"):
            dims.append((m.get("dimension"), "".join(m.itertext()).strip()))
        contexts[ctx.get("id")] = (dt.date.fromisoformat(end.text.strip()), inst is not None, tuple(sorted(dims)))
    facts = []
    for el in root:
        ns, _, local = el.tag[1:].partition("}") if el.tag.startswith("{") else ("", "", el.tag)
        if ns in (XBRLI, LINK) or el.get("contextRef") is None or el.get("unitRef") is None:
            continue
        try:
            value = Decimal((el.text or "").strip())
        except InvalidOperation:
            continue
        end, instant, dims = contexts[el.get("contextRef")]
        dec = el.get("decimals")
        facts.append(InstanceFact(
            concept=f"{prefixes.get(ns, ns)}:{local}", end=end, instant=instant, dims=dims, unit=el.get("unitRef"),
            decimals=None if dec in (None, "INF") else int(dec), value=value,
        ))
    return facts
