"""Builds the engine authority of one taxonomy: concepts, ELRs, networks and the dimensional model.

Port of the former TypeScript authority compiler (engine/compiler, ADR-0010). Deterministic: identical
inputs give byte-identical JSON. Business-rule ASTs are not part of it; the engine compiles them separately
until Phase 9 moves them here too.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

from src.core.elr_groups import classify_elr
from src.services.engine_authority.collation import locale_key, sort_obj
from src.services.engine_authority.dimensions import build_dimensional_model
from src.services.engine_authority.dts import ARC, load_dts, parse_linkbases, parse_schemas
from src.services.engine_authority.specs import CIN_SCHEME, CIN_SCHEME_SOURCE, TaxonomySpec

BUILDER_VERSION = "py-1.0.0"
_ROLE_CODE = re.compile(r"^\[([0-9]{6}[a-z]?)\]")
_ROLE_PREFIX = re.compile(r"^\[[^\]]+\]\s*")


def _role_code_factory(roles: dict[str, dict]):
    def role_code(uri: str) -> str:
        m = _ROLE_CODE.match(roles.get(uri, {}).get("definition") or "")
        return m.group(1) if m else "/".join(uri.split("/")[-2:])

    return role_code


def _classify(c: dict) -> str:
    sg = c.get("substitutionGroup") or ""
    if sg == "xbrldt:hypercubeItem":
        return "hypercube"
    if sg == "xbrldt:dimensionItem":
        return "typedAxis" if c.get("typedDomainRef") else "explicitAxis"
    if not c.get("type"):
        return "typedDomain"
    if c["type"] == "nonnum:domainItemType":
        return "member"
    if c.get("abstract"):
        return "abstract"
    return "item"


def _strip(o: dict) -> dict:
    return {k: v for k, v in o.items() if v is not None}


def _elr_group(title: str) -> str:
    """Statements / Notes / Disclosures from the ELR title, as the catalog routes group them (ADR-0008, ADR-0013).
    Never from the code: C&I's ranges (1xxxxx statements, 4xxxxx disclosures) misread Ind AS, where 210000 is the P&L,
    400xxx are notes and 7xxxxx the disclosures."""
    return classify_elr(title)


def build(spec: TaxonomySpec) -> dict:
    dts = load_dts(spec.entry_files, spec.patches)
    schema = parse_schemas(dts)
    lb = parse_linkbases(dts, schema)
    role_code = _role_code_factory(schema.roles)

    concepts: dict[str, dict] = {}
    for qn in sorted(schema.concepts, key=locale_key):
        c = schema.concepts[qn]
        out = {**c, "kind": _classify(c), "labels": lb.labels.get(qn, {})}
        out.pop("id", None)
        if qn in lb.references:
            out["references"] = lb.references[qn]
        concepts[qn] = out

    def group(kind: str, pick) -> dict[str, list[dict]]:
        g: dict[str, list[dict]] = {}
        for a in lb.arcs:
            if a["kind"] == kind:
                g.setdefault(a["elr"], []).append(pick(a))
        for v in g.values():
            v.sort(key=lambda x: (locale_key(x["from"]), x["order"], locale_key(x["to"])))
        return sort_obj(g)

    presentation = group("presentationArc", lambda a: _strip({"from": a["from"], "to": a["to"], "order": a["order"], "preferredLabel": a.get("preferredLabel")}))
    calculation = group("calculationArc", lambda a: {"from": a["from"], "to": a["to"], "weight": a["weight"], "order": a["order"]})
    def_arcs = [a for a in lb.arcs if a["kind"] == "definitionArc"]
    definition = group("definitionArc", lambda a: _strip({
        "arcrole": a["arcrole"].split("/")[-1], "from": a["from"], "to": a["to"], "order": a["order"],
        "targetRole": a.get("targetRole"), "closed": a.get("closed"), "contextElement": a.get("contextElement"), "usable": a.get("usable"),
    }))

    elrs = []
    for uri, arcs in presentation.items():
        tos = {a["to"] for a in arcs}
        roots = [f for f in dict.fromkeys(a["from"] for a in arcs) if f not in tos]
        definition_text = schema.roles.get(uri, {}).get("definition") or ""
        code = role_code(uri)
        title = _ROLE_PREFIX.sub("", definition_text, count=1)
        elrs.append({"uri": uri, "code": code, "title": title, "definition": definition_text, "roots": roots, "group": _elr_group(title)})
    elrs.sort(key=lambda e: locale_key(e["code"]))

    concept_elrs: dict[str, list[str]] = {}
    for uri, arcs in presentation.items():
        for a in arcs:
            for q in (a["from"], a["to"]):
                s = concept_elrs.setdefault(q, [])
                if uri not in s:
                    s.append(uri)
    for v in concept_elrs.values():
        v.sort()  # Array.prototype.sort(): code-unit order

    dim = build_dimensional_model(def_arcs, schema.concepts, role_code)
    for t in dim["tables"]:
        pres = concept_elrs.get(t["hypercube"], [])
        fallback = next((e["uri"] for e in elrs if e["code"] == re.sub(r"[a-z]$", "", t["code"])), None)
        t["presentationElr"] = pres[0] if pres else fallback
        t["presentationCode"] = next((e["code"] for e in elrs if e["uri"] == t["presentationElr"]), None)
    dim["tables"].sort(key=lambda t: locale_key(t["id"]))

    sources = [
        {"file": f"{spec.source_label}/{f.rel}", "kind": f.kind, "sha256": f.sha256, "bytes": f.bytes}
        for f in dts.files.values()
    ]
    sources.sort(key=lambda s: locale_key(s["file"]))
    for p in spec.patches:
        sources.append({
            "file": f"validator-patch:{p.file}", "kind": "validator-patch", "reason": p.reason,
            "sha256": hashlib.sha256((p.find + "\u0000" + p.replace).encode("utf-8")).hexdigest(),
        })
    taxonomy_hash = hashlib.sha256(_dumps(sources).encode("utf-8")).hexdigest()

    by_kind = lambda k: sum(1 for a in lb.arcs if a["kind"] == k)  # noqa: E731
    count_role = lambda r: sum(1 for a in def_arcs if a["arcrole"] == r)  # noqa: E731
    return {
        "meta": {
            "taxonomyId": spec.id,
            "name": spec.name,
            "taxonomyVersion": spec.taxonomy_version,
            "entryPoint": spec.entry_point,
            "companionEntryPoints": list(spec.companion_entry_points),
            "schemaRef": spec.schema_ref,
            "schemaRefSource": spec.schema_ref_source,
            "acceptedSchemaRefs": [{"href": spec.schema_ref, "source": spec.schema_ref_source}],
            "retiredSchemaRefs": list(spec.retired_schema_refs),
            "cinScheme": CIN_SCHEME,
            "cinSchemeSource": CIN_SCHEME_SOURCE,
            "compilerVersion": BUILDER_VERSION,
            "taxonomyHash": taxonomy_hash,
            "authorityHash": taxonomy_hash,
            "sources": sources,
            "externalSchemas": dts.external,
            "relationshipStats": {
                "rawArcs": lb.raw_count,
                "prohibitedGroups": lb.prohibited_count,
                "presentationArcs": by_kind("presentationArc"),
                "calculationArcs": by_kind("calculationArc"),
                "definitionArcs": len(def_arcs),
                "all": count_role(ARC.all),
                "notAll": count_role(ARC.not_all),
                "dimensionDefault": count_role(ARC.dim_default),
                "hypercubeDimension": count_role(ARC.hc_dim),
            },
            "annexureCrossCheck": None,
            # Checked replacements that reproduce the taxonomy copy of the MCA XBRL Validator (test-side XSD checks)
            "validatorPatches": [{"file": p.file, "reason": p.reason, "find": p.find, "replace": p.replace} for p in spec.patches],
        },
        "namespaces": sort_obj(schema.namespaces),
        "types": sort_obj(schema.types),
        "roles": sort_obj({u: {**r, "code": role_code(u)} for u, r in schema.roles.items()}),
        "concepts": concepts,
        "elrs": elrs,
        "conceptElrs": sort_obj(concept_elrs),
        "presentation": presentation,
        "calculation": calculation,
        "definition": definition,
        "dimensionDefaults": sort_obj(dim["defaults"]),
        "hypercubes": sort_obj(dim["hypercubes"]),
        "conceptHypercubes": sort_obj(dim["conceptHypercubes"]),
        "tables": dim["tables"],
    }


def _dumps(data) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def write(spec: TaxonomySpec, out: Path | None = None) -> dict:
    authority = build(spec)
    target = out or spec.output
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(_dumps(authority), encoding="utf-8")
    return authority
