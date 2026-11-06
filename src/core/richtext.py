"""Rich text for narrative (text block) facts.

Two representations of the same content:
  editor HTML — what the rich text editor shows (<p>, <br>, <b>, <i>, <u>, <ol>/<ul>/<li>, <blockquote>, <h1>-<h5>, tables)
  MCA markup  — what goes into the XBRL fact. The Filing Manual HTML guidelines allow only:
                 div, span, p, br, table, td, tr, thead, tfoot, tbody, th, lower-case tags,
                 no style attribute, no <b>/<i>, and predefined classes (header1-5, highlightedText1-4,
                 noteText1-4, bordered, normalText, ...).
"""

from __future__ import annotations
import html
import re
from typing import Any, Dict, List, Optional, Set, Tuple

VOID: Set[str] = {"br", "col", "img", "hr", "input", "meta", "link", "wbr", "area", "base"}
DROP: Set[str] = {
    "script",
    "style",
    "img",
    "object",
    "embed",
    "iframe",
    "svg",
    "math",
    "head",
    "title",
    "meta",
    "link",
    "xml",
}
BLOCKS: Set[str] = {
    "p",
    "div",
    "table",
    "ol",
    "ul",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "td",
    "th",
    "thead",
    "tbody",
    "tfoot",
}
TABLE: Set[str] = {"table", "thead", "tbody", "tfoot", "tr", "td", "th", "col", "colgroup"}
MCA_CLASSES: Set[str] = {
    "header1",
    "header2",
    "header3",
    "header4",
    "header5",
    "bordered",
    "unbordered",
    "tableHeader",
    "tableRow",
    "tableRowLabel",
    "tableRowValue",
    "normalText",
    "noteText1",
    "noteText2",
    "noteText3",
    "noteText4",
    "numericValue",
    "nonNumericValue",
    "highlightedText1",
    "highlightedText2",
    "highlightedText3",
    "highlightedText4",
}

ENT: Dict[str, str] = {
    "nbsp": "\u00a0",
    "amp": "&",
    "lt": "<",
    "gt": ">",
    "quot": '"',
    "apos": "'",
    "rsquo": "\u2019",
    "lsquo": "\u2018",
    "rdquo": "\u201d",
    "ldquo": "\u201c",
    "sbquo": "\u201a",
    "bdquo": "\u201e",
    "ndash": "\u2013",
    "mdash": "\u2014",
    "hellip": "\u2026",
    "bull": "\u2022",
    "middot": "\u00b7",
    "copy": "\u00a9",
    "reg": "\u00ae",
    "trade": "\u2122",
    "deg": "\u00b0",
    "sect": "\u00a7",
    "para": "\u00b6",
    "times": "\u00d7",
    "divide": "\u00f7",
    "plusmn": "\u00b1",
    "frac12": "\u00bd",
    "frac14": "\u00bc",
    "frac34": "\u00be",
    "laquo": "\u00ab",
    "raquo": "\u00bb",
    "euro": "\u20ac",
    "pound": "\u00a3",
    "yen": "\u00a5",
    "cent": "\u00a2",
    "rupee": "\u20b9",
    "shy": "",
    "zwnj": "",
    "zwj": "",
}

_XML_ILLEGAL_RE = re.compile(
    r"[\u0000-\u0008\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]"
)


def xml_safe(s: Any) -> str:
    res = str(s or "").replace("\u000b", "\n").replace("\u000c", "\n")
    return _XML_ILLEGAL_RE.sub("", res)


xmlSafe = xml_safe

_ENTITY_RE = re.compile(r"&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);")


def decode_entities(s: str) -> str:
    def repl(m: re.Match) -> str:
        e = m.group(1)
        if e.startswith("#x") or e.startswith("#X"):
            try:
                cp = int(e[2:], 16)
                if cp <= 0x10FFFF:
                    return xml_safe(chr(cp))
            except ValueError:
                pass
            return m.group(0)
        if e.startswith("#"):
            try:
                cp = int(e[1:], 10)
                if cp <= 0x10FFFF:
                    return xml_safe(chr(cp))
            except ValueError:
                pass
            return m.group(0)
        low = e.lower()
        if low in ENT:
            return ENT[low]
        return m.group(0)

    return _ENTITY_RE.sub(repl, s)


decodeEntities = decode_entities

_ATTR_RE = re.compile(r'([^\s"\'/>/=]+)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+)))?')


def parse_attrs(src: str) -> Dict[str, str]:
    out = {}
    for m in _ATTR_RE.finditer(src):
        val = m.group(2) if m.group(2) is not None else (m.group(3) if m.group(3) is not None else m.group(4) or "")
        out[m.group(1).lower()] = decode_entities(val)
    return out


_TOKEN_RE = re.compile(
    r"<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|</\s*([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:[^>\"']|\"[^\"]*\"|'[^']*')*?)(\/?)>|([^<]+)|<"
)


class HtmlNode:
    def __init__(self, tag: str, attrs: Optional[Dict[str, str]] = None, text: Optional[str] = None):
        self.tag = tag
        self.attrs = attrs or {}
        self.text = text
        self.children: List[HtmlNode] = []

    def __repr__(self) -> str:
        if self.text is not None:
            return f"HtmlNode(text={self.text!r})"
        return f"HtmlNode(tag={self.tag!r}, attrs={self.attrs!r}, children={len(self.children)})"


def parse_html(html_str: str) -> HtmlNode:
    root = HtmlNode("#root")
    stack = [root]

    def top() -> HtmlNode:
        return stack[-1]

    for m in _TOKEN_RE.finditer(html_str):
        raw_text = m.group(5)
        matched_str = m.group(0)

        if raw_text is not None or matched_str == "<":
            txt = decode_entities(raw_text if raw_text is not None else "<")
            top().children.append(HtmlNode("#text", text=txt))
            continue

        close_tag = m.group(1)
        if close_tag:
            name = close_tag.lower()
            tag_names = [n.tag for n in stack]
            try:
                # Find last index
                idx = len(tag_names) - 1 - tag_names[::-1].index(name)
                if idx > 0:
                    del stack[idx:]
            except ValueError:
                pass
            continue

        open_tag = m.group(2)
        if not open_tag:
            continue

        name = open_tag.lower()
        if name in BLOCKS and top().tag == "p" and name != "td":
            stack.pop()

        if name == "li":
            tag_names = [n.tag for n in stack]
            last_li = len(tag_names) - 1 - tag_names[::-1].index("li") if "li" in tag_names else -1
            last_list = -1
            for l_tag in ("ol", "ul"):
                if l_tag in tag_names:
                    last_list = max(last_list, len(tag_names) - 1 - tag_names[::-1].index(l_tag))
            if last_li > last_list and last_li > 0:
                del stack[last_li:]

        if name in ("tr", "td", "th"):
            target_tags = ("tr", "td", "th") if name == "tr" else ("td", "th")
            while top().tag in target_tags and top().tag != "tr" or (name == "tr" and top().tag == "tr"):
                stack.pop()
                if name != "tr" and top().tag == "tr":
                    break

        node = HtmlNode(name, attrs=parse_attrs(m.group(3) or ""))
        top().children.append(node)
        is_self_closing = bool(m.group(4))
        if name not in VOID and not is_self_closing:
            stack.append(node)

    return root


parseHtml = parse_html


def marks_of(node: HtmlNode, m: str) -> str:
    cls_list = (node.attrs.get("class") or "").split()
    st = (node.attrs.get("style") or "").lower()
    out_chars = list(m)

    def add(c: str):
        if c not in out_chars:
            out_chars.append(c)

    if (
        node.tag in ("b", "strong")
        or "highlightedText1" in cls_list
        or re.search(r"font-weight\s*:\s*(bold|bolder|[6-9]00)", st)
    ):
        add("b")
    if (
        node.tag in ("i", "em", "cite")
        or "highlightedText2" in cls_list
        or re.search(r"font-style\s*:\s*(italic|oblique)", st)
    ):
        add("i")
    if (
        node.tag in ("u", "ins")
        or "highlightedText3" in cls_list
        or re.search(r"text-decoration[^;]*underline", st)
    ):
        add("u")

    return "".join(c for c in "biu" if c in out_chars)


_MARKER_RE = re.compile(r"^[\s\u00a0]*(?:\d+[.)]|[••●▪\-–o§])[\s\u00a0]+")
_WS_ONLY_RE = re.compile(r"^[\s\u00a0]*$")
_NUMBER_LIKE_RE = re.compile(
    r"^[(\-\u2013\u2014\u2212]?[\s\u00a0]*[\d.,]*\d[\d.,]*[\s\u00a0]*\)?%?$|^[-\u2013\u2014]$"
)
MAX_SPAN = 100


def span_val(v: Any) -> int:
    try:
        n = int(v)
        return min(n, MAX_SPAN) if n > 1 else 1
    except (ValueError, TypeError):
        return 1


def para_text(bl: Dict[str, Any]) -> str:
    return "".join(x["s"] for x in bl.get("inl", []) if x.get("t") == "text")


def is_para(bl: Dict[str, Any]) -> bool:
    b = bl.get("b", "")
    return b == "p" or bool(re.match(r"^h\d$", b))


def empty_cell() -> List[Dict[str, Any]]:
    return [{"b": "p", "inl": [{"t": "text", "s": "\u00a0", "m": ""}]}]


EMPTY_CELL = empty_cell


def clean_cell(blocks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    kept = [bl for bl in blocks if not (is_para(bl) and _WS_ONLY_RE.match(para_text(bl)))]
    if not kept:
        return empty_cell()
    for bl in kept:
        if not is_para(bl):
            continue
        runs = [x for x in bl.get("inl", []) if x.get("t") == "text"]
        if not runs:
            continue
        pt = re.sub(r"^[\s\u00a0]+|[\s\u00a0]+$", "", para_text(bl))
        if _NUMBER_LIKE_RE.match(pt):
            for x in runs:
                t = re.sub(r"^[\s\u00a0]+", "", x["s"])
                x["s"] = t
                if t:
                    break
        for x in reversed(runs):
            t = re.sub(r"[\s\u00a0]+$", "", x["s"])
            x["s"] = t
            if t:
                break
        bl["inl"] = [x for x in bl.get("inl", []) if x.get("t") != "text" or x.get("s") != ""]
    return kept


def cell_classes(c: HtmlNode) -> List[str]:
    return [x for x in (c.attrs.get("class") or "").split() if x in MCA_CLASSES]


def cell_text_len(c: Optional[Dict[str, Any]]) -> int:
    if not c:
        return 0
    total = 0
    for bl in c.get("blocks", []):
        if is_para(bl):
            total += len(re.sub(r"[\s\u00a0]+", " ", para_text(bl)).strip())
        elif bl.get("b") == "table":
            total += 0
        else:
            total += 10
    return total


def place_merged_cells(sections: List[Dict[str, Any]]) -> None:
    weight: List[int] = []
    for s in sections:
        for r in s.get("rows", []):
            for j, c in enumerate(r):
                if c and not c.get("span") and not c.get("spanned"):
                    while len(weight) <= j:
                        weight.append(0)
                    weight[j] += cell_text_len(c)

    for s in sections:
        for r in s.get("rows", []):
            for j in range(len(r)):
                c = r[j]
                if not c or not c.get("span"):
                    continue
                best = j
                sp = c["span"]
                for k in range(j + 1, min(j + sp, len(r))):
                    w_k = weight[k] if k < len(weight) else 0
                    w_best = weight[best] if best < len(weight) else 0
                    if w_k > w_best:
                        best = k
                w_best = weight[best] if best < len(weight) else 0
                w_j = weight[j] if j < len(weight) else 0
                if best != j and w_best > 2 * w_j + 20:
                    r[best]["blocks"], c["blocks"] = c["blocks"], r[best]["blocks"]
            for c in r:
                if c:
                    c.pop("span", None)
                    c.pop("spanned", None)


def table_model(n: HtmlNode, m: str, opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    opts = opts or {}
    sections: List[Dict[str, Any]] = []
    before: List[Dict[str, Any]] = []
    loose: Optional[Dict[str, Any]] = None

    def visit(c: HtmlNode):
        nonlocal loose
        if not c.tag:
            return
        if c.tag in ("thead", "tbody", "tfoot"):
            loose = None
            sections.append({"tag": c.tag, "rows": [k for k in c.children if k.tag == "tr"]})
        elif c.tag == "tr":
            if not loose:
                loose = {"tag": "tbody", "rows": []}
                sections.append(loose)
            loose["rows"].append(c)
        elif c.tag == "caption":
            before.extend(to_model(c, m, opts))
        elif c.tag in ("td", "th"):
            if not loose:
                loose = {"tag": "tbody", "rows": []}
                sections.append(loose)
            loose["rows"].append(HtmlNode("tr", children=[c]))

    for child_node in n.children:
        visit(child_node)

    out: List[Dict[str, Any]] = []
    for sec in sections:
        rows: List[List[Any]] = []
        carry: List[Optional[Dict[str, Any]]] = []

        for tr in sec["rows"]:
            row: List[Any] = []

            def fill():
                while len(row) < len(carry) and carry[len(row)] and carry[len(row)]["left"] > 0:
                    k = carry[len(row)]
                    k["left"] -= 1
                    row.append({"tag": k["tag"], "cls": k["cls"], "blocks": empty_cell()})

            for c in tr.children:
                if c.tag not in ("td", "th"):
                    continue
                fill()
                cls = cell_classes(c)
                if opts.get("borders") and "bordered" not in cls and "unbordered" not in cls:
                    cls.insert(0, "bordered")
                cs = span_val(c.attrs.get("colspan"))
                rs = span_val(c.attrs.get("rowspan"))
                for k in range(cs):
                    if rs > 1:
                        while len(carry) <= len(row):
                            carry.append(None)
                        carry[len(row)] = {"left": rs - 1, "cls": " ".join(cls), "tag": c.tag}
                    cell_data: Dict[str, Any] = {
                        "tag": c.tag,
                        "cls": " ".join(cls),
                        "blocks": empty_cell() if k else clean_cell(to_model(c, m, opts)),
                    }
                    if k:
                        cell_data["spanned"] = True
                    elif cs > 1:
                        cell_data["span"] = cs
                    row.append(cell_data)

            while len(row) < len(carry):
                k = carry[len(row)]
                if k and k["left"] > 0:
                    k["left"] -= 1
                    row.append({"tag": k["tag"], "cls": k["cls"], "blocks": empty_cell()})
                else:
                    row.append(None)
            rows.append(row)

        if rows:
            out.append({"tag": sec["tag"], "rows": rows})

    place_merged_cells(out)
    width = 0
    for s in out:
        for r in s["rows"]:
            width = max(width, len(r))

    for s in out:
        for r in s["rows"]:
            ref = next((x for x in r if x), {"tag": "td", "cls": "bordered" if opts.get("borders") else ""})
            while len(r) < width:
                r.append(None)
            for i in range(width):
                if not r[i]:
                    r[i] = {
                        "tag": "th" if ref.get("tag") == "th" else "td",
                        "cls": ref.get("cls", ""),
                        "blocks": empty_cell(),
                    }

    return {"before": before, "sections": out}


def to_model(
    node: HtmlNode, base_marks: str = "", opts: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    opts = opts or {}
    blocks: List[Dict[str, Any]] = []
    inl: Optional[List[Dict[str, Any]]] = None

    def flush():
        nonlocal inl
        if inl:
            has_content = any(
                x.get("t") == "br" or (x.get("s", "").strip() != "") or ("\u00a0" in x.get("s", ""))
                for x in inl
            )
            if has_content or len(blocks) == 0:
                blocks.append({"b": "p", "inl": inl})
            inl = None

    def inline_walk(n: HtmlNode, m: str):
        nonlocal inl
        if n.text is not None:
            if inl is None:
                inl = []
            inl.append({"t": "text", "s": re.sub(r"[\r\n\t]+", " ", n.text), "m": m})
            return
        if n.tag in DROP:
            return
        if n.tag == "br":
            if inl is None:
                inl = []
            inl.append({"t": "br"})
            return
        if n.tag in BLOCKS:
            flush()
            blocks.extend(block_walk(n, m))
            return
        mm = marks_of(n, m)
        for c in n.children:
            inline_walk(c, mm)

    def block_walk(n: HtmlNode, m: str) -> List[Dict[str, Any]]:
        cls_list = (n.attrs.get("class") or "").split()
        mm = marks_of(n, m)
        t = n.tag

        if t in ("ol", "ul") or (t == "div" and ("noteText1" in cls_list or "noteText2" in cls_list)):

            def first_text() -> str:
                p = next((c for c in n.children if c.tag in ("p", "div")), None)

                def walk_t(x: HtmlNode) -> str:
                    if x.text is not None:
                        return x.text
                    return "".join(walk_t(c) for c in x.children)

                return walk_t(p) if p else ""

            ft = first_text()
            if t == "ol":
                kind = "ol"
            elif t == "ul":
                kind = "ul"
            elif "noteText2" in cls_list:
                kind = "ul"
            elif re.search(r"^[\s\u00a0]*[•●▪]", ft):
                kind = "ul"
            else:
                kind = "ol"

            items: List[List[Dict[str, Any]]] = []
            for c in n.children:
                if c.text is not None:
                    if c.text.strip() and items:
                        p_node = HtmlNode("p", children=[c])
                        items[-1].extend(to_model(p_node, mm, opts))
                    continue
                if c.tag == "li":
                    items.append(to_model(c, mm, opts))
                elif c.tag in ("ol", "ul", "div") and items:
                    items[-1].extend(block_walk(c, mm))
                elif c.tag in ("p", "div"):
                    sub = to_model(c, mm, opts)
                    if sub and sub[0].get("inl"):
                        first_run = next((x for x in sub[0]["inl"] if x.get("t") == "text"), None)
                        if first_run:
                            first_run["s"] = _MARKER_RE.sub("", first_run["s"])
                    items.append(sub)
            return [{"b": kind, "items": items}]

        if t == "blockquote" or (t == "div" and "noteText3" in cls_list):
            return [{"b": "indent", "children": to_model(n, mm, opts)}]

        if t == "table" or t in TABLE:
            if t in ("col", "colgroup"):
                return []
            wrapped = n if t == "table" else HtmlNode("table", children=[n])
            tm = table_model(wrapped, mm, opts)
            res = list(tm["before"])
            res.append({"b": "table", "html": tm})
            return res

        h_match = re.match(r"^h([1-6])$", t)
        if not h_match and t == "p":
            for c in cls_list:
                hm = re.match(r"^header([1-5])$", c)
                if hm:
                    h_match = hm
                    break

        if t == "li":
            return to_model(n, m, opts)

        sub = to_model(n, m, opts)
        if not sub or sub[0].get("b") != "p":
            sub.insert(0, {"b": "p", "inl": []})
        if h_match:
            level = min(5, int(h_match.group(1)))
            sub[0] = {"b": f"h{level}", "inl": sub[0].get("inl", [])}
        return sub

    for c in node.children:
        inline_walk(c, base_marks if node.tag == "#root" else marks_of(node, base_marks))
    flush()
    return blocks


def esc_text(s: str, nbsp: str = "&nbsp;") -> str:
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\u00a0", nbsp)
    )


def inline_html(inl: Optional[List[Dict[str, Any]]], mode: str, opts: Optional[Dict[str, Any]] = None) -> str:
    opts = opts or {}
    out = ""
    for x in inl or []:
        if x.get("t") == "br":
            out += "<br/>" if mode == "mca" else "<br>"
            continue
        s = esc_text(x.get("s", ""), "&nbsp;")
        if not s:
            continue
        if _WS_ONLY_RE.match(x.get("s", "")):
            marks = ""
        elif mode == "mca":
            emp = opts.get("emphasis")
            if emp in ("none", "headings"):
                marks = ""
            else:
                marks = x.get("m", "")
        else:
            marks = x.get("m", "")

        for k in reversed(marks):
            if mode == "mca":
                idx = "biu".find(k) + 1
                s = f'<span class="highlightedText{idx}">{s}</span>'
            else:
                s = f"<{k}>{s}</{k}>"
        out += s

    if mode == "mca":
        return out
    return re.sub(r"<\/(b|i|u)><\1>", "", out)


def table_html(t: Dict[str, Any], mode: str, opts: Optional[Dict[str, Any]] = None) -> str:
    if not t or not t.get("sections"):
        return ""

    def cell_render(c: Dict[str, Any]) -> str:
        cls_attr = f' class="{c["cls"]}"' if c.get("cls") else ""
        return f'<{c["tag"]}{cls_attr}>{blocks_html(c.get("blocks", []), mode, opts)}</{c["tag"]}>'

    sec_strs = []
    for s in t["sections"]:
        row_strs = []
        for r in s.get("rows", []):
            row_strs.append(f"<tr>{''.join(cell_render(c) for c in r)}</tr>")
        sec_strs.append(f"<{s['tag']}>{''.join(row_strs)}</{s['tag']}>")
    return f"<table>{''.join(sec_strs)}</table>"


def blocks_html(blocks: List[Dict[str, Any]], mode: str, opts: Optional[Dict[str, Any]] = None) -> str:
    out = ""
    opts = opts or {}
    for bl in blocks:
        b_type = bl.get("b", "")
        if b_type == "p":
            out += f"<p>{inline_html(bl.get('inl'), mode, opts)}</p>"
        elif re.match(r"^h\d$", b_type):
            if mode == "mca":
                out += f'<p class="header{b_type[1]}">{inline_html(bl.get("inl"), mode, opts)}</p>'
            else:
                out += f"<{b_type}>{inline_html(bl.get('inl'), mode, opts)}</{b_type}>"
        elif b_type == "indent":
            inner = blocks_html(bl.get("children", []), mode, opts)
            out += f'<div class="noteText3">{inner}</div>' if mode == "mca" else f"<blockquote>{inner}</blockquote>"
        elif b_type == "table":
            out += table_html(bl.get("html", {}), mode, opts)
        elif b_type in ("ol", "ul"):
            if mode == "mca":
                out += '<div class="noteText1">'
                for i, item in enumerate(bl.get("items", [])):
                    marker = f"{i + 1}.&nbsp;" if b_type == "ol" else "•&nbsp;"
                    first = item[0] if item else None
                    rest = item[1:] if len(item) > 1 else []
                    if first and first.get("b") == "p":
                        out += f"<p>{marker}{inline_html(first.get('inl'), mode, opts)}</p>{blocks_html(rest, mode, opts)}"
                    else:
                        out += f"<p>{marker}</p>{blocks_html(item, mode, opts)}"
                out += "</div>"
            else:
                li_strs = []
                for item in bl.get("items", []):
                    first = item[0] if item else None
                    rest = item[1:] if len(item) > 1 else []
                    if first and first.get("b") == "p":
                        content = inline_html(first.get("inl"), mode, opts) + blocks_html(rest, mode, opts)
                    else:
                        content = blocks_html(item, mode, opts)
                    li_strs.append(f"<li>{content}</li>")
                out += f"<{b_type}>{''.join(li_strs)}</{b_type}>"
    return out


_LOOKS_HTML_RE = re.compile(r"<\s*[a-zA-Z][^>]*>")


def model(val: Any, opts: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    s = xml_safe(val or "")
    if not _LOOKS_HTML_RE.search(s):
        if not s.strip():
            return []
        paras = re.split(r"\r?\n\s*\r?\n", s)
        res = []
        for p in paras:
            lines = re.split(r"\r?\n", p)
            inl = []
            for i, line in enumerate(lines):
                if i > 0:
                    inl.append({"t": "br"})
                if line:
                    inl.append({"t": "text", "s": decode_entities(line), "m": ""})
            res.append({"b": "p", "inl": inl})
        return res
    return to_model(parse_html(s), opts=opts)


def to_mca(html_content: Any, opts: Optional[Dict[str, Any]] = None) -> str:
    opts = opts or {}
    return blocks_html(model(html_content, opts), "mca", opts)


toMca = to_mca


def from_mca(value: Any) -> str:
    return blocks_html(model(value), "editor")


fromMca = from_mca


def plain_text(html_content: Any) -> str:
    root = parse_html(html_content or "")

    def walk(n: HtmlNode) -> str:
        if n.text is not None:
            return n.text
        if n.tag == "br":
            return "\n"
        nl = "\n" if n.tag in BLOCKS and n.tag not in ("td", "th") else ""
        return nl + "".join(walk(c) for c in n.children) + nl

    txt = walk(root).replace("\u00a0", " ")
    txt = re.sub(r"[ \t]+", " ", txt)
    txt = re.sub(r"\s*\n\s*", "\n", txt)
    return txt.strip()


plainText = plain_text


def formatting(html_content: Any) -> Dict[str, int]:
    s = {"b": 0, "i": 0, "u": 0, "ol": 0, "ul": 0, "li": 0, "indent": 0, "h": 0, "br": 0, "p": 0, "table": 0}

    def walk_b(blocks: List[Dict[str, Any]]):
        for bl in blocks:
            b_type = bl.get("b", "")
            if b_type == "p":
                s["p"] += 1
            if re.match(r"^h\d$", b_type):
                s["h"] += 1
            if b_type == "indent":
                s["indent"] += 1
                walk_b(bl.get("children", []))
            if b_type == "table":
                s["table"] += 1
            if b_type in ("ol", "ul"):
                s[b_type] += 1
                items = bl.get("items", [])
                s["li"] += len(items)
                for it in items:
                    walk_b(it)
            for x in bl.get("inl", []):
                if x.get("t") == "br":
                    s["br"] += 1
                else:
                    for k in x.get("m", ""):
                        if k in s:
                            s[k] += 1

    walk_b(model(html_content))
    return s


HEADING_MAX = 200


def line_text(inl: Optional[List[Dict[str, Any]]]) -> str:
    raw = "".join(x["s"] if x.get("t") == "text" else " " for x in inl or [])
    return re.sub(r"[\s\u00a0]+", " ", raw).strip()


def emphasised(inl: Optional[List[Dict[str, Any]]]) -> int:
    return sum(1 for x in inl or [] if x.get("t") == "text" and x.get("m") and not _WS_ONLY_RE.match(x.get("s", "")))


def plain_runs(inl: Optional[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    return [dict(x, m="") if x.get("t") == "text" and x.get("m") else x for x in inl or []]


def blank_para(bl: Dict[str, Any]) -> bool:
    return is_para(bl) and bool(_WS_ONLY_RE.match(para_text(bl)))


def whole_line(inl: Optional[List[Dict[str, Any]]], mark: str) -> bool:
    runs = [x for x in inl or [] if x.get("t") == "text" and not _WS_ONLY_RE.match(x.get("s", ""))]
    return len(runs) > 0 and all(mark in x.get("m", "") for x in runs)


def heading_like(t: str) -> bool:
    return 0 < len(t) <= HEADING_MAX and not re.search(r"[.;]$", t)


def tidy_blocks(blocks: List[Dict[str, Any]], o: Dict[str, Any], st: Dict[str, int]) -> List[Dict[str, Any]]:
    out = []
    for bl in blocks or []:
        if blank_para(bl):
            st["blank"] += 1
            continue
        if is_para(bl):
            if o.get("style") == "keep":
                out.append(bl)
                continue
            is_h = bl.get("b") != "p"
            if is_h and o.get("keepLevels") and o.get("style") != "plain":
                out.append({"b": bl["b"], "inl": plain_runs(bl.get("inl"))})
                continue
            t = line_text(bl.get("inl"))
            n = emphasised(bl.get("inl"))
            if (
                o.get("style") == "headings"
                and not o.get("inTable")
                and (is_h or whole_line(bl.get("inl"), "b") or whole_line(bl.get("inl"), "u"))
                and heading_like(t)
            ):
                out.append({"b": "h5", "inl": plain_runs(bl.get("inl"))})
                if bl.get("b") != "h5":
                    st["headings"] += 1
            else:
                out.append({"b": "p", "inl": plain_runs(bl.get("inl"))})
                if is_h:
                    st["headingsToText"] += 1
                st["emphasis"] += n
            continue
        if bl.get("b") == "indent":
            ch = tidy_blocks(bl.get("children", []), o, st)
            if ch:
                out.append(dict(bl, children=ch))
            continue
        if bl.get("b") in ("ol", "ul"):
            items = [
                tidy_blocks(it, dict(o, inTable=True), st)
                for it in bl.get("items", [])
                if tidy_blocks(it, dict(o, inTable=True), st)
            ]
            if items:
                out.append(dict(bl, items=items))
            continue
        if bl.get("b") == "table":
            tb = tidy_table(bl.get("html"), o, st)
            if tb:
                out.append({"b": "table", "html": tb})
            continue
        out.append(bl)
    return out


LONG_TEXT = 40


def align_long_text(sections: List[Dict[str, Any]], empty_fn: Any) -> int:
    target = -1
    for s in sections:
        for r in s.get("rows", []):
            for j, c in enumerate(r):
                if cell_text_len(c) >= LONG_TEXT and j > target:
                    target = j
    if target < 1:
        return 0
    moved = 0
    for s in sections:
        for r in s.get("rows", []):
            if len(r) <= target or not empty_fn(r[target]):
                continue
            last = -1
            for j, c in enumerate(r):
                if not empty_fn(c):
                    last = j
            if last < 0 or last >= target or cell_text_len(r[last]) < LONG_TEXT:
                continue
            r[target]["blocks"], r[last]["blocks"] = r[last]["blocks"], r[target]["blocks"]
            moved += 1
    return moved


def tidy_table(t: Optional[Dict[str, Any]], o: Dict[str, Any], st: Dict[str, int]) -> Optional[Dict[str, Any]]:
    if not t:
        return None
    cell_opts = dict(o, inTable=True)

    def is_empty_cell(c: Optional[Dict[str, Any]]) -> bool:
        return not c or all(blank_para(b) for b in c.get("blocks", []))

    new_sections = []
    for s in t.get("sections", []):
        new_rows = []
        for r in s.get("rows", []):
            new_row = []
            for c in r:
                if not c:
                    new_row.append(c)
                    continue
                before_blanks = st["blank"]
                blocks = tidy_blocks(c.get("blocks", []), cell_opts, st)
                st["blank"] = before_blanks
                new_row.append(dict(c, blocks=blocks if blocks else empty_cell()))
            new_rows.append(new_row)
        new_sections.append(dict(s, rows=new_rows))

    if o.get("wideTables"):
        st["moved"] += align_long_text(new_sections, is_empty_cell)

    width = 0
    for s in new_sections:
        for r in s.get("rows", []):
            width = max(width, len(r))

    keep_col = [False] * width
    for j in range(width):
        keep_col[j] = any(
            not is_empty_cell(r[j])
            for s in new_sections
            for r in s.get("rows", [])
            if j < len(r)
        )
    if not any(keep_col) and width:
        keep_col[0] = True
    dropped = sum(1 for k in keep_col if not k)
    st["columns"] += dropped

    out_sections = []
    for s in new_sections:
        out_rows = []
        for r in s.get("rows", []):
            if all(is_empty_cell(c) for c in r):
                st["rows"] += 1
                continue
            out_rows.append([c for j, c in enumerate(r) if j < len(keep_col) and keep_col[j]])
        if out_rows:
            out_sections.append(dict(s, rows=out_rows))

    if out_sections or t.get("before"):
        return {"before": t.get("before", []), "sections": out_sections}
    return None


def tidy(html_content: Any, options: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    options = options or {}
    style = options.get("style", "headings")
    keep_levels = options.get("keepLevels", False)
    wide_tables = options.get("wideTables", False)

    st = {"blank": 0, "columns": 0, "rows": 0, "headings": 0, "headingsToText": 0, "emphasis": 0, "moved": 0}
    bl = tidy_blocks(model(html_content or ""), {"style": style, "keepLevels": keep_levels, "wideTables": wide_tables}, st)
    return {"html": blocks_html(bl, "editor"), "stats": st}


def layout_report(html_content: Any) -> Dict[str, int]:
    r = {"blank": 0, "shaded": 0, "largeHeadings": 0, "columns": 0, "rows": 0, "wideTables": 0}

    def walk(blocks: List[Dict[str, Any]], in_table: bool):
        for bl in blocks or []:
            if blank_para(bl):
                if not in_table:
                    r["blank"] += 1
                continue
            if is_para(bl):
                r["shaded"] += emphasised(bl.get("inl"))
                if re.match(r"^h[1-4]$", bl.get("b", "")):
                    r["largeHeadings"] += 1
                continue
            if bl.get("b") == "indent":
                walk(bl.get("children", []), in_table)
            elif bl.get("b") in ("ol", "ul"):
                for it in bl.get("items", []):
                    walk(it, in_table)
            elif bl.get("b") == "table" and bl.get("html"):
                tb = bl["html"]
                for s in tb.get("sections", []):
                    for row in s.get("rows", []):
                        for c in row:
                            if c:
                                walk(c.get("blocks", []), True)
                cols: Set[int] = set()
                for s in tb.get("sections", []):
                    for row in s.get("rows", []):
                        for j, c in enumerate(row):
                            if cell_text_len(c) >= LONG_TEXT:
                                cols.add(j)
                if len(cols) > 2:
                    r["wideTables"] += 1

    bl = model(html_content or "")
    walk(bl, False)
    st = {"blank": 0, "columns": 0, "rows": 0, "headings": 0, "headingsToText": 0, "emphasis": 0, "moved": 0}
    tidy_blocks(bl, {"style": "keep"}, st)
    r["columns"] = st["columns"]
    r["rows"] = st["rows"]
    return r


layoutReport = layout_report
