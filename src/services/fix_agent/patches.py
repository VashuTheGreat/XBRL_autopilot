"""The patch list the agent may return (ADR-0012) and its first, structural check against the bundle.

Ops (v1): setValue, setNil, remap, setScope, removeFact, setText. The engine checks meaning (concept, type,
applicability, arithmetic) in the app before a patch is shown; this module only drops what cannot even be read:
unknown ops, references to facts / cells / elements the bundle or the taxonomy does not have, amounts without a source.

Amounts are never invented: a setValue names its source, one of
- ``cell``: the Excel cell that shows the amount (it must be in the bundle's sources),
- ``identity``: an arithmetic identity over facts of the bundle (Σ weight × fact = value),
- ``user``: the user has to type it (the card asks for it before anything is applied).
``value`` is in the filing's rounding level, as presented (the way a user types it), not in rupees.
"""
from __future__ import annotations

import re
from typing import Annotated, Any, Iterable, Literal, Optional, Union

from pydantic import BaseModel, Field, TypeAdapter, ValidationError, field_validator

from src.services.fix_agent.bundle import MAX_TEXT, CellRef, FixRequest

_DECIMAL = re.compile(r"^-?\d+(\.\d+)?$")


class FactTarget(BaseModel):
    """An existing fact by ``key``, or a new non-dimensional one by concept + year."""

    key: Optional[str] = Field(None, max_length=1000)
    concept: str = Field(max_length=300)
    scope: Literal["CY", "PY"]


class CellSource(BaseModel):
    kind: Literal["cell"]
    cell: CellRef


class Term(BaseModel):
    factKey: str = Field(max_length=1000)
    weight: Literal[1, -1]


class IdentitySource(BaseModel):
    kind: Literal["identity"]
    terms: list[Term] = Field(min_length=1, max_length=60)


class UserSource(BaseModel):
    kind: Literal["user"]


Source = Annotated[Union[CellSource, IdentitySource, UserSource], Field(discriminator="kind")]


# models sometimes answer in words or percent (seen with gpt-oss-120b: "high"): read them rather than drop the patch
_WORDS = {"very high": 0.95, "high": 0.85, "medium": 0.6, "moderate": 0.6, "low": 0.3, "very low": 0.15}


def _confidence(v: Any) -> float:
    if isinstance(v, bool) or v is None:
        return 0.5
    if isinstance(v, (int, float)):
        x = float(v)
    else:
        t = str(v).strip().lower()
        if t in _WORDS:
            return _WORDS[t]
        try:
            x = float(t.rstrip("%"))
            if t.endswith("%"):
                x /= 100
        except ValueError:
            return 0.5
    if x > 1 and x <= 100:
        x /= 100  # 85 → 0.85
    return min(1.0, max(0.0, x))


class _Base(BaseModel):
    rationale: str = Field("", max_length=600)
    confidence: float = Field(0.5, ge=0, le=1)

    @field_validator("confidence", mode="before")
    @classmethod
    def _read_confidence(cls, v: Any) -> float:
        return _confidence(v)

    @field_validator("rationale", mode="before")
    @classmethod
    def _clip_rationale(cls, v: Any) -> str:
        return str(v or "")[:600]


class SetValue(_Base):
    op: Literal["setValue"]
    fact: FactTarget
    value: Optional[str] = Field(None, max_length=40)  # None only with source "user"
    source: Source


class SetNil(_Base):
    op: Literal["setNil"]
    fact: FactTarget


class Remap(_Base):
    op: Literal["remap"]
    cell: CellRef
    to: str = Field(alias="to", max_length=300)
    from_: Optional[str] = Field(None, alias="from", max_length=300)

    model_config = {"populate_by_name": True}


class SetScope(_Base):
    op: Literal["setScope"]
    cell: CellRef
    to: Literal["CY", "PY"]


class RemoveFact(_Base):
    op: Literal["removeFact"]
    fact: FactTarget


class SetText(_Base):
    op: Literal["setText"]
    fact: FactTarget
    value: Optional[str] = Field(None, max_length=MAX_TEXT)
    source: Annotated[Union[CellSource, UserSource], Field(discriminator="kind")]


Patch = Annotated[Union[SetValue, SetNil, Remap, SetScope, RemoveFact, SetText], Field(discriminator="op")]
_PATCH = TypeAdapter(Patch)


def dump(p: BaseModel) -> dict[str, Any]:
    return p.model_dump(by_alias=True, exclude_none=True)


def check_patches(raw: Iterable[Any], bundle: FixRequest, known_concept) -> tuple[list[dict], list[dict]]:
    """Raw patches from the model → (kept, dropped with a reason). ``known_concept(qname)`` asks the taxonomy."""
    facts = {f.key for f in bundle.facts}
    cells = {s.cell.key() for s in bundle.sources} | {f.cell.key() for f in bundle.facts if f.cell}
    # the other value cells of a source row (e.g. the current-year figure next to a previous-year one) count too
    cells |= {f"{s.cell.workbook}|{s.cell.sheet}|{n.ref}" for s in bundle.sources for n in s.neighbours}
    kept: list[dict] = []
    dropped: list[dict] = []
    for item in raw:
        try:
            p = _PATCH.validate_python(item)
        except ValidationError as exc:
            dropped.append({"patch": item if isinstance(item, dict) else {"raw": str(item)[:300]}, "reason": _first_error(exc)})
            continue
        target = getattr(p, "fact", None)
        if isinstance(target, FactTarget) and target.key and target.key not in facts and not isinstance(p, RemoveFact):
            target.key = None  # a made-up id for a new fact (seen live: "f4"): the element and year identify it
        reason = _reference_problem(p, facts, cells, known_concept)
        if reason:
            dropped.append({"patch": dump(p), "reason": reason})
        else:
            kept.append(dump(p))
    return kept, dropped


def _reference_problem(p: BaseModel, facts: set[str], cells: set[str], known_concept) -> str | None:
    target = getattr(p, "fact", None)
    if isinstance(target, FactTarget):
        if not known_concept(target.concept):
            return f"{target.concept} is not an element of this taxonomy"
        if target.key and target.key not in facts:
            return "the fact is not in the bundle"
        if isinstance(p, RemoveFact) and not target.key:
            return "removeFact needs the key of an existing fact"
    if isinstance(p, (Remap, SetScope)) and p.cell.key() not in cells:
        return "the cell is not in the bundle"
    if isinstance(p, Remap) and not known_concept(p.to):
        return f"{p.to} is not an element of this taxonomy"
    source = getattr(p, "source", None)
    if isinstance(source, CellSource) and source.cell.key() not in cells:
        return "the source cell is not in the bundle"
    if isinstance(source, IdentitySource) and any(t.factKey not in facts for t in source.terms):
        return "an identity term is not a fact of the bundle"
    if isinstance(p, SetValue):
        if not isinstance(source, UserSource) and (p.value is None or not _DECIMAL.match(p.value.replace(",", ""))):
            return "setValue needs a plain number"
    if isinstance(p, SetText) and not isinstance(source, UserSource) and not p.value:
        return "setText needs a value"
    return None


def _first_error(exc: ValidationError) -> str:
    e = exc.errors()[0]
    where = ".".join(str(x) for x in e.get("loc", ()))
    return f"invalid patch ({where}: {e.get('msg', 'invalid')})"[:300]
