// Business-rule compiler (ADR-0010).
//
// The taxonomy half of the engine authority (concepts, ELRs, networks, dimensional model) is built by the Python
// ingestion from the official MCA files (`make rebuild`, src/services/engine_authority) and served by the sidecar
// route GET /api/v1/taxonomies/{id}/authority. This script compiles the MCA business-rule workbook against that
// build and writes:
//   authority/ci-2016.rules.json      rule model + provenance, tied to the taxonomy build by meta.taxonomyHash
//   authority/ci-2016.coverage.json   rule coverage ledger
//   authority/ci-2016.authority.json  taxonomy + rules joined (assembleAuthority), for tests and tools
// Deterministic: identical inputs produce byte-identical outputs. Phase 9 moves the rule formalizer to Python.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBusinessRules } from './rule-formalizer.mjs';
import { assembleAuthority } from '../src/core/authority-bundle.js';

export const COMPILER_VERSION = '2.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url)); // engine/compiler
const ROOT = path.resolve(HERE, '..'); // engine/
export const REPO_ROOT = path.resolve(ROOT, '..');
const OUT = path.join(ROOT, 'authority');
export const TAXONOMY_AUTHORITY_FILE = path.join(REPO_ROOT, 'knowledge_base', 'ci_engine_authority.json');
export const RULES_FILE = path.join(OUT, 'ci-2016.rules.json');
export const AUTHORITY_FILE = path.join(OUT, 'ci-2016.authority.json');
export const COVERAGE_FILE = path.join(OUT, 'ci-2016.coverage.json');
// The MCA business-rule workbook, as published (repo data/).
export const RULES_WORKBOOK = path.join(REPO_ROOT, 'data', 'c&I taxonomy',
  'Final Business Rules based on XBRL C and I Taxonomy 2016 V1.3@06-08-2016', 'Final_Business_Rule_C&I_Taxonomy_2016_V1.3.xls');
const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const shaText = (s) => createHash('sha256').update(s).digest('hex');

export function loadTaxonomyAuthority(file = TAXONOMY_AUTHORITY_FILE) {
  if (!existsSync(file)) throw new Error(`Taxonomy authority not found: ${file}. Build it with "make rebuild" (or uv run python -m src.ingestion.build_engine_authorities).`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function compile() {
  const taxonomy = loadTaxonomyAuthority();
  if (!existsSync(RULES_WORKBOOK)) throw new Error(`Business-rule workbook not found: ${RULES_WORKBOOK}`);
  const partial = {
    concepts: taxonomy.concepts, elrs: taxonomy.elrs, types: taxonomy.types, tables: taxonomy.tables, defaults: taxonomy.dimensionDefaults,
    presentation: taxonomy.presentation, conceptElrs: taxonomy.conceptElrs, hypercubes: taxonomy.hypercubes, conceptHypercubes: taxonomy.conceptHypercubes,
  };
  const br = compileBusinessRules(RULES_WORKBOOK, partial);

  const sources = [{ file: rel(RULES_WORKBOOK), kind: 'authority-document', sha256: sha(RULES_WORKBOOK) }];
  for (const extra of ['Annexure_II_Main_Taxonomy_V2.xls.txt', 'Filing_Manual_CNI_V4.0.pdf']) {
    if (existsSync(path.join(HERE, extra))) sources.push({ file: 'engine/compiler/' + extra, kind: 'authority-document', sha256: sha(path.join(HERE, extra)) });
  }
  // evidence from MCA-validated reference instances (golden-DIVERGENCES.json)
  const divPath = path.join(HERE, 'golden-DIVERGENCES.json');
  const divergences = existsSync(divPath) ? JSON.parse(readFileSync(divPath, 'utf8')) : { schemaRefs: [], rules: [] };
  if (existsSync(divPath)) sources.push({ file: 'engine/compiler/golden-DIVERGENCES.json', kind: 'reference-evidence', sha256: sha(divPath) });
  for (const d of divergences.rules) {
    const r = br.model.rules.find((x) => x.id === d.ruleId);
    if (!r) throw new Error(`DIVERGENCES.json references unknown rule ${d.ruleId}`);
    const c = br.coverage.rules.find((x) => x.ruleId === d.ruleId);
    // evidence about some elements of a mandatory-line-items rule only: those elements are reported as a warning;
    // the rule stays blocking for its other elements
    if (d.concepts) {
      if (r.ast?.type !== 'lineItemsMandatory' || d.concepts.some((q) => !r.ast.concepts.includes(q))) throw new Error(`DIVERGENCES.json: ${d.ruleId} has no such mandatory elements ${d.concepts.join(', ')}`);
      r.ast.softConcepts = d.concepts; r.softEvidence = d.evidence;
      c.softConcepts = d.concepts; c.divergence = d.evidence;
      continue;
    }
    r.severity = 'WARNING';
    r.divergence = d.evidence;
    c.severity = 'WARNING'; c.divergence = d.evidence;
  }
  // release-owner approvals of known limitations (APPROVED_LIMITATIONS.json): an approved UNIMPLEMENTED rule stays
  // UNIMPLEMENTED and is shown as "APPROVED LIMITATION / NOT EXECUTED": never executed, never PASS
  const limPath = path.join(HERE, 'APPROVED_LIMITATIONS.json');
  const limitations = existsSync(limPath) ? JSON.parse(readFileSync(limPath, 'utf8')).limitations || [] : [];
  if (existsSync(limPath)) sources.push({ file: 'engine/compiler/APPROVED_LIMITATIONS.json', kind: 'release-owner-approvals', sha256: sha(limPath) });
  for (const l of limitations.filter((x) => x.kind === 'rule' && x.approved === true)) {
    const r = br.model.rules.find((x) => x.id === l.id);
    if (!r || r.status !== 'UNIMPLEMENTED') throw new Error(`APPROVED_LIMITATIONS.json approves ${l.id}, which is not an UNIMPLEMENTED rule`);
    r.approvedLimitation = { approvedBy: l.approvedBy || null, description: l.description };
    br.coverage.rules.find((x) => x.ruleId === l.id).approvedLimitation = 'APPROVED LIMITATION / NOT EXECUTED';
  }

  const taxonomyHash = taxonomy.meta.taxonomyHash;
  const rulesHash = shaText(JSON.stringify(sources) + '\u0000' + COMPILER_VERSION);
  const rules = {
    meta: {
      taxonomyId: taxonomy.meta.taxonomyId,
      taxonomyHash,
      rulesHash,
      authorityHash: shaText(taxonomyHash + '\u0000' + rulesHash),
      compilerVersion: COMPILER_VERSION,
      sources,
      acceptedSchemaRefs: divergences.schemaRefs
        .filter((x) => !taxonomy.meta.retiredSchemaRefs.includes(x.href))
        .map((x) => ({ href: x.href, source: x.evidence })),
    },
    businessRules: br.model,
  };
  const authority = assembleAuthority(taxonomy, rules);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(RULES_FILE, JSON.stringify(rules));
  writeFileSync(AUTHORITY_FILE, JSON.stringify(authority));
  writeFileSync(COVERAGE_FILE, JSON.stringify(br.coverage, null, 1));
  return { authority, rules, coverage: br.coverage };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const t0 = Date.now();
  const { authority, coverage } = compile();
  const s = authority.meta.relationshipStats;
  console.log(`taxonomy ${authority.meta.taxonomyId} ${authority.meta.taxonomyHash.slice(0, 12)}: concepts=${Object.keys(authority.concepts).length} elrs=${authority.elrs.length} tables=${authority.tables.length} all=${s.all} notAll=${s.notAll}`);
  console.log('rule coverage:', JSON.stringify(coverage.summary));
  const c = coverage.corpus;
  console.log(`rule source: ${c.sourceFile} (${c.sourceForm})`);
  for (const sh of c.sheets) console.log(`  sheet "${sh.name}": ${sh.rows} rows${sh.truncated ? '  ** TRUNCATED **' : ''}`);
  console.log(`specific-rule rows=${c.specificRuleRows} generic rules=${c.genericRuleCount} mandatory-line-item rows=${c.mandatoryLineItemRows}`);
  console.log(`done in ${Date.now() - t0}ms`);
}
