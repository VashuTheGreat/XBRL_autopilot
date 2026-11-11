"""Table suggestions (ADR-0013): every block of figures in a note sheet is offered to the table producers in turn; the
first that recognises it gives the suggestion. Each producer is a function `(Block, TableContext) → suggestion | None`
in a module of its own, so a new kind of note table is a new producer, not a change to the others.

    sheet ─▶ find_blocks ─▶ sections ─▶ party_table | note_table ─▶ add_also ─▶ TableBlockSuggestion

`add_also` (table_also.py) then marks the figures the table reports twice (a fair value equal to the carrying amount,
the one category with figures as the total).
"""
from __future__ import annotations

import datetime as dt
from collections.abc import Callable, Sequence

from src.services.tagging.party_tables import party_table
from src.services.tagging.table_also import add_also
from src.services.tagging.tables import (
    Block,
    Figures,
    TableBlockSuggestion,
    TableCatalog,
    TableContext,
    find_blocks,
    note_table,
    sections,
)

BlockProducer = Callable[[Block, TableContext], TableBlockSuggestion | None]

# the most specific first: a related-party matrix would otherwise be read as an ordinary note table
PRODUCERS: tuple[BlockProducer, ...] = (party_table, note_table)


def suggest_tables(catalog: TableCatalog, sheets: list[dict], layouts: list, cy_end: dt.date, py_end: dt.date | None,
                   producers: Sequence[BlockProducer] = PRODUCERS) -> list[TableBlockSuggestion]:
    ctx = TableContext(catalog, cy_end, py_end, Figures(layouts))
    out: list[TableBlockSuggestion] = []
    for sheet, layout in zip(sheets, layouts, strict=True):
        if layout.kind == "other":
            continue
        for whole in find_blocks(sheet, cy_end, py_end):
            for block in sections(whole):
                s = next((x for p in producers if (x := p(block, ctx)) is not None), None)
                if s is not None:
                    out.append(add_also(s, block, catalog))
    return out
