"""The single authoritative XBRL instance generator.

Deterministic output: contexts, units, and facts are emitted in a stable order with stable ids.
No precision, no scale, no extensions; prescribed schemaRef and CIN scheme from the authority.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Set, Tuple
from src.core.units import unit_def
from src.core.periods import scope_of

NS = {
    "xbrli": "http://www.xbrl.org/2003/instance",
    "link": "http://www.xbrl.org/2003/linkbase",
    "xlink": "http://www.w3.org/1999/xlink",
    "xbrldi": "http://xbrl.org/2006/xbrldi",
    "iso4217": "http://www.xbrl.org/2003/iso4217",
    "xsi": "http://www.w3.org/2001/XMLSchema-instance",
}


def esc(s: Any) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def fnv(s: str) -> str:
    h = 0x811C9DC5
    for ch in s:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


_ORDER_CACHE: Dict[int, Dict[str, int]] = {}


def concept_order(A: Any) -> Dict[str, int]:
    a_id = id(A)
    if a_id in _ORDER_CACHE:
        return _ORDER_CACHE[a_id]
    order_map: Dict[str, int] = {}
    i = 0

    def walk(q: str):
        nonlocal i
        if q not in order_map:
            order_map[q] = i
            i += 1
        for a in A.presentation_children(elr_uri, q):
            walk(a["to"])

    for e in A.elrs:
        elr_uri = e["uri"]
        for r in e.get("roots", []):
            walk(r)

    _ORDER_CACHE[a_id] = order_map
    return order_map


def period_base_id(periods: Dict[str, Any], p: Dict[str, Any]) -> str:
    s = scope_of(periods, p)
    p_type = p.get("type")
    if p_type == "duration":
        end_val = p.get("end", "")
        if s in ("CY", "PY"):
            return f"D{end_val[:4]}"
        start_clean = p.get("start", "").replace("-", "")
        end_clean = end_val.replace("-", "")
        return f"D{start_clean}_{end_clean}"

    date_val = p.get("date", "")
    if s in ("CY", "PY", "PYO"):
        return f"I{date_val[:4]}"
    return f"I{date_val.replace('-', '')}"


def build_contexts(filing: Any, facts: List[Any]) -> Tuple[Dict[str, Dict[str, Any]], Any]:
    context_map: Dict[str, Dict[str, Any]] = {}
    used: Set[str] = set()

    def key_of(f: Any) -> str:
        p = f.period
        if p.get("type") == "instant":
            per_str = f"I:{p.get('date', '')}"
        else:
            per_str = f"D:{p.get('start', '')}:{p.get('end', '')}"
        parts = []
        for d in f.dims:
            m_val = d.get("member")
            if not m_val:
                t_val = d.get("typed", "")
                m_val = f'"{t_val}"'
            parts.append(f"{d['axis']}={m_val}")
        dims_str = "|".join(parts)
        return f"{per_str}#{dims_str}"

    unique_facts: Dict[str, Any] = {}
    for f in facts:
        k = key_of(f)
        if k not in unique_facts:
            unique_facts[k] = f

    sorted_entries = sorted(unique_facts.items(), key=lambda x: x[0])

    p_dict = filing.meta.get("periods", {})
    for k, f in sorted_entries:
        base_id = period_base_id(p_dict, f.period)
        if f.dims:
            dim_parts = []
            for d in f.dims:
                m_val = d.get("member")
                if not m_val:
                    t_val = d.get("typed", "")
                    m_val = f'"{t_val}"'
                dim_parts.append(f"{d['axis']}={m_val}")
            dims_str = "|".join(dim_parts)
            base_id += f"_{fnv(dims_str)}"

        final_id = base_id
        n = 2
        while final_id in used:
            final_id = f"{base_id}_{n}"
            n += 1
        used.add(final_id)
        context_map[k] = {"id": final_id, "period": f.period, "dims": f.dims}

    return context_map, key_of


SCOPE_RANK = {"CY": 0, "PY": 1, "PYO": 2}


def scope_rank(periods: Dict[str, Any], p: Dict[str, Any]) -> int:
    return SCOPE_RANK.get(scope_of(periods, p) or "", 3)


def generate_instance(A: Any, filing: Any, facts: Optional[List[Any]] = None) -> Dict[str, Any]:
    if facts is None:
        facts = filing.all()

    order = concept_order(A)
    ctx_map, key_of = build_contexts(filing, facts)
    p_dict = filing.meta.get("periods", {})

    def ctx_rank(c: Dict[str, Any]) -> int:
        return scope_rank(p_dict, c["period"]) * 2 + (1 if c["dims"] else 0)

    used_units: Set[str] = set()
    for f in facts:
        if f.unit:
            used_units.add(f.unit)

    prefixes: Set[str] = set()
    for f in facts:
        prefixes.add(f.concept.split(":")[0])
        for d in f.dims:
            prefixes.add(d["axis"].split(":")[0])
            if d.get("member"):
                prefixes.add(d["member"].split(":")[0])
            else:
                domain = A.typed_domain(d["axis"])
                if domain:
                    prefixes.add(domain.split(":")[0])

    def fact_sort_key(f: Any) -> Tuple[int, str, int, str]:
        c_order = order.get(f.concept, 1_000_000_000)
        s_rank = scope_rank(p_dict, f.period)
        ctx_id = ctx_map[key_of(f)]["id"]
        return (c_order, f.concept, s_rank, ctx_id)

    sorted_facts = sorted(facts, key=fact_sort_key)

    fact_ids: Dict[str, Optional[str]] = {}
    for fn in filing.footnotes.values():
        for k in fn.fact_keys:
            if k not in fact_ids and any(f.key == k for f in facts):
                fact_ids[k] = None

    fid = 1
    for f in sorted_facts:
        if f.key in fact_ids:
            fact_ids[f.key] = f"F{fid}"
            fid += 1

    lines: List[str] = []
    lines.append('<?xml version="1.0" encoding="UTF-8"?>')
    lines.append("<!-- Generated by XBRL_autopilot -->")

    ns_decls = [
        f'xmlns:xbrli="{NS["xbrli"]}"',
        f'xmlns:link="{NS["link"]}"',
        f'xmlns:xlink="{NS["xlink"]}"',
        f'xmlns:xbrldi="{NS["xbrldi"]}"',
        f'xmlns:iso4217="{NS["iso4217"]}"',
        f'xmlns:xsi="{NS["xsi"]}"',
    ]
    for p in sorted(prefixes):
        if p in A.namespaces:
            ns_decls.append(f'xmlns:{p}="{A.namespaces[p]}"')

    lines.append(f"<xbrli:xbrl {' '.join(ns_decls)}>")
    sref = filing.meta.get("schemaRef") or A.meta.get("schemaRef")
    lines.append(f'  <link:schemaRef xlink:type="simple" xlink:href="{esc(sref)}"/>')

    sorted_contexts = sorted(
        ctx_map.values(),
        key=lambda c: (ctx_rank(c), c["id"]),
    )
    for c in sorted_contexts:
        lines.append(f'  <xbrli:context id="{c["id"]}">')
        cin_scheme = A.meta.get("cinScheme", "")
        cin_val = filing.meta.get("cin", "")
        lines.append(f'    <xbrli:entity><xbrli:identifier scheme="{esc(cin_scheme)}">{esc(cin_val)}</xbrli:identifier></xbrli:entity>')
        p = c["period"]
        if p.get("type") == "instant":
            lines.append(f'    <xbrli:period><xbrli:instant>{p["date"]}</xbrli:instant></xbrli:period>')
        else:
            lines.append(f'    <xbrli:period><xbrli:startDate>{p["start"]}</xbrli:startDate><xbrli:endDate>{p["end"]}</xbrli:endDate></xbrli:period>')

        if c["dims"]:
            lines.append("    <xbrli:scenario>")
            for d in c["dims"]:
                axis = d["axis"]
                if d.get("member"):
                    lines.append(f'      <xbrldi:explicitMember dimension="{axis}">{d["member"]}</xbrldi:explicitMember>')
                else:
                    dom = A.typed_domain(axis)
                    lines.append(f'      <xbrldi:typedMember dimension="{axis}"><{dom}>{esc(d.get("typed", ""))}</{dom}></xbrldi:typedMember>')
            lines.append("    </xbrli:scenario>")
        lines.append("  </xbrli:context>")

    for u in sorted(used_units):
        def_unit = unit_def(u)
        if not def_unit:
            raise ValueError(f"Unknown unit {u}")
        if "denominator" in def_unit:
            num = def_unit["numerator"][0]
            den = def_unit["denominator"][0]
            lines.append(
                f'  <xbrli:unit id="{def_unit["id"]}"><xbrli:divide>'
                f"<xbrli:unitNumerator><xbrli:measure>{num}</xbrli:measure></xbrli:unitNumerator>"
                f"<xbrli:unitDenominator><xbrli:measure>{den}</xbrli:measure></xbrli:unitDenominator>"
                f"</xbrli:divide></xbrli:unit>"
            )
        else:
            meas = def_unit["measures"][0]
            lines.append(f'  <xbrli:unit id="{def_unit["id"]}"><xbrli:measure>{meas}</xbrli:measure></xbrli:unit>')

    for f in sorted_facts:
        ctx_id = ctx_map[key_of(f)]["id"]
        attrs = [f'contextRef="{ctx_id}"']
        fact_id_val = fact_ids.get(f.key)
        if fact_id_val:
            attrs.append(f'id="{fact_id_val}"')

        if A.is_numeric(f.concept):
            attrs.append(f'unitRef="{f.unit}"')
            if f.nil:
                attrs.append('xsi:nil="true"')
                lines.append(f"  <{f.concept} {' '.join(attrs)}/>")
                continue
            attrs.append(f'decimals="{f.decimals}"')
            lines.append(f"  <{f.concept} {' '.join(attrs)}>{f.value}</{f.concept}>")
        else:
            if f.lang and A.lang_allowed(f.concept):
                attrs.append(f'xml:lang="{esc(f.lang)}"')
            if f.nil:
                attrs.append('xsi:nil="true"')
                lines.append(f"  <{f.concept} {' '.join(attrs)}/>")
                continue
            lines.append(f"  <{f.concept} {' '.join(attrs)}>{esc(f.value)}</{f.concept}>")

    active_notes = [
        fn
        for fn in filing.footnotes.values()
        if any(fact_ids.get(k) for k in fn.fact_keys) and fn.text.strip()
    ]
    if active_notes:
        lines.append('  <link:footnoteLink xlink:type="extended" xlink:role="http://www.xbrl.org/2003/role/link">')
        for k, fid_str in fact_ids.items():
            if fid_str:
                lines.append(f'    <link:loc xlink:type="locator" xlink:href="#{fid_str}" xlink:label="{fid_str}"/>')
        for fn in active_notes:
            fn_lang = esc(fn.lang or "en")
            lines.append(
                f'    <link:footnote xlink:type="resource" xlink:label="{fn.id}" xlink:role="http://www.xbrl.org/2003/role/footnote" xml:lang="{fn_lang}">{esc(fn.text)}</link:footnote>'
            )
            for k in fn.fact_keys:
                fid_str = fact_ids.get(k)
                if fid_str:
                    lines.append(
                        f'    <link:footnoteArc xlink:type="arc" xlink:arcrole="http://www.xbrl.org/2003/arcrole/fact-footnote" xlink:from="{fid_str}" xlink:to="{fn.id}"/>'
                    )
        lines.append("  </link:footnoteLink>")

    lines.append("</xbrli:xbrl>")
    xml_output = "\n".join(lines) + "\n"
    return {"xml": xml_output, "contexts": list(ctx_map.values()), "factIds": fact_ids}


generateInstance = generate_instance
