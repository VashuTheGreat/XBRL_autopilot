"""Discoverable Taxonomy Set loader: schemas and linkbases from an MCA entry point.

Only local files are read. Remote XBRL specification schemas (xbrl.org) are recorded as external references,
never fetched. Linkbase relationships are returned after XBRL 2.1 prohibition and override.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree

from src.services.engine_authority.specs import ValidatorPatch

XSD = "http://www.w3.org/2001/XMLSchema"
LINK = "http://www.xbrl.org/2003/linkbase"
XLINK = "http://www.w3.org/1999/xlink"
XBRLI = "http://www.xbrl.org/2003/instance"
XBRLDT = "http://xbrl.org/2005/xbrldt"
XML_NS = "http://www.w3.org/XML/1998/namespace"


class ARC:
    all = "http://xbrl.org/int/dim/arcrole/all"
    not_all = "http://xbrl.org/int/dim/arcrole/notAll"
    hc_dim = "http://xbrl.org/int/dim/arcrole/hypercube-dimension"
    dim_dom = "http://xbrl.org/int/dim/arcrole/dimension-domain"
    dom_mem = "http://xbrl.org/int/dim/arcrole/domain-member"
    dim_default = "http://xbrl.org/int/dim/arcrole/dimension-default"
    concept_label = "http://www.xbrl.org/2003/arcrole/concept-label"
    concept_ref = "http://www.xbrl.org/2003/arcrole/concept-reference"


def _q(ns: str, local: str) -> str:
    return f"{{{ns}}}{local}"


def _xa(el, local: str) -> str:
    return el.get(_q(XLINK, local)) or ""


def _text(el) -> str:
    return "".join(el.itertext()).strip()


def num(s: str | float) -> int | float:
    """A number the way JavaScript's ``Number`` prints it in JSON (``1.0`` → ``1``)."""
    v = float(s)
    return int(v) if v.is_integer() else v


def _descendants(el, ns: str, local: str) -> list:
    """``getElementsByTagNameNS`` on an element: descendants only, document order."""
    tag = _q(ns, local)
    return [e for e in el.iter(tag) if e is not el]


@dataclass
class DtsFile:
    rel: str
    kind: str
    sha256: str
    bytes: int


@dataclass
class Dts:
    root: str
    files: dict[str, DtsFile] = field(default_factory=dict)  # abs path -> info (discovery order)
    external: list[str] = field(default_factory=list)
    schemas: list[tuple[str, object]] = field(default_factory=list)  # (abs path, root element)
    linkbases: list[tuple[str, object]] = field(default_factory=list)


def _apply_patches(rel: str, data: bytes, patches: tuple[ValidatorPatch, ...]) -> bytes:
    for p in patches:
        if p.file != rel:
            continue
        text = data.decode("utf-8")
        if p.replace in text:
            continue
        count = text.count(p.find)
        if count != 1:
            raise ValueError(f"Validator patch for {p.file}: expected the original text exactly once, found {count}")
        data = text.replace(p.find, p.replace).encode("utf-8")
    return data


def load_dts(entry_files: list[Path], patches: tuple[ValidatorPatch, ...] = ()) -> Dts:
    """The DTS discovered from one or more entry points (their union; paths are relative to the first one's folder)."""
    root = os.path.dirname(os.path.abspath(entry_files[0]))
    dts = Dts(root=root)
    external: set[str] = set()
    queue: list[tuple[str, str]] = [(os.path.abspath(f), "schema") for f in entry_files]
    parser = etree.XMLParser(resolve_entities=False, no_network=True, remove_comments=False)
    while queue:
        file, kind = queue.pop(0)
        if file in dts.files:
            continue
        if not os.path.exists(file):
            raise FileNotFoundError(f"DTS file missing: {file}")
        rel = os.path.relpath(file, root).replace(os.sep, "/")
        original = Path(file).read_bytes()
        doc = etree.fromstring(_apply_patches(rel, original, patches), parser)
        # provenance names the published file; the patches are listed separately (meta.validatorPatches)
        dts.files[file] = DtsFile(rel=rel, kind=kind, sha256=hashlib.sha256(original).hexdigest(), bytes=len(original))
        base = os.path.dirname(file)

        def enqueue(href: str | None, k: str) -> None:
            if not href:
                return
            target = href.split("#")[0]
            if not target:
                return
            if target.lower().startswith(("http:", "https:")):
                external.add(target)
                return
            queue.append((os.path.normpath(os.path.join(base, target)), k))

        if kind == "schema":
            dts.schemas.append((file, doc))
            for tag in ("import", "include"):
                for el in doc.iter(_q(XSD, tag)):
                    enqueue(el.get("schemaLocation"), "schema")
            for el in doc.iter(_q(LINK, "linkbaseRef")):
                enqueue(_xa(el, "href"), "linkbase")
        else:
            dts.linkbases.append((file, doc))
            for el in doc.iter(_q(LINK, "loc")):
                enqueue(_xa(el, "href"), "schema")
            for el in doc.iter(_q(LINK, "roleRef")):
                enqueue(_xa(el, "href"), "schema")
    dts.external = sorted(external)
    return dts


_FACETS = ("pattern", "length", "minLength", "maxLength", "totalDigits", "fractionDigits", "minInclusive", "maxInclusive")


@dataclass
class SchemaInfo:
    concepts: dict[str, dict]
    by_id: dict[str, str]
    types: dict[str, dict]
    roles: dict[str, dict]
    namespaces: dict[str, str]


def parse_schemas(dts: Dts) -> SchemaInfo:
    concepts: dict[str, dict] = {}
    by_id: dict[str, str] = {}
    types: dict[str, dict] = {}
    roles: dict[str, dict] = {}
    namespaces: dict[str, str] = {}
    for file, schema in dts.schemas:
        tns = schema.get("targetNamespace")
        # the taxonomy prefix: the xmlns declaration on the schema element that matches targetNamespace
        prefix = None
        for p, uri in schema.nsmap.items():
            if p and uri == tns:
                prefix = p
        if prefix:
            namespaces[prefix] = tns
        rel = dts.files[file].rel
        for ct in _descendants(schema, XSD, "complexType"):
            name = ct.get("name")
            if not name or not prefix:
                continue
            restrs = _descendants(ct, XSD, "restriction")
            if not restrs:
                continue
            restr = restrs[0]
            t: dict = {"base": restr.get("base"), "source": rel}
            enums = [e.get("value") for e in _descendants(restr, XSD, "enumeration")]
            if enums:
                t["enumerations"] = enums
            for facet in _FACETS:
                found = _descendants(restr, XSD, facet)
                if found:
                    t[facet] = found[0].get("value")
            # several pattern facets in one restriction are alternatives (XML Schema)
            patterns = [e.get("value") for e in _descendants(restr, XSD, "pattern")]
            if len(patterns) > 1:
                t["pattern"] = "|".join(f"(?:{p})" for p in patterns)
                t["patterns"] = patterns
            types[f"{prefix}:{name}"] = t
        for n in schema:
            if not isinstance(n.tag, str) or n.tag != _q(XSD, "element"):
                continue
            name = n.get("name")
            el_id = n.get("id")
            qn = f"{prefix}:{name}"
            c = {
                "qname": qn,
                "name": name,
                "prefix": prefix,
                "namespace": tns,
                "id": el_id,
                "type": n.get("type") or None,
                "substitutionGroup": n.get("substitutionGroup") or None,
                "periodType": n.get(_q(XBRLI, "periodType")) or None,
                "balance": n.get(_q(XBRLI, "balance")) or None,
                "abstract": n.get("abstract") == "true",
                "nillable": n.get("nillable") == "true",
                "source": rel,
            }
            tdr = n.get(_q(XBRLDT, "typedDomainRef"))
            if tdr:
                c["typedDomainRef"] = tdr
            concepts[qn] = c
            if el_id:
                by_id[f"{file}#{el_id}"] = qn
        for rt in schema.iter(_q(LINK, "roleType")):
            defs = _descendants(rt, LINK, "definition")
            roles[rt.get("roleURI")] = {
                "id": rt.get("id"),
                "definition": _text(defs[0]) if defs else "",
                "usedOn": [_text(u) for u in _descendants(rt, LINK, "usedOn")],
                "source": rel,
            }
    schema_by_rel = {dts.files[f].rel: f for f, _ in dts.schemas}
    for c in concepts.values():
        if "typedDomainRef" not in c:
            continue
        schema_file = schema_by_rel[c["source"]]
        f, frag = c["typedDomainRef"].split("#", 1)
        target = os.path.normpath(os.path.join(os.path.dirname(schema_file), f)) if f else schema_file
        qn = by_id.get(f"{target}#{frag}")
        if not qn:
            raise ValueError(f"Unresolved typedDomainRef {c['typedDomainRef']} on {c['qname']}")
        c["typedDomain"] = qn
    return SchemaInfo(concepts=concepts, by_id=by_id, types=types, roles=roles, namespaces=namespaces)


@dataclass
class Linkbases:
    arcs: list[dict]
    raw_count: int
    prohibited_count: int
    labels: dict[str, dict[str, str]]
    references: dict[str, list[dict[str, str]]]


_LINKS = ("presentationLink", "calculationLink", "definitionLink", "labelLink", "referenceLink")


def _xbrldt(n, local: str) -> str | None:
    return n.get(_q(XBRLDT, local))


def parse_linkbases(dts: Dts, info: SchemaInfo) -> Linkbases:
    raw: list[dict] = []
    labels: dict[str, dict[str, str]] = {}
    references: dict[str, list[dict[str, str]]] = {}
    for file, doc in dts.linkbases:
        rel = dts.files[file].rel
        base = os.path.dirname(file)
        ext = [link for local in _LINKS for link in doc.iter(_q(LINK, local))]
        for link in ext:
            elr = _xa(link, "role")
            locs: dict[str, list[str]] = {}
            resources: dict[str, list] = {}
            children = [n for n in link if isinstance(n.tag, str)]
            for n in children:
                typ = _xa(n, "type")
                lab = _xa(n, "label")
                if typ == "locator":
                    href = _xa(n, "href")
                    f, _, frag = href.partition("#")
                    qn = info.by_id.get(f"{os.path.normpath(os.path.join(base, f))}#{frag}")
                    if not qn:
                        raise ValueError(f"Unresolved locator {href} in {rel}")
                    locs.setdefault(lab, []).append(qn)
                elif typ == "resource":
                    resources.setdefault(lab, []).append(n)
            for n in children:
                if _xa(n, "type") != "arc":
                    continue
                arcrole = _xa(n, "arcrole")
                frm = locs.get(_xa(n, "from"), [])
                to_lab = _xa(n, "to")
                if arcrole == ARC.concept_label:
                    for qn in frm:
                        for r in resources.get(to_lab, []):
                            lang = r.get(_q(XML_NS, "lang"))
                            if lang and lang != "en":
                                continue
                            role = _xa(r, "role").split("/")[-1]
                            labels.setdefault(qn, {})[role] = _text(r)
                    continue
                if arcrole == ARC.concept_ref:
                    for qn in frm:
                        for r in resources.get(to_lab, []):
                            parts = {etree.QName(p).localname: _text(p) for p in r if isinstance(p.tag, str)}
                            references.setdefault(qn, []).append(parts)
                    continue
                to = locs.get(to_lab, [])
                local = etree.QName(n).localname
                order = n.get("order")
                for f in frm:
                    for t in to:
                        arc: dict = {
                            "arcrole": arcrole,
                            "elr": elr,
                            "from": f,
                            "to": t,
                            "order": num(order) if order not in (None, "") else 1,
                            "priority": num(n.get("priority") or 0),
                            "use": n.get("use") or "optional",
                            "source": rel,
                        }
                        if local == "calculationArc":
                            arc["weight"] = num(n.get("weight"))
                        if local == "presentationArc" and n.get("preferredLabel"):
                            arc["preferredLabel"] = n.get("preferredLabel").split("/")[-1]
                        if local == "definitionArc":
                            tr = _xbrldt(n, "targetRole")
                            if tr:
                                arc["targetRole"] = tr
                            cl = _xbrldt(n, "closed")
                            if cl is not None:
                                arc["closed"] = cl == "true"
                            ce = _xbrldt(n, "contextElement")
                            if ce:
                                arc["contextElement"] = ce
                            us = _xbrldt(n, "usable")
                            if us is not None:
                                arc["usable"] = us != "false"
                        arc["kind"] = local
                        raw.append(arc)
    # XBRL 2.1 §3.5.3.9.7.4: equivalent relationships share arc element, arcrole, ELR, source, target and every
    # non-exempt attribute (use and priority are exempt). The highest priority wins; a prohibited winner removes it.
    groups: dict[tuple, list[dict]] = {}
    for a in raw:
        key = (
            a["kind"], a["arcrole"], a["elr"], a["from"], a["to"], a["order"], a.get("weight", ""),
            a.get("preferredLabel", ""), a.get("targetRole", ""), a.get("closed", ""), a.get("contextElement", ""),
            a.get("usable", ""),
        )
        groups.setdefault(key, []).append(a)
    effective: list[dict] = []
    prohibited = 0
    for arr in groups.values():
        top_p = max(a["priority"] for a in arr)
        top = [a for a in arr if a["priority"] == top_p]
        if any(a["use"] == "prohibited" for a in top):
            prohibited += 1
            continue
        effective.append(top[0])
    return Linkbases(arcs=effective, raw_count=len(raw), prohibited_count=prohibited, labels=labels, references=references)
