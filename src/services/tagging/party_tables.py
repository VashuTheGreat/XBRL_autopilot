"""Party tables (ADR-0013): notes that give figures per counterparty, related-party transactions above all.

    (i) Transactions during the year             Holding Company       Key Management Person
                                                 2025-26   2024-25     2025-26   2024-25
    Purchase including taxes                     3194.12   2995.78        -         -       ← a transaction
      Dixon Technologies (India) Limited         3194.12   2995.78        -         -       ← a party
    Sitting fees                                    -         -           -        0.30
      Mr. Manuji Zarabi                             -         -           -        0.20
      Ms. Poornima Shenoy                           -         -           -        0.10
    (ii) Outstanding balances at the year end                                               ← balances from here
    Trade receivables                             504.49      -           -         -
      Dixon Technologies (India) Limited          504.49      -           -         -

Recognised by its shape, not by its words: a row whose figures are the sum of the rows right below it is a transaction,
and those rows are its parties. The taxonomy table is one with a typed axis (the party) whose other axis's members
name the columns (Parent, Key management personnel …); a transaction's label names the line item (a balance's only
among the instant ones). Each party is numbered 1, 2 … on the typed axis in order of first appearance with a figure,
and reports only under its own category's columns and only where it has a non-zero figure: zeros come from the rules,
and the transaction's own row is a total the parties already give.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from src.services.tagging.table_catalog import MIN_MATCH, TableAxis, TableInfo, TableItem, best_member, similarity, text_tokens
from src.services.tagging.tables import (
    MIN_TABLE_SCORE,
    Block,
    BlockColumn,
    BlockRow,
    TableBlockSuggestion,
    TableContext,
    block_suggestion,
    header_words,
)
from src.services.tagging.text import norm_label

SUM_TOLERANCE = 0.01  # in the sheet's units
# a balance label shares one word with its line item ("Trade receivables" ↔ "Amounts receivable …"); among the instant
# items only, that is enough when no other item scores the same
BALANCE_MATCH = 0.4
_BALANCES = re.compile(r"\b(?:outstanding|balances?|as\s+at|as\s+on|year[\s-]*end)\b", re.I)
_HONORIFIC = re.compile(r"^(?:mr|mrs|ms|miss|dr|shri|smt|m s)\s+")


@dataclass
class PartyGroup:
    transaction: BlockRow
    parties: list[BlockRow]
    balance: bool  # under an "outstanding balances" heading: the line item is an instant


def party_groups(block: Block) -> list[PartyGroup]:
    """A transaction row followed by the contiguous rows that sum to it (its parties), in sheet order."""
    rows = block.rows
    out: list[PartyGroup] = []
    balance = False
    i = 0
    while i < len(rows):
        head = rows[i]
        if not head.values:
            balance = balance or bool(_BALANCES.search(head.text or head.label))
            i += 1
            continue
        run: list[BlockRow] = []
        j = i + 1
        while j < len(rows) and rows[j].values and rows[j].label and rows[j].r == rows[j - 1].r + 1:
            run.append(rows[j])
            j += 1
            if _sums_to(head, run):
                break
        if run and _sums_to(head, run):
            out.append(PartyGroup(head, run, balance))
            i = j
        else:
            i += 1
    return out


def _sums_to(head: BlockRow, run: list[BlockRow]) -> bool:
    cols = set(head.values) | {c for r in run for c in r.values}
    return all(abs(head.values.get(c, 0.0) - sum(r.values.get(c, 0.0) for r in run)) <= SUM_TOLERANCE for c in cols)


def party_key(label: str) -> str:
    """One party however it is written ("Dr. Manuji Zarabi" = "Mr. Manuji Zarabi")."""
    return _HONORIFIC.sub("", norm_label(label))


@dataclass
class _Column:
    col: BlockColumn
    member: str | None  # None: the axis default
    score: float
    scope: str


def _columns(block: Block, axis: TableAxis, ctx: TableContext) -> list[_Column]:
    """The block's columns with a non-zero figure, a known year and a header that names a member of the axis."""
    out = []
    for c in block.columns:
        if c.total or not c.header or not any(r.values.get(c.c) for r in block.rows):
            continue
        scope = ctx.figures.scope_of(block, c.c) or c.scope
        m, s = best_member(axis, header_words(c.header))
        if scope and m is not None and s >= MIN_MATCH:
            out.append(_Column(c, None if m.is_default else m.member, s, scope))
    return out


def _item(t: TableInfo, g: PartyGroup) -> tuple[TableItem, float] | None:
    """The line item a transaction's label names: a balance among the instant items, a transaction among the others."""
    words = text_tokens(g.transaction.label)
    scored = sorted(
        ((similarity(words, t.item_tokens(i)), i) for i in t.items
         if i.preferred_label != "periodStartLabel" and (i.period_type == "instant") == g.balance),
        key=lambda x: -x[0],
    )
    if not scored:
        return None
    best, item = scored[0]
    tied = len(scored) > 1 and scored[1][0] == best
    if best >= MIN_MATCH or (g.balance and best >= BALANCE_MATCH and not tied):
        return item, best
    return None


def party_table(block: Block, ctx: TableContext) -> TableBlockSuggestion | None:
    groups = party_groups(block)
    if len(groups) < 2:
        return None
    best: tuple[float, TableInfo, TableAxis, TableAxis, list[_Column], list] | None = None
    for t in ctx.catalog.tables:
        typed = [a for a in t.axes if a.typed]
        if len(typed) != 1 or not t.items:
            continue
        for axis in (a for a in t.axes if not a.typed):
            cols = _columns(block, axis, ctx)
            items = [_item(t, g) for g in groups]
            named = [x for x in items if x]
            if not cols or not named:
                continue
            col_score = sum(c.score for c in cols) / len(cols)
            row_score = len(named) / len(groups) * sum(s for _, s in named) / len(named)
            score = 0.55 * col_score + 0.45 * row_score
            if best is None or score > best[0]:
                best = (score, t, typed[0], axis, cols, items)
    if best is None or best[0] < MIN_TABLE_SCORE:
        return None
    score, t, party_axis, axis, cols, items = best
    return _assign(block, t, score, party_axis, axis, cols, groups, items)


def _assign(block: Block, t: TableInfo, score: float, party_axis: TableAxis, axis: TableAxis, cols: list[_Column],
            groups: list[PartyGroup], items: list) -> TableBlockSuggestion | None:
    number: dict[str, int] = {}  # party → its typed member, in order of first appearance with a figure
    category: dict[str, str | None] = {}  # party → the member of the columns it reports under
    rows: list[dict] = []
    for g, hit in zip(groups, items, strict=True):
        if hit is None:
            continue
        item, item_score = hit
        for p in g.parties:
            figures = [c for c in cols if p.values.get(c.col.c)]
            if not figures:
                continue
            key = party_key(p.label)
            number.setdefault(key, len(number) + 1)
            own = category.setdefault(key, figures[0].member)
            mine = [c.col.c for c in figures if c.member == own]
            if not mine:
                continue
            rows.append({
                "r": p.r, "concept": item.concept, "preferredLabel": item.preferred_label,
                "members": [{"axis": party_axis.axis, "typed": str(number[key])}], "cols": mine, "_s": item_score,
            })
    cols_json = [{"c": c.col.c, "members": [{"axis": axis.axis, "member": c.member}] if c.member else [], "scope": c.scope} for c in cols]
    col_member = {c.col.c: ({"axis": axis.axis, "member": c.member} if c.member else None, c.score) for c in cols}
    return block_suggestion(block, t, score, rows, cols_json, col_member)
