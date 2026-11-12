"""The same figure reported again within a table (ADR-0013: one cell → one main fact plus "also reported as" facts).
A stage after every table producer: it reads the block (its headers and its empty columns) and the taxonomy (line-item
labels, axis defaults), never codes, and marks a suggestion's rows and columns the way "Map as table" takes them:

- **fair-value twins** (`row.also`): a note that gives one figure per class under "Fair value …" headers (DGPL's
  financial instruments by category) states that the fair value is the carrying amount. A row whose line item has a
  twin "<same label>, at fair value" in the table also reports the twin. Not when a column says "carrying": then the
  two are shown apart.
- **sole-member totals** (`col.alsoTotal`): when the columns repeat the members of an axis (FVTPL, FVOCI, amortised
  cost under each year) and only one of a group has figures, that column is also the total over the axis (its
  default): financial assets at amortised cost are all the company's financial assets of that class.

The app re-plans both with the engine (planTableBlock), which checks every extra fact; the cells' `also` lists here
serve the evaluation and the preview.
"""
from __future__ import annotations

from src.services.tagging.table_catalog import MIN_MATCH, TableAxis, TableCatalog, TableInfo, TableItem, best_member
from src.services.tagging.tables import Block, TableBlockSuggestion, header_words

FAIR_VALUE = frozenset({"fair", "value"})
CARRYING = "carrying"


def add_also(s: TableBlockSuggestion, block: Block, catalog: TableCatalog) -> TableBlockSuggestion:
    t = next((x for x in catalog.tables if x.id == s.table_id), None)
    if t is None:
        return s
    if _states_fair_values(block, s):
        for row in s.rows:
            twins = fair_value_twins(t, row["concept"])
            if twins:
                row["also"] = [{"concept": i.concept, "preferredLabel": i.preferred_label} for i in twins]
    for col in s.cols:
        axes = sole_member_totals(block, t, col)
        if axes:
            col["alsoTotal"] = axes
    _expand_cells(s)
    return s


def _states_fair_values(block: Block, s: TableBlockSuggestion) -> bool:
    """Every column the suggestion maps says "fair value" ("Fair value at amortised cost"), and none of the block's says
    "carrying". A plain "Amortised cost" column is a carrying amount, whatever its empty FVTPL neighbours say."""
    mapped = {c["c"] for c in s.cols}
    words = {c.c: header_words(c.header) for c in block.columns if c.header}
    return bool(mapped) and all(FAIR_VALUE <= words.get(c, frozenset()) for c in mapped) and not any(CARRYING in w for w in words.values())


def fair_value_twins(t: TableInfo, concept: str) -> list[TableItem]:
    """The table's line items labelled as `concept` plus "at fair value" ("Financial assets" → "Financial assets, at fair
    value")."""
    base = [i for i in t.items if i.concept == concept]
    if not base:
        return []
    words = min((i.tokens for i in base), key=len)
    seen: set[str] = set()
    out = []
    for i in t.items:
        if i.concept != concept and i.concept not in seen and i.tokens - words == FAIR_VALUE and words <= i.tokens:
            seen.add(i.concept)
            out.append(i)
    return out


def sole_member_totals(block: Block, t: TableInfo, col: dict) -> list[str]:
    """The axes whose total the column's figures are: it names a member of an axis with a usable default, it is the only
    column of its group (the columns between two repeats of that axis's members) with figures, and the group shows at
    least one other member of the axis (empty)."""
    out = []
    for d in col.get("members") or []:
        axis = next((a for a in t.axes if a.axis == d.get("axis") and not a.typed), None)
        if axis is None or not any(m.is_default and m.usable for m in axis.members):
            continue
        group = _group_of(block, axis, col["c"])
        others = [(c, m) for c, m in group if c != col["c"]]
        has_figures = lambda c: any(r.values.get(c) for r in block.rows)  # noqa: E731
        if others and all(m != d["member"] and not has_figures(c) for c, m in others):
            out.append(axis.axis)
    return out


def _group_of(block: Block, axis: TableAxis, c: int) -> list[tuple[int, str]]:
    """The run of columns around `c` whose headers name members of `axis`, cut where a member repeats."""
    named = []
    for col in block.columns:
        if col.total or not col.header:
            continue
        m, s = best_member(axis, header_words(col.header))
        if m is not None and s >= MIN_MATCH and not m.is_default:
            named.append((col.c, m.member))
    groups: list[list[tuple[int, str]]] = [[]]
    for c_, m in named:
        if any(m == x for _, x in groups[-1]):
            groups.append([])
        groups[-1].append((c_, m))
    return next((g for g in groups if any(x == c for x, _ in g)), [])


def _expand_cells(s: TableBlockSuggestion) -> None:
    """Each cell's extra facts: the row's other line items, and every line item again without the column's total axes."""
    rows = {r["r"]: r for r in s.rows}
    cols = {c["c"]: c for c in s.cols}
    for cell in s.cells:
        row, col = rows.get(cell.r), cols.get(cell.c)
        if row is None or col is None:
            continue
        totals = set(col.get("alsoTotal") or [])
        reduced = [d for d in cell.dims if d["axis"] not in totals]
        items = [(cell.concept, cell.preferred_label), *((a["concept"], a.get("preferredLabel")) for a in row.get("also") or [])]
        also = []
        for i, (concept, label) in enumerate(items):
            if i:
                also.append({"concept": concept, "preferredLabel": label, "dims": cell.dims})
            if totals and reduced:
                also.append({"concept": concept, "preferredLabel": label, "dims": reduced})
        cell.also = also
