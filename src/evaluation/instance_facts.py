"""Facts of an XBRL instance (stdlib ElementTree), for evaluation: concept, period, dimensions, unit, decimals, value.

`read_facts` reads every fact (amounts, text, dates, Yes/No, text blocks); `read_numeric_facts` keeps the amounts.
"""
from __future__ import annotations

import datetime as dt
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path

XBRLI = "http://www.xbrl.org/2003/instance"
XBRLDI = "http://xbrl.org/2006/xbrldi"
LINK = "http://www.xbrl.org/2003/linkbase"
XSI_NIL = "{http://www.w3.org/2001/XMLSchema-instance}nil"


@dataclass(frozen=True)
class FiledFact:
    concept: str  # prefixed qname, e.g. ind-as:TradeReceivablesCurrent
    end: dt.date
    instant: bool
    dims: tuple[tuple[str, str], ...]  # (axis, member qname or typed value), sorted
    unit: str | None  # None: not a numeric fact
    decimals: int | None  # None: INF or not numeric
    text: str  # the element's text as filed (HTML of a text block, "true", "2026-03-31", …)
    nil: bool = False

    @property
    def numeric(self) -> bool:
        return self.unit is not None

    @property
    def amount(self) -> Decimal | None:
        if not self.numeric or self.nil:
            return None
        try:
            return Decimal(self.text.strip())
        except InvalidOperation:
            return None

    @property
    def key(self) -> tuple[str, dt.date, tuple]:
        """What identifies the fact in a filing: concept, period end, dimensions."""
        return (self.concept, self.end, self.dims)


@dataclass(frozen=True)
class InstanceFact:
    """A numeric fact (the Phase 8 answer key reads only these)."""
    concept: str
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


def read_facts(path: Path) -> list[FiledFact]:
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
        if ns in (XBRLI, LINK) or el.get("contextRef") is None:
            continue
        end, instant, dims = contexts[el.get("contextRef")]
        dec = el.get("decimals")
        facts.append(FiledFact(
            concept=f"{prefixes.get(ns, ns)}:{local}", end=end, instant=instant, dims=dims, unit=el.get("unitRef"),
            decimals=None if dec in (None, "INF") else int(dec), text=el.text or "",
            nil=el.get(XSI_NIL) in ("true", "1"),
        ))
    return facts


def read_numeric_facts(path: Path) -> list[InstanceFact]:
    return [
        InstanceFact(f.concept, f.end, f.instant, f.dims, f.unit, f.decimals, f.amount)
        for f in read_facts(path) if f.amount is not None
    ]
