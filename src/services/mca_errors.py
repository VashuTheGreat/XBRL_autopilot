"""MCA Validator error explainer.

Turns validator Xerces error strings into actionable explanations and remedies.
"""

from __future__ import annotations
import re
from typing import Any, Callable, Dict, List, Optional, Union


def short_name(s: Any) -> str:
    cleaned = re.sub(r'^".*?":', "", str(s or ""))
    cleaned = re.sub(r"^\{?[^}]*\}", "", cleaned)
    return re.sub(r'^"|"$', "", cleaned)


PATTERNS = [
    {
        "code": "html",
        "re": re.compile(r"Element '([^']+)' the contained HTML has the following errors:\s*(.*)$"),
        "title": "HTML inside a text block",
        "meaning": lambda m: f"The text block {m.group(1)} contains HTML that the MCA HTML schema does not accept.",
        "cause": "Usually a table or formatting pasted from Word/Excel/web (colgroup, colspan, rowspan, style, width, align …).",
        "fix": "Open the text block and click Save Text: the editor rebuilds the content in the MCA subset.",
        "element": lambda m: m.group(1),
        "nested": lambda m: [x for x in re.split(r";\s*", m.group(2)) if x.strip()],
    },
    {
        "code": "cvc-complex-type.3.2.2",
        "re": re.compile(r"cvc-complex-type\.3\.2\.2: Attribute '([^']+)' is not allowed to appear in element '([^']+)'"),
        "title": "Attribute not allowed on this element",
        "meaning": lambda m: f"The schema of '{m.group(2)}' does not declare the attribute '{m.group(1)}'.",
        "cause": lambda m: (
            "xml:lang is allowed only on plain string and text-block elements."
            if m.group(1) == "xml:lang"
            else (
                "An HTML attribute from pasted content (Word/Excel/web)."
                if re.match(r"^(colspan|rowspan|style|width|align|valign|border|cellpadding|cellspacing|height|lang|id|bgcolor)$", m.group(1), re.IGNORECASE)
                else "The element carries an attribute its schema does not define."
            )
        ),
        "fix": lambda m: "Open the text block and click Save Text." if m.group(1) != "xml:lang" else "Check the build and re-generate.",
        "element": lambda m: m.group(2),
    },
    {
        "code": "cvc-complex-type.2.4.a",
        "re": re.compile(r"cvc-complex-type\.2\.4\.a: Invalid content was found starting with element '([^']+)'\. One of '\{?(.*?)\}?' is expected"),
        "title": "Element not allowed at this position",
        "meaning": lambda m: f"'{short_name(m.group(1))}' appears where the schema expects one of: {', '.join(short_name(x) for x in re.split(r',\\s*', m.group(2)))}.",
        "cause": lambda m: "A Word/Excel table structure (<colgroup>/<col>/<caption>)." if re.match(r"^(colgroup|col|caption)$", short_name(m.group(1))) else "Wrong nesting or order of elements.",
        "fix": "Inside a text block: open it and click Save Text.",
    },
    {
        "code": "cvc-complex-type.2.4.b",
        "re": re.compile(r"cvc-complex-type\.2\.4\.b: The content of element '([^']+)' is not complete\. One of '\{?(.*?)\}?' is expected"),
        "title": "Required child element missing",
        "meaning": lambda m: f"'{short_name(m.group(1))}' must contain one of: {', '.join(short_name(x) for x in re.split(r',\\s*', m.group(2)))}.",
        "cause": "An empty structure (for example an empty table row or an empty context/segment).",
        "fix": "For text blocks: remove empty tables/rows and save the text block again.",
        "element": lambda m: m.group(1),
    },
    {
        "code": "cvc-complex-type.4",
        "re": re.compile(r"cvc-complex-type\.4: Attribute '([^']+)' must appear on element '([^']+)'"),
        "title": "Required attribute missing",
        "meaning": lambda m: f"'{m.group(2)}' must carry the attribute '{m.group(1)}'.",
        "cause": "contextRef / unitRef / decimals missing on a fact.",
        "fix": "Report it — the generator writes these attributes.",
        "element": lambda m: m.group(2),
    },
    {
        "code": "cvc-pattern-valid",
        "re": re.compile(r"cvc-pattern-valid: Value '([^']*)' is not facet-valid with respect to pattern '([^']*)' for type '([^']+)'"),
        "title": "Value has the wrong format",
        "meaning": lambda m: f"'{m.group(1)}' does not match the required format of type {m.group(3)}.",
        "cause": "Typing error in a coded value (PAN, CIN, DIN, SRN, ITC code, e-mail …): wrong length, lower-case letters, spaces.",
        "fix": "Correct the value. Letters must usually be upper case; no spaces.",
    },
    {
        "code": "cvc-enumeration-valid",
        "re": re.compile(r"cvc-enumeration-valid: Value '([^']*)' is not facet-valid with respect to enumeration '\[(.*)\]'"),
        "title": "Value not in the allowed list",
        "meaning": lambda m: f"'{m.group(1)}' is not one of: {m.group(2)}.",
        "cause": "A list value typed or imported with different spelling/case.",
        "fix": "Pick the value from the drop-down of the element.",
    },
    {
        "code": "cvc-length-valid",
        "re": re.compile(r"cvc-(length|minLength|maxLength)-valid: Value '([^']*)' with length = '(\d+)' is not facet-valid with respect to (?:length|minLength|maxLength) '(\d+)'"),
        "title": "Value has the wrong length",
        "meaning": lambda m: f"'{m.group(2)}' has {m.group(3)} characters; the type requires {m.group(1)} {m.group(4)}.",
        "cause": "Code values with a fixed length (PAN 10, CIN 21, DIN 8 …).",
        "fix": "Correct the length of the value.",
    },
    {
        "code": "cvc-datatype-valid",
        "re": re.compile(r"cvc-datatype-valid\.1\.2\.1: '([^']*)' is not a valid value for '([^']+)'"),
        "title": "Value is not of the right data type",
        "meaning": lambda m: f"'{m.group(1)}' is not a valid {m.group(2)}.",
        "cause": "Text in a number/date/boolean element.",
        "fix": "Correct the value of the element.",
    },
    {
        "code": "cvc-type.3.1.3",
        "re": re.compile(r"cvc-type\.3\.1\.3: The value '([^']*)' of element '([^']+)' is not valid"),
        "title": "Which element has the invalid value",
        "meaning": lambda m: f"Element '{m.group(2)}' has the invalid value '{m.group(1)}'.",
        "cause": "See previous message.",
        "fix": "Go to the element and correct the value.",
        "element": lambda m: m.group(2),
    },
    {
        "code": "cvc-elt.3.1",
        "re": re.compile(r"cvc-elt\.3\.1: Attribute '[^']*nil' must not appear on element '([^']+)'"),
        "title": "Element may not be nil",
        "meaning": lambda m: f"'{m.group(1)}' is not nillable, but was written with xsi:nil=\"true\".",
        "cause": "An empty value marked as nil.",
        "fix": "Enter a value or remove the cell content.",
        "element": lambda m: m.group(1),
    },
    {
        "code": "cvc-elt.1",
        "re": re.compile(r"cvc-elt\.1(?:\.a)?: Cannot find the declaration of element '([^']+)'"),
        "title": "Schema not found / wrong namespace",
        "meaning": lambda m: f"The validator does not know the element '{m.group(1)}'.",
        "cause": "The taxonomy schema could not be loaded or the root element/namespace is wrong.",
        "fix": "Check the schemaRef in General Information / import.",
        "element": lambda m: m.group(1),
    },
]


def resolve_concept(element: Optional[str], A: Any) -> Optional[str]:
    if not element or not A:
        return None
    local = element.split(":")[-1]
    return A.qname_of_local(local) if hasattr(A, "qname_of_local") else None


def explain_one(body: str, n: Optional[int], A: Any = None) -> Dict[str, Any]:
    for p in PATTERNS:
        m = p["re"].search(body)
        if not m:
            continue
        v_fn = lambda x: x(m) if callable(x) else x
        elem = p["element"](m) if "element" in p else None
        concept = resolve_concept(elem, A) if elem else None
        lbl = A.label(concept) if (concept and hasattr(A, "label")) else None
        nested_items = []
        if "nested" in p:
            for d in p["nested"](m):
                nested_items.append(explain_one(d, None, None))
        return {
            "n": n,
            "raw": body,
            "code": p["code"],
            "title": p["title"],
            "meaning": v_fn(p["meaning"]),
            "cause": v_fn(p["cause"]),
            "fix": v_fn(p["fix"]),
            "element": elem,
            "concept": concept,
            "label": lbl,
            "details": nested_items,
        }

    cvc_m = re.search(r"\b(cvc-[\w.-]+)", body)
    cvc_code = cvc_m.group(1) if cvc_m else "unknown"
    return {
        "n": n,
        "raw": body,
        "code": cvc_code,
        "title": "Schema validation message" if cvc_m else "MCA message",
        "meaning": f"A W3C XML Schema constraint ({cvc_code}) failed." if cvc_m else "MCA validation or business rule message.",
        "cause": "Not classified automatically.",
        "fix": f"Inspect element associated with '{cvc_code}'." if cvc_m else "Check message on the Validation tab.",
        "element": None,
        "concept": None,
        "label": None,
        "details": [],
    }


def explain_mca_errors(text: str, A: Any = None) -> List[Dict[str, Any]]:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    out = []
    for line in lines:
        nm = re.match(r"^(\d+)\)\s*(.*)$", line)
        body = nm.group(2) if nm else line
        if not nm and not out and not re.search(r"cvc-|Element '|error", body, re.IGNORECASE):
            continue
        if re.match(r"^NOTE:|^You should convert|^However the warning", body, re.IGNORECASE):
            continue
        out.append(explain_one(body, int(nm.group(1)) if nm else None, A))

    for i in range(1, len(out)):
        if out[i]["code"] == "cvc-type.3.1.3" and not out[i - 1].get("element"):
            out[i - 1]["element"] = out[i]["element"]
            out[i - 1]["concept"] = out[i]["concept"]
            out[i - 1]["label"] = out[i]["label"]

    return out


explainMcaErrors = explain_mca_errors
