"""Filing-state engine: the single source of truth for a filing's facts.

Facts are keyed by (concept, period, dimensions). CURRENT/PRIOR is derived from
the period dates, never from fact order.
"""

from __future__ import annotations
import math
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from . import decimal as Dec
from .periods import period_key, period_for, scope_of, validate_periods, iso_date
from .scaling import scale_power, to_canonical, monetary_decimals, entered_decimals, SCALE_POWERS
from .units import default_unit_for
from .richtext import xml_safe


def norm_dims(dims: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    if not dims:
        return []
    res = []
    for d in dims:
        if d.get("typed") is not None:
            res.append({"axis": d["axis"], "typed": str(d["typed"])})
        else:
            res.append({"axis": d["axis"], "member": d.get("member")})
    res.sort(key=lambda x: x["axis"])
    return res


normDims = norm_dims


def dim_key(dims: Optional[List[Dict[str, Any]]]) -> str:
    nd = norm_dims(dims)
    parts = []
    for d in nd:
        if d.get("member"):
            parts.append(f"{d['axis']}={d['member']}")
        else:
            parts.append(f'{d["axis"]}="{d.get("typed", "")}"')
    return "|".join(parts)


dimKey = dim_key


def fact_key(concept: str, period: Dict[str, Any], dims: Optional[List[Dict[str, Any]]]) -> str:
    return f"{concept}#{period_key(period)}#{dim_key(dims)}"


factKey = fact_key


class FactValueError(ValueError):
    pass


def default_meta() -> Dict[str, Any]:
    return {
        "name": "Untitled filing",
        "cin": "",
        "reportType": "Standalone",
        "firstFinancialYear": False,
        "periods": {"cy": {"start": "", "end": ""}, "py": {"start": "", "end": ""}},
        "level": "Actual",
        "displayPlaces": 0,
        "statementPlaces": None,
        "currency": "INR",
        "schemaRef": None,
        "textEmphasis": "headings",
        "pyLocked": False,
    }


defaultMeta = default_meta


def places_message(display: Any, typed: int, level: str, places: int) -> str:
    pow10 = SCALE_POWERS.get(level, 0)
    exact = " (2 places = paise)" if level == "Actual" else f" ({pow10} places = exact rupees, {pow10 + 2} = paise)"
    unit = "rupees" if level == "Actual" else level
    return (
        f"'{str(display).strip()}' has {typed} decimal place{'s' if typed != 1 else ''}; "
        f"this filing takes amounts in {unit} with up to {places}. Nothing was rounded or saved. "
        f'To keep every digit, increase "Decimal places as presented" on the company page{exact}.'
    )


placesMessage = places_message


class Fact:
    def __init__(
        self,
        key: str,
        concept: str,
        period: Dict[str, Any],
        dims: List[Dict[str, Any]],
        value: Optional[str] = None,
        nil: bool = False,
        decimals: Optional[str] = None,
        unit: Optional[str] = None,
        lang: Optional[str] = None,
        origin: str = "user",
        source: Optional[Dict[str, Any]] = None,
        source_id: Optional[str] = None,
    ):
        self.key = key
        self.concept = concept
        self.period = dict(period)
        self.dims = norm_dims(dims)
        self.value = value
        self.nil = bool(nil)
        self.decimals = decimals
        self.unit = unit
        self.lang = lang
        self.origin = origin
        self.source = source
        self.source_id = source_id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "concept": self.concept,
            "period": self.period,
            "dims": self.dims,
            "value": self.value,
            "nil": self.nil,
            "decimals": self.decimals,
            "unit": self.unit,
            "lang": self.lang,
            "origin": self.origin,
            "source": self.source,
            "sourceId": self.source_id,
        }


class Footnote:
    def __init__(self, fn_id: str, text: str, fact_keys: Optional[Set[str]] = None, lang: str = "en"):
        self.id = fn_id
        self.text = text
        self.fact_keys = set(fact_keys or set())
        self.lang = lang

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "text": self.text,
            "lang": self.lang,
            "factKeys": sorted(self.fact_keys),
        }


class Filing:
    def __init__(self, authority: Any, meta: Optional[Dict[str, Any]] = None):
        self.A = authority
        init_meta = default_meta()
        if meta:
            init_meta.update(meta)
            if "periods" in meta:
                init_meta["periods"] = dict(default_meta()["periods"])
                init_meta["periods"].update(meta["periods"] or {})
        self.meta = init_meta
        self.facts: Dict[str, Fact] = {}
        self.footnotes: Dict[str, Footnote] = {}
        self.import_report: Optional[Dict[str, Any]] = None
        self.set_aside: List[Dict[str, Any]] = []
        self.filed_reference: Optional[Dict[str, Any]] = None
        self.revision = 0

    @property
    def importReport(self) -> Optional[Dict[str, Any]]:
        return self.import_report

    @importReport.setter
    def importReport(self, val: Optional[Dict[str, Any]]):
        self.import_report = val

    @property
    def setAside(self) -> List[Dict[str, Any]]:
        return self.set_aside

    @setAside.setter
    def setAside(self, val: List[Dict[str, Any]]):
        self.set_aside = val

    @property
    def filedReference(self) -> Optional[Dict[str, Any]]:
        return self.filed_reference

    @filedReference.setter
    def filedReference(self, val: Optional[Dict[str, Any]]):
        self.filed_reference = val

    def periods_valid(self) -> bool:
        return len(validate_periods(self.meta.get("periods", {}))) == 0

    periodsValid = periods_valid

    def period(self, concept: str, scope: str) -> Optional[Dict[str, Any]]:
        c = self.A.concept(concept)
        if not c:
            return None
        return period_for(self.meta.get("periods", {}), c.get("periodType", "instant"), scope)

    def scope_of(self, period: Optional[Dict[str, Any]]) -> Optional[str]:
        return scope_of(self.meta.get("periods", {}), period)

    scopeOf = scope_of

    def canonical_value(self, concept: str, raw: Any) -> Optional[str]:
        if raw is None:
            raise FactValueError("Empty value")
        s = str(raw).strip()
        t = self.A.data_type(concept)
        if self.A.is_numeric(concept):
            clean = s.replace(",", "")
            if not Dec.is_decimal_string(clean):
                raise FactValueError(f"'{s}' is not a number")
            return Dec.to_string(Dec.parse(clean))

        if t == "boolean":
            if s.lower() in ("true", "yes"):
                return "true"
            if s.lower() in ("false", "no"):
                return "false"
            raise FactValueError(f"'{s}' is not true/false")

        if t == "date":
            if not iso_date(s):
                raise FactValueError(f"'{s}' is not a yyyy-mm-dd date")
            return s

        if t == "enum":
            enums = self.A.enumerations(concept) or []
            if s not in enums:
                raise FactValueError(f"'{s}' is not one of: {', '.join(enums)}")
            return s

        return xml_safe(str(raw))

    canonicalValue = canonical_value

    def set_fact(
        self,
        concept: Any,
        period: Optional[Dict[str, Any]] = None,
        dims: Optional[List[Dict[str, Any]]] = None,
        value: Optional[Any] = None,
        nil: bool = False,
        decimals: Optional[str] = None,
        unit: Optional[str] = None,
        lang: Optional[str] = None,
        origin: str = "user",
        source: Optional[Dict[str, Any]] = None,
        fact_id: Optional[str] = None,
    ) -> Fact:
        if isinstance(concept, dict):
            d = concept
            concept = d.get("concept")
            period = d.get("period")
            dims = d.get("dims")
            value = d.get("value")
            nil = d.get("nil", False)
            decimals = d.get("decimals")
            unit = d.get("unit")
            lang = d.get("lang")
            origin = d.get("origin", "user")
            source = d.get("source")
            fact_id = d.get("sourceId") or d.get("source_id") or d.get("fact_id")
        elif hasattr(concept, "concept") and hasattr(concept, "period"):
            f_obj = concept
            concept = f_obj.concept
            period = f_obj.period
            dims = f_obj.dims
            value = f_obj.value if value is None else value
            nil = f_obj.nil if nil is False else nil
            decimals = f_obj.decimals if decimals is None else decimals
            unit = f_obj.unit if unit is None else unit
            lang = f_obj.lang if lang is None else lang
            origin = origin or f_obj.origin
            source = source or f_obj.source
            fact_id = fact_id or f_obj.source_id

        if not period:
            raise FactValueError(f"Period required for concept {concept}")
        c = self.A.concept(concept)
        if not c:
            raise FactValueError(f"Unknown concept {concept}")
        if not self.A.is_reportable(concept):
            raise FactValueError(f"{concept} is not a reportable item")

        p_type = c.get("periodType")
        if p_type == "instant" and period.get("type") != "instant":
            raise FactValueError(f"{concept} requires an instant period")
        if p_type == "duration" and period.get("type") != "duration":
            raise FactValueError(f"{concept} requires a duration period")

        nd = norm_dims(dims)
        key = fact_key(concept, period, nd)
        is_num = self.A.is_numeric(concept)
        canonical = None if nil else self.canonical_value(concept, value)
        prev = self.facts.get(key)

        fact = Fact(
            key=key,
            concept=concept,
            period=period,
            dims=nd,
            value=canonical,
            nil=bool(nil),
            decimals=decimals if is_num and not nil else None,
            unit=unit or (default_unit_for(self.A.data_type(concept), self.meta.get("currency", "INR")) if is_num else None),
            lang=None if is_num or not self.A.lang_allowed(concept) else (lang or None),
            origin=origin,
            source=source or (prev.source if prev else None),
            source_id=fact_id or (prev.source_id if prev else None),
        )

        if is_num and not nil and fact.decimals is None:
            fact.decimals = str(self.default_decimals(concept, canonical or "0"))

        self.facts[key] = fact
        self.revision += 1
        return fact

    setFact = set_fact

    def statement_decimals(self, concept: str) -> Optional[int]:
        if self.A.data_type(concept) == "monetary":
            return self.default_decimals(concept, "0")
        return None

    statementDecimals = statement_decimals

    def default_decimals(self, concept: str, canonical: str) -> int:
        if self.A.data_type(concept) == "monetary":
            dp = self.meta.get("displayPlaces", 0)
            sp = self.meta.get("statementPlaces")
            places = min(sp if sp is not None else dp, dp)
            d = monetary_decimals(self.meta.get("level", "Actual"), places)
            req = Dec.required_decimals(Dec.parse(canonical))
            if req == float("inf") or req <= d:
                return min(2, d)
            return min(2, max(monetary_decimals(self.meta.get("level", "Actual"), dp), int(req)))
        return entered_decimals(canonical)

    defaultDecimals = default_decimals

    def typed_decimals(self, typed: int, canonical: str) -> int:
        dp = self.meta.get("displayPlaces", 0)
        sp = self.meta.get("statementPlaces")
        sp_val = min(sp if sp is not None else dp, dp)
        places = min(dp, max(sp_val, typed))
        req = Dec.required_decimals(Dec.parse(canonical))
        d = monetary_decimals(self.meta.get("level", "Actual"), places)
        return min(2, d if req == float("inf") else max(d, int(req)))

    typedDecimals = typed_decimals

    def set_display_value(
        self,
        concept: str,
        period: Dict[str, Any],
        display: Optional[Any],
        dims: Optional[List[Dict[str, Any]]] = None,
        origin: str = "user",
        strict: bool = False,
    ) -> Optional[Fact]:
        nd = norm_dims(dims)
        key = fact_key(concept, period, nd)
        if display is None or str(display).strip() == "":
            self.remove_fact(key)
            return None

        prev = self.facts.get(key)
        t = self.A.data_type(concept)

        if t == "monetary":
            raw = str(display).strip().replace(",", "")
            if not Dec.is_decimal_string(raw):
                raise FactValueError(f"'{display}' is not a number")

            m = re.search(r"\.(\d*)$", raw)
            typed = len(m.group(1)) if m else 0
            dp = int(self.meta.get("displayPlaces", 0) or 0)

            if strict and typed > dp and not Dec.eq(Dec.round_dec(Dec.parse(raw), dp), Dec.parse(raw)):
                req_dec = max(0, int(Dec.required_decimals(Dec.parse(raw))))
                raise FactValueError(places_message(display, req_dec, self.meta.get("level", "Actual"), dp))

            rounded = Dec.to_string(Dec.round_dec(Dec.parse(raw), dp))
            canonical = to_canonical(rounded, self.meta.get("level", "Actual"))
            decimals = str(self.typed_decimals(min(typed, dp), canonical))

            sp = self.meta.get("statementPlaces")
            sp_val = min(sp if sp is not None else dp, dp)
            finer = typed > sp_val and prev is not None and prev.decimals not in (None, "INF") and int(decimals) > int(prev.decimals)

            if prev is not None and prev.decimals is not None and prev.origin != "user" and not finer:
                if Dec.eq(Dec.round_dec(Dec.parse(canonical), prev.decimals), Dec.parse(canonical)):
                    decimals = prev.decimals

            fact_origin = "user" if (prev and prev.origin == "user") else ("edited" if prev else origin)
            return self.set_fact(
                concept=concept,
                period=period,
                dims=nd,
                value=canonical,
                decimals=decimals,
                origin=fact_origin,
                unit=prev.unit if prev else None,
            )

        canonical = self.canonical_value(concept, display)
        decimals_val = None
        if self.A.is_numeric(concept):
            decimals_val = str(entered_decimals(canonical))
            if prev is not None and prev.decimals is not None and prev.origin != "user":
                if Dec.eq(Dec.round_dec(Dec.parse(canonical), prev.decimals), Dec.parse(canonical)):
                    decimals_val = prev.decimals

        fact_origin = "user" if (prev and prev.origin == "user") else ("edited" if prev else origin)
        fact_lang = prev.lang if prev else (None if self.A.is_numeric(concept) else "en")
        return self.set_fact(
            concept=concept,
            period=period,
            dims=nd,
            value=canonical,
            decimals=decimals_val,
            origin=fact_origin,
            unit=prev.unit if prev else None,
            lang=fact_lang,
        )

    setDisplayValue = set_display_value

    def remove_fact(self, key: str) -> bool:
        if key in self.facts:
            del self.facts[key]
            self.revision += 1
            for fn in self.footnotes.values():
                fn.fact_keys.discard(key)
            return True
        return False

    removeFact = remove_fact

    def get(self, concept: str, period: Dict[str, Any], dims: Optional[List[Dict[str, Any]]] = None) -> Optional[Fact]:
        return self.facts.get(fact_key(concept, period, dims or []))

    def all(self) -> List[Fact]:
        return list(self.facts.values())

    def facts_of(self, concept: str) -> List[Fact]:
        return [f for f in self.facts.values() if f.concept == concept]

    factsOf = facts_of

    def in_scope(self, scope: str) -> List[Fact]:
        return [f for f in self.facts.values() if self.scope_of(f.period) == scope]

    inScope = in_scope

    def value(self, concept: str, scope: str, dims: Optional[List[Dict[str, Any]]] = None) -> Optional[str]:
        p = self.period(concept, scope)
        if not p:
            return None
        f = self.get(concept, p, dims or [])
        return f.value if f and not f.nil else None

    def add_footnote(self, text: str, fact_keys: Optional[List[str]] = None, lang: str = "en") -> str:
        n = len(self.footnotes) + 1
        while f"fn{n}" in self.footnotes:
            n += 1
        fn_id = f"fn{n}"
        self.footnotes[fn_id] = Footnote(fn_id, text, set(fact_keys or []), lang)
        self.revision += 1
        return fn_id

    addFootnote = add_footnote

    def to_json(self) -> Dict[str, Any]:
        return {
            "format": "mca-ci-xbrl-project",
            "version": 1,
            "authorityHash": self.A.meta.get("authorityHash"),
            "meta": dict(self.meta),
            "facts": [
                {
                    "concept": f.concept,
                    "period": f.period,
                    "dims": f.dims,
                    "value": f.value,
                    "nil": f.nil,
                    "decimals": f.decimals,
                    "unit": f.unit,
                    "lang": f.lang,
                    "origin": f.origin,
                    "source": f.source,
                    "sourceId": f.source_id,
                }
                for f in self.all()
            ],
            "footnotes": [fn.to_dict() for fn in self.footnotes.values()],
            "importReport": self.import_report,
            "setAside": self.set_aside,
            "filedReference": self.filed_reference,
        }

    toJSON = to_json

    @classmethod
    def from_json(cls, authority: Any, data: Dict[str, Any]) -> Filing:
        if data.get("format") != "mca-ci-xbrl-project":
            raise ValueError("Not an MCA C&I XBRL project file")
        f = cls(authority, data.get("meta", {}))
        for x in data.get("facts", []):
            f.set_fact(
                concept=x["concept"],
                period=x["period"],
                dims=x.get("dims", []),
                value=x.get("value"),
                nil=x.get("nil", False),
                decimals=x.get("decimals"),
                unit=x.get("unit"),
                lang=x.get("lang"),
                origin=x.get("origin", "user"),
                source=x.get("source"),
                fact_id=x.get("sourceId"),
            )
        for fn in data.get("footnotes", []):
            f.footnotes[fn["id"]] = Footnote(
                fn_id=fn["id"],
                text=fn.get("text", ""),
                fact_keys=set(fn.get("factKeys", [])),
                lang=fn.get("lang", "en"),
            )
        f.import_report = data.get("importReport")
        f.set_aside = data.get("setAside", [])
        f.filed_reference = data.get("filedReference")
        return f

    fromJSON = from_json
