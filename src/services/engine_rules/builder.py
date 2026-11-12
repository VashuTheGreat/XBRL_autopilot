"""Builds ``knowledge_base/<kb>_engine_rules.json`` and ``<kb>_rule_coverage.json`` (ADR-0011).

The rule model is tied to the taxonomy build by ``meta.taxonomyHash``; the engine's ``assembleAuthority`` refuses
rules built against another build. Curated exceptions (``curation/<kb>/``) are applied after formalization, each
with its evidence. Deterministic: identical inputs give byte-identical files.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from src.constants import BASE_DIR
from src.services.engine_rules.formalizer import FormalizerConfig, compile_business_rules
from src.services.engine_rules.model import strip_undef
from src.services.engine_rules.report import coverage_markdown
from src.services.engine_rules.specs import RuleSpec

COMPILER_VERSION = "3.0.0"  # 2.x was the TypeScript compiler (engine/compiler, retired by ADR-0011)


def _rel(p: Path) -> str:
    return p.resolve().relative_to(BASE_DIR.resolve()).as_posix()


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _sha_text(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def dumps(x) -> str:
    """``JSON.stringify(x)``."""
    return json.dumps(x, ensure_ascii=False, separators=(",", ":"))


def load_curation(spec: RuleSpec) -> tuple[dict, list[dict], list[dict]]:
    """(divergences, limitations, sources) from ``curation/<kb>/`` (both files optional)."""
    sources: list[dict] = []
    div_path = spec.curation_dir / "divergences.json"
    divergences = {"schemaRefs": [], "rules": []}
    if div_path.exists():
        divergences = json.loads(div_path.read_text(encoding="utf-8"))
        sources.append({"file": _rel(div_path), "kind": "reference-evidence", "sha256": _sha(div_path)})
    lim_path = spec.curation_dir / "approved_limitations.json"
    limitations: list[dict] = []
    if lim_path.exists():
        limitations = json.loads(lim_path.read_text(encoding="utf-8")).get("limitations") or []
        sources.append({"file": _rel(lim_path), "kind": "release-owner-approvals", "sha256": _sha(lim_path)})
    return divergences, limitations, sources


def apply_curation(model: dict, coverage: dict, divergences: dict, limitations: list[dict]) -> None:
    by_id = {r["id"]: r for r in model["rules"]}
    cov_by_id = {c["ruleId"]: c for c in coverage["rules"]}
    for d in divergences.get("rules", []):
        r = by_id.get(d["ruleId"])
        if r is None:
            raise ValueError(f"divergences.json references unknown rule {d['ruleId']}")
        c = cov_by_id[d["ruleId"]]
        # evidence about some elements of a mandatory-line-items rule only: those elements are reported as a
        # warning; the rule stays blocking for its other elements
        if d.get("scopes") or (d.get("concepts") and (r.get("ast") or {}).get("type") != "lineItemsMandatory"):
            # evidence about some elements / periods of any rule: only those failures are reported as warnings
            ast = r.get("ast")
            if not ast:
                raise ValueError(f"divergences.json: {d['ruleId']} has no executable form to narrow")
            ast["softFor"] = {k: d[k] for k in ("concepts", "scopes") if d.get(k)}
            r["softEvidence"] = d["evidence"]
            c["softFor"] = ast["softFor"]
            c["divergence"] = d["evidence"]
            continue
        if d.get("concepts"):
            ast = r.get("ast") or {}
            if ast.get("type") != "lineItemsMandatory" or any(q not in ast["concepts"] for q in d["concepts"]):
                raise ValueError(f"divergences.json: {d['ruleId']} has no such mandatory elements {', '.join(d['concepts'])}")
            ast["softConcepts"] = d["concepts"]
            r["softEvidence"] = d["evidence"]
            c["softConcepts"] = d["concepts"]
            c["divergence"] = d["evidence"]
            continue
        r["severity"] = "WARNING"
        r["divergence"] = d["evidence"]
        c["severity"] = "WARNING"
        c["divergence"] = d["evidence"]
    # release-owner approvals of known limitations: an approved UNIMPLEMENTED rule stays UNIMPLEMENTED and is shown
    # as "APPROVED LIMITATION / NOT EXECUTED": never executed, never PASS
    for lim in limitations:
        if lim.get("kind") != "rule" or lim.get("approved") is not True:
            continue
        r = by_id.get(lim["id"])
        if r is None or r["status"] != "UNIMPLEMENTED":
            raise ValueError(f"approved_limitations.json approves {lim['id']}, which is not an UNIMPLEMENTED rule")
        r["approvedLimitation"] = {"approvedBy": lim.get("approvedBy") or None, "description": lim["description"]}
        cov_by_id[lim["id"]]["approvedLimitation"] = "APPROVED LIMITATION / NOT EXECUTED"


def measure(coverage: dict) -> dict:
    """The executable share (ADR-0011): EXECUTABLE ÷ (all rules − NOT_APPLICABLE)."""
    s = coverage["summary"]
    total = sum(s.values())
    not_applicable = s.get("NOT_APPLICABLE", 0)
    denominator = total - not_applicable
    executable = s.get("EXECUTABLE", 0)
    return {
        "definition": "executableShare = EXECUTABLE / (all rules - NOT_APPLICABLE)",
        "rules": total,
        "notApplicable": not_applicable,
        "denominator": denominator,
        "executable": executable,
        "reviewOnly": s.get("REVIEW_ONLY_EXTERNAL_DATA", 0),
        "unimplemented": s.get("UNIMPLEMENTED", 0),
        "approvedLimitations": sum(1 for c in coverage["rules"] if c.get("approvedLimitation")),
        "executableShare": round(executable / denominator, 4) if denominator else None,
    }


def build(spec: RuleSpec) -> tuple[dict, dict]:
    """(rules file content, coverage file content) for one taxonomy."""
    taxonomy = json.loads(spec.authority_file.read_text(encoding="utf-8"))
    cfg = FormalizerConfig(dts=spec.dts, generic=spec.generic, specific_rules=spec.specific_rules, extra_split=spec.extra_split, yes_no_restricts=spec.yes_no_restricts)
    model, coverage = compile_business_rules(spec.workbook, taxonomy, cfg)
    model, coverage = strip_undef(model), strip_undef(coverage)
    divergences, limitations, curation_sources = load_curation(spec)
    apply_curation(model, coverage, divergences, limitations)
    coverage["measure"] = measure(coverage)

    sources = [{"file": _rel(spec.workbook), "kind": "authority-document", "sha256": _sha(spec.workbook)}, *curation_sources]
    tmeta = taxonomy["meta"]
    rules_hash = _sha_text(dumps(sources) + "\u0000" + COMPILER_VERSION)
    rules = {
        "meta": {
            "taxonomyId": tmeta["taxonomyId"],
            "taxonomyHash": tmeta["taxonomyHash"],
            "rulesHash": rules_hash,
            "authorityHash": _sha_text(tmeta["taxonomyHash"] + "\u0000" + rules_hash),
            "compilerVersion": COMPILER_VERSION,
            "sources": sources,
            "acceptedSchemaRefs": [
                {"href": x["href"], "source": x["evidence"]}
                for x in divergences.get("schemaRefs", [])
                if x["href"] not in tmeta.get("retiredSchemaRefs", [])
            ],
        },
        "businessRules": model,
    }
    return rules, coverage


def write(spec: RuleSpec) -> tuple[dict, dict]:
    rules, coverage = build(spec)
    spec.rules_file.write_text(dumps(rules), encoding="utf-8", newline="\n")
    spec.coverage_file.write_text(json.dumps(coverage, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")
    spec.report_file.parent.mkdir(parents=True, exist_ok=True)
    spec.report_file.write_text(coverage_markdown(spec, coverage), encoding="utf-8", newline="\n")
    return rules, coverage
