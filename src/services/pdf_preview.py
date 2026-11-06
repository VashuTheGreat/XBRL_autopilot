"""Preview of the instance as a printable document.

Display only: reads the facts the XML would contain through session APIs.
"""

from __future__ import annotations
import math
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from src.core import decimal as Dec
from src.core.scaling import to_display
from src.core.views import table_slices
from src.core.periods import reporting_year
from src.core.richtext import to_mca, plain_text
from .member_hints import sort_slices

LEVEL_TEXT = {
    "Actual": "INR",
    "Thousands": "Thousands of INR",
    "Lakhs": "Lakhs of INR",
    "Millions": "Millions of INR",
    "Crores": "Crores of INR",
    "Billions": "Billions of INR",
}
MAX_COLS = 4


def esc(s: Any) -> str:
    return (
        str(s if s is not None else "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def dmy(iso: Optional[str]) -> str:
    s = str(iso or "")
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return f"{s[8:10]}/{s[5:7]}/{s[0:4]}"
    return s


def group_in(s: Any) -> str:
    m = re.match(r"^(-?)(\d+)(\.\d+)?$", str(s))
    if not m:
        return str(s)
    sign = m.group(1)
    int_part = m.group(2)
    frac = m.group(3) or ""
    if len(int_part) > 3:
        last3 = int_part[-3:]
        rest = int_part[:-3]
        parts = []
        while len(rest) > 2:
            parts.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            parts.insert(0, rest)
        int_part = ",".join(parts) + "," + last3
    return sign + int_part + frac


groupIN = group_in


def format_value(S: Any, f: Any) -> str:
    if not f or f.nil:
        return ""
    A = S.A
    dt = A.data_type(f.concept)
    if dt == "monetary":
        return group_in(to_display(f.value, S.filing.meta.get("level", "Actual")))
    if dt == "shares":
        return f"[shares] {group_in(f.value)}"
    if dt == "perShare":
        return f"[INR/shares] {group_in(f.value)}"
    if dt == "percent":
        return f"{Dec.to_fixed(Dec.shift(Dec.parse(f.value), 2), 2)}%"
    if dt in ("decimal", "pure"):
        return group_in(f.value)
    if dt == "boolean":
        return "Yes" if str(f.value).lower() == "true" else "No"
    if dt == "date":
        return dmy(f.value)
    return str(f.value)


formatValue = format_value


def build_preview_html(S: Any, opts: Optional[Dict[str, Any]] = None) -> str:
    opts = opts or {}
    build = opts.get("build", "dev")
    A = S.A
    filing = S.filing
    m = filing.meta
    P = m.get("periods", {})
    emit = {f.key for f in S.app.plan_facts(filing)["emit"]}

    def get(q: str, scope: str, dims: Optional[List[Dict[str, Any]]] = None, pl: Optional[str] = None):
        f = S.get_value(q, scope, dims or [], pl)
        return f if (f and not f.nil and f.key in emit) else None

    name_q = A.qname_of_local("NameOfCompany")
    company_fact = S.get_value(name_q, "CY") if name_q else None
    company = company_fact.value if (company_fact and not company_fact.nil) else (m.get("name") or "")
    cy_p = P.get("cy", {})
    py_p = P.get("py", {})
    title = f"{m.get('reportType')} Financial Statements for period {dmy(cy_p.get('start'))} to {dmy(cy_p.get('end'))}"
    unit_line = f"Unless otherwise specified, all monetary values are in {LEVEL_TEXT.get(m.get('level'), m.get('level'))}"

    def period_head(scope: str, duration: bool) -> str:
        p = cy_p if scope == "CY" else py_p
        return f"{dmy(p.get('start'))}<br>to<br>{dmy(p.get('end'))}" if duration else dmy(p.get("end"))

    ti_count = 0
    fn_by: Dict[str, List[Any]] = {}
    for fn in filing.footnotes.values():
        if fn.text and fn.text.strip():
            for k in fn.fact_keys:
                fn_by.setdefault(k, []).append(fn)

    def fn_text(t: str) -> str:
        return plain_text(t) if re.search(r"<\s*[a-zA-Z]", t) else str(t).strip()

    rich_re = re.compile(r"<\s*(p|div|ul|ol|li|table|h[1-6]|br)\b|class=\"(highlightedText|header|noteText)", re.IGNORECASE)

    def fn_body(t: str) -> str:
        if rich_re.search(str(t)):
            return f'<div class="mca fnrich">{to_mca(t)}</div>'
        return esc(fn_text(t)).replace("\n", "<br>")

    class FootnoteBuilder:
        def __init__(self):
            self.letters: Dict[str, str] = {}
            self.order: List[Any] = []

    fb: Optional[FootnoteBuilder] = None

    def letter(i: int) -> str:
        x = ""
        idx = i + 1
        while idx > 0:
            x = chr(65 + ((idx - 1) % 26)) + x
            idx = (idx - 1) // 26
        return x

    def marks(f: Any) -> str:
        if not f or not fb:
            return ""
        list_fns = fn_by.get(f.key, [])
        if not list_fns:
            return ""
        out_marks = []
        for fn in list_fns:
            if fn.id not in fb.letters:
                fb.letters[fn.id] = letter(len(fb.order))
                fb.order.append(fn)
            out_marks.append(f"({fb.letters[fn.id]}) ")
        return "".join(out_marks)

    def with_fn(render_fn: Any) -> str:
        nonlocal fb
        fb = FootnoteBuilder()
        html = render_fn()
        fn_list_str = ""
        if fb.order:
            fn_items = "".join(f"<div>({fb.letters[fn.id]}) {fn_body(fn.text)}</div>" for fn in fb.order)
            fn_list_str = f'<div class="fns"><div class="fnh">Footnotes</div>{fn_items}</div>'
        fb = None
        return html + fn_list_str

    def cell(f: Any, texts: List[Dict[str, Any]], lbl: str) -> str:
        if not f:
            return ""
        mk = marks(f)
        if A.data_type(f.concept) == "textBlock":
            nonlocal ti_count
            ti_count += 1
            texts.append({"n": ti_count, "label": lbl, "html": to_mca(f.value)})
            return f"{mk}Textual information ({ti_count})"
        v = format_value(S, f)
        return mk + esc(v).replace("\n", "<br>")

    def prune(rows: List[Dict[str, Any]], has_val_fn: Any) -> List[Dict[str, Any]]:
        keep = [not r.get("abstract") and has_val_fn(r) for r in rows]
        for i in range(len(rows) - 1, -1, -1):
            if rows[i].get("abstract"):
                for j in range(i + 1, len(rows)):
                    if rows[j].get("depth", 0) > rows[i].get("depth", 0) and keep[j]:
                        keep[i] = True
                        break
        return [r for i, r in enumerate(rows) if keep[i]]

    sections = []
    for e in A.elrs:
        if not S.elr_status(e["uri"], "CY").get("applicable") and not S.elr_status(e["uri"], "PY").get("applicable"):
            continue
        view = S.elr_view(e["uri"])
        texts: List[Dict[str, Any]] = []
        blocks: List[str] = []

        items = [dict(r, abstract=r.get("kind") == "header") for r in view.get("rows", []) if r.get("kind") != "table"]
        vals = lambda r, s: None if r.get("abstract") else get(r["concept"], s, [], r.get("preferredLabel"))
        shown = prune(items, lambda r: vals(r, "CY") or vals(r, "PY"))
        if shown:
            scopes = [s for s in ("CY", "PY") if any(vals(r, s) for r in shown)]
            duration = any(not r.get("abstract") and A.concept(r["concept"]).get("periodType") == "duration" for r in shown)

            def render_st():
                heads = "".join(f"<th>{period_head(s, duration)}</th>" for s in scopes)
                body_rows = []
                for r in shown:
                    cls_str = ' class="ab"' if r.get("abstract") else ""
                    pl = 4 + r.get("depth", 0) * 8
                    v_cells = "".join(f'<td class="v">{"" if r.get("abstract") else cell(vals(r, s), texts, r.get("label", ""))}</td>' for s in scopes)
                    body_rows.append(f'<tr{cls_str}><td class="lb" style="padding-left:{pl}px">{esc(r.get("label"))}</td>{v_cells}</tr>')
                return f'<table class="st"><thead><tr><th class="lb"></th>{heads}</tr></thead><tbody>{"".join(body_rows)}</tbody></table>'

            blocks.append(with_fn(render_st))

        for r in [x for x in view.get("rows", []) if x.get("kind") == "table"]:
            t = A.table(r["tableId"])
            tv = S.table_view(r["tableId"])
            lines = [dict(l, abstract=bool(l.get("abstract"))) for l in tv.get("lineItems", [])]
            if not t.get("axes"):
                v2 = lambda l, s: None if l.get("abstract") else get(l["concept"], s, [], l.get("preferredLabel"))
                sh = prune(lines, lambda l: v2(l, "CY") or v2(l, "PY"))
                if not sh or all(l.get("abstract") or not (v2(l, "CY") or v2(l, "PY")) or any(u != e["uri"] for u in A.concept_elrs(l["concept"])) for l in sh):
                    continue
                scopes = [s for s in ("CY", "PY") if any(v2(l, s) for l in sh)]
                duration = any(not l.get("abstract") and A.concept(l["concept"]).get("periodType") == "duration" for l in sh)

                def render_totals():
                    heads = "".join(f"<th>{period_head(s, duration)}</th>" for s in scopes)
                    body_rows = []
                    for l in sh:
                        cls_str = ' class="ab"' if l.get("abstract") else ""
                        pl = 4 + l.get("depth", 0) * 8
                        v_cells = "".join(f'<td class="v">{"" if l.get("abstract") else cell(v2(l, s), texts, l.get("label", ""))}</td>' for s in scopes)
                        body_rows.append(f'<tr{cls_str}><td class="lb" style="padding-left:{pl}px">{esc(l.get("label"))}</td>{v_cells}</tr>')
                    return f'<h3>{esc(r.get("label"))}</h3><table class="st"><thead><tr><th class="lb"></th>{heads}</tr></thead><tbody>{"".join(body_rows)}</tbody></table>'

                blocks.append(with_fn(render_totals))
                continue

            all_slices_map: Dict[str, List[Dict[str, Any]]] = {}
            for s in ("CY", "PY"):
                for d in table_slices(A, filing, r["tableId"], s, reporting_year):
                    all_slices_map[str(d)] = d
            slices = sort_slices(A, r["tableId"], list(all_slices_map.values()))
            cols = []
            for d in slices:
                for s in ("CY", "PY"):
                    if any(not l.get("abstract") and get(l["concept"], s, d, l.get("preferredLabel")) for l in lines):
                        cols.append({"d": d, "s": s})
            if not cols:
                continue

            duration = any(not l.get("abstract") and A.concept(l["concept"]).get("periodType") == "duration" for l in lines)
            groups: List[List[Dict[str, Any]]] = []
            for c in cols:
                g = groups[-1] if groups else None
                same_slice = g and g[-1]["d"] == c["d"]
                if g and (len(g) < MAX_COLS or same_slice):
                    g.append(c)
                else:
                    groups.append([c])

            for gi, g in enumerate(groups):
                v3 = lambda l, c: None if l.get("abstract") else get(l["concept"], c["s"], c["d"], l.get("preferredLabel"))
                sh = prune(lines, lambda l: any(v3(l, c) for c in g))
                if not sh:
                    continue
                spans: List[Dict[str, Any]] = []
                for c in g:
                    last_span = spans[-1] if spans else None
                    if last_span and last_span["d"] == c["d"]:
                        last_span["n"] += 1
                    else:
                        spans.append({"d": c["d"], "n": 1})

                def member_name(ax: Dict[str, Any], d: List[Dict[str, Any]]) -> str:
                    x = next((y for y in d if y.get("axis") == ax["axis"]), None)
                    if x:
                        return A.label(x["member"]) if x.get("member") else str(x.get("typed", ""))
                    def_mem = A.dimension_default(ax["axis"])
                    return A.label(def_mem) if def_mem else ""

                axis_row_list = []
                for ax in t.get("axes", []):
                    th_cells = []
                    for sp in spans:
                        th_cells.append(f'<th colspan="{sp["n"]}">{esc(member_name(ax, sp["d"]))}</th>')
                    axis_row_list.append(f'<tr class="ax"><th class="lb">{esc(A.label(ax["axis"]))}</th>{"".join(th_cells)}</tr>')
                axis_rows = "".join(axis_row_list)

                def render_dim():
                    col_heads = "".join(f"<th>{period_head(c['s'], duration)}</th>" for c in g)
                    body_rows = []
                    for l in sh:
                        cls_str = ' class="ab"' if l.get("abstract") else ""
                        pl = 4 + l.get("depth", 0) * 8
                        v_cells = "".join(f'<td class="v">{"" if l.get("abstract") else cell(v3(l, c), texts, l.get("label", ""))}</td>' for c in g)
                        body_rows.append(f'<tr{cls_str}><td class="lb" style="padding-left:{pl}px">{esc(l.get("label"))}</td>{v_cells}</tr>')
                    return (
                        f'<div class="tblhead"><span>{esc(A.label(t.get("hypercube")))}</span><span>..({gi + 1})</span></div>'
                        f'<div class="unit">{esc(unit_line)}</div>'
                        f'<table class="st dim"><thead>{axis_rows}<tr><th class="lb"></th>{col_heads}</tr></thead><tbody>{"".join(body_rows)}</tbody></table>'
                    )

                blocks.append(with_fn(render_dim))

        if not blocks:
            continue
        ti_blocks = "".join(
            f'<div class="ti"><div class="tih">Textual information ({x["n"]})</div><div class="til">{esc(x["label"])}</div><div class="mca">{x["html"]}</div></div>'
            for x in texts
        )
        sections.append(
            f'<section class="elr"><h2>[{esc(e.get("code"))}] {esc(e.get("title"))}</h2><div class="unit">{esc(unit_line)}</div>{"".join(blocks)}{ti_blocks}</section>'
        )

    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{esc(company)} — preview</title>
<style>
@page {{ size: A4; margin: 14mm 10mm 16mm; }}
body {{ font: 10px/1.35 Arial, Helvetica, sans-serif; color: #000; background: #fff; margin: 0 auto; max-width: 900px; padding: 10px; }}
h2 {{ text-align: center; font-size: 11.5px; margin: 10px 0 2px; }}
h3 {{ font-size: 10.5px; margin: 10px 0 2px; }}
.unit {{ text-align: right; font-size: 9px; margin: 2px 0 4px; }}
.tblhead {{ display: flex; justify-content: space-between; font-weight: bold; margin-top: 12px; }}
table.st {{ width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 6px; }}
table.st th, table.st td {{ padding: 1px 4px; vertical-align: top; overflow-wrap: anywhere; }}
table.st th.lb, table.st td.lb {{ text-align: left; width: 46%; }}
table.st td.v {{ text-align: right; }}
.fns {{ margin: 2px 0 10px 4px; }}
.ti {{ break-before: page; }}
.mca {{ font: 9pt/1.12 "Times New Roman", Times, serif; }}
.mca table {{ border-collapse: separate; border-spacing: 2pt; width: 100%; }}
.mca td, .mca th {{ padding: 1pt 5pt; font: 9pt/1.25 Helvetica, Arial, sans-serif; }}
.mca .bordered {{ border: 1px solid #888; }}
</style></head><body>
<div class="doc-head"><b>{esc(company)}</b><span>{esc(title)}</span></div>
{''.join(sections)}
</body></html>"""


buildPreviewHtml = build_preview_html
