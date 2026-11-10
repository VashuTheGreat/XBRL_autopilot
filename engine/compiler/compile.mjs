// Authority compiler: MCA source package -> canonical MCA authority model.
//   MCA_AUTHORITY.json
//   BUSINESS_RULE_COVERAGE.json
// Deterministic: identical inputs produce byte-identical outputs.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDTS, parseSchemas, parseLinkbases, ARC } from './dts.mjs';
import { buildDimensionalModel } from './tables.mjs';
import { compileBusinessRules } from './rule-formalizer.mjs';
import { ensureTaxonomy, REPO_ROOT, VALIDATOR_PATCHES } from './taxonomy-source.mjs';

export const COMPILER_VERSION = '1.0.0';
const HERE = path.dirname(fileURLToPath(import.meta.url)); // engine/compiler
const ROOT = path.resolve(HERE, '..');                       // engine/
// Optional evidence/approval files (golden-DIVERGENCES.json, APPROVED_LIMITATIONS.json) and reference documents
// (Annexure II text export, Filing Manual pdf) live next to the compiler; all are optional.
const SRC = HERE;
const OUT = path.join(ROOT, 'authority');                    // ci-2016.authority.json + ci-2016.coverage.json (generated, git-ignored)
export const AUTHORITY_FILE = path.join(OUT, 'ci-2016.authority.json');
export const COVERAGE_FILE = path.join(OUT, 'ci-2016.coverage.json');
// The MCA business-rule workbook, as published (repo data/).
export const RULES_WORKBOOK = path.join(REPO_ROOT, 'data', 'c&I taxonomy',
  'Final Business Rules based on XBRL C and I Taxonomy 2016 V1.3@06-08-2016', 'Final_Business_Rule_C&I_Taxonomy_2016_V1.3.xls');
const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');

// v14.6: the MCA XBRL Validator (V3) refuses the V2 address that Filing Manual v4.0 §1.3.1(1) prescribes
// ("Incorrect schema reference. Please use new schema URL: https://www.mca.gov.in/V3XBRL/ instead of V2 Schema URL:
// http://www.mca.gov.in/XBRL/ in all taxonomies (C&I), (IND-AS), and (Costing)"); the MCA-validated reference
// instances use the V3 address. Only the V3 address is accepted; an instance with the V2 one is written with V3.
const SCHEMA_REF = 'https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd';
const SCHEMA_REF_SOURCE = 'MCA XBRL Validator V3 ("Please use new schema URL: https://www.mca.gov.in/V3XBRL/ instead of V2 Schema URL: http://www.mca.gov.in/XBRL/"); replaces the V2 address of Filing Manual CNI v4.0 §1.3.1(1)';
export const RETIRED_SCHEMA_REFS = ['http://www.mca.gov.in/XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd'];
const CIN_SCHEME = 'http://www.mca.gov.in/CIN'; // §1.3.1(2)

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function roleCodeFactory(roles) {
  return (uri) => {
    const d = roles[uri]?.definition || '';
    const m = /^\[([0-9]{6}[a-z]?)\]/.exec(d);
    return m ? m[1] : uri.split('/').slice(-2).join('/');
  };
}

export function compile() {
  const entry = path.join(ensureTaxonomy(), 'in-ci-ent-2016-03-31.xsd');
  const dts = loadDTS(entry);
  const schema = parseSchemas(dts);
  const lb = parseLinkbases(dts, schema);
  const roleCode = roleCodeFactory(schema.roles);

  // ---- concepts (+ labels, references) ----
  const concepts = {};
  for (const [qn, c] of Object.entries(schema.concepts).sort(([a], [b]) => a.localeCompare(b))) {
    const kind = classify(c);
    const out = { ...c, kind, labels: lb.labels[qn] || {} };
    delete out.id;
    if (lb.references[qn]) out.references = lb.references[qn];
    concepts[qn] = out;
  }

  // ---- relationships per ELR ----
  const byKind = (k) => lb.arcs.filter((a) => a.kind === k);
  const group = (arcs, pick) => {
    const g = {};
    for (const a of arcs) (g[a.elr] ||= []).push(pick(a));
    for (const v of Object.values(g)) v.sort((x, y) => (x.from === y.from ? x.order - y.order : x.from.localeCompare(y.from)) || x.to.localeCompare(y.to));
    return sortObj(g);
  };
  const presentation = group(byKind('presentationArc'), (a) => strip({ from: a.from, to: a.to, order: a.order, preferredLabel: a.preferredLabel }));
  const calculation = group(byKind('calculationArc'), (a) => ({ from: a.from, to: a.to, weight: a.weight, order: a.order }));
  const defArcs = byKind('definitionArc');
  const definition = group(defArcs, (a) => strip({ arcrole: a.arcrole.split('/').pop(), from: a.from, to: a.to, order: a.order, targetRole: a.targetRole, closed: a.closed, contextElement: a.contextElement, usable: a.usable }));

  // ---- ELRs (presentation roles are the user-facing statements/notes) ----
  const elrs = Object.keys(presentation).map((uri) => {
    const arcs = presentation[uri];
    const tos = new Set(arcs.map((a) => a.to));
    const roots = [...new Set(arcs.map((a) => a.from))].filter((f) => !tos.has(f));
    const r = schema.roles[uri];
    const code = roleCode(uri);
    return { uri, code, title: (r?.definition || '').replace(/^\[[^\]]+\]\s*/, ''), definition: r?.definition || '', roots, group: code.startsWith('1') ? 'Statements' : code.startsWith('4') ? 'Disclosures' : 'Notes' };
  }).sort((a, b) => a.code.localeCompare(b.code));

  // concept -> presentation ELRs (used for ELR-scoped applicability)
  const conceptElrs = {};
  for (const [uri, arcs] of Object.entries(presentation)) for (const a of arcs) for (const q of [a.from, a.to]) {
    const s = (conceptElrs[q] ||= []);
    if (!s.includes(uri)) s.push(uri);
  }
  for (const v of Object.values(conceptElrs)) v.sort();

  // ---- dimensional model ----
  const dim = buildDimensionalModel({ defArcs, concepts: schema.concepts, roleCode });
  // map each table to the presentation ELR in which its hypercube is presented
  for (const t of dim.tables) {
    const pres = (conceptElrs[t.hypercube] || []);
    t.presentationElr = pres[0] || elrs.find((e) => e.code === t.code.replace(/[a-z]$/, ''))?.uri || null;
    t.presentationCode = elrs.find((e) => e.uri === t.presentationElr)?.code || null;
  }
  dim.tables.sort((a, b) => a.id.localeCompare(b.id));

  // ---- cross-check against Annexure II workbook ELR sheet (reference only) ----
  const annexurePath = path.join(SRC, 'Annexure_II_Main_Taxonomy_V2.xls.txt');
  const annexure = existsSync(annexurePath) ? crossCheckAnnexure(annexurePath, elrs) : null;

  // ---- business rules ----
  // Prefer the original workbook (complete); fall back to the text export (may be truncated).
  if (!existsSync(RULES_WORKBOOK)) throw new Error(`Business-rule workbook not found: ${RULES_WORKBOOK}`);
  const rulesFile = RULES_WORKBOOK;
  const partial = { concepts, elrs, types: schema.types, tables: dim.tables, defaults: dim.defaults, presentation, conceptElrs, hypercubes: dim.hypercubes, conceptHypercubes: dim.conceptHypercubes };
  const br = compileBusinessRules(rulesFile, partial);

  // ---- provenance ----
  const sources = [...dts.files.values()].map((f) => ({ file: '.taxonomy/Taxonomy-2016-03-31/' + f.rel, kind: f.kind, sha256: f.sha256, bytes: f.bytes })).sort((a, b) => a.file.localeCompare(b.file));
  sources.push({ file: rel(rulesFile), kind: 'authority-document', sha256: sha(rulesFile) });
  for (const extra of ['Annexure_II_Main_Taxonomy_V2.xls.txt', 'Filing_Manual_CNI_V4.0.pdf']) {
    if (existsSync(path.join(SRC, extra))) sources.push({ file: 'engine/compiler/' + extra, kind: 'authority-document', sha256: sha(path.join(SRC, extra)) });
  }
  for (const p of VALIDATOR_PATCHES) {
    sources.push({ file: 'validator-patch:' + p.file, kind: 'validator-patch', reason: p.reason, sha256: createHash('sha256').update(p.find + '\u0000' + p.replace).digest('hex') });
  }
  // evidence from MCA-validated reference instances (golden-DIVERGENCES.json)
  const divPath = path.join(SRC, 'golden-DIVERGENCES.json');
  const divergences = existsSync(divPath) ? JSON.parse(readFileSync(divPath, 'utf8')) : { schemaRefs: [], rules: [] };
  if (existsSync(divPath)) sources.push({ file: 'engine/compiler/golden-DIVERGENCES.json', kind: 'reference-evidence', sha256: sha(divPath) });
  for (const d of divergences.rules) {
    const r = br.model.rules.find((x) => x.id === d.ruleId);
    if (!r) throw new Error(`DIVERGENCES.json references unknown rule ${d.ruleId}`);
    const c = br.coverage.rules.find((x) => x.ruleId === d.ruleId);
    // v15.1: evidence about some elements of a mandatory-line-items rule only — those elements are reported as a
    // warning; the rule stays blocking for its other elements
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
  // UNIMPLEMENTED and is shown as "APPROVED LIMITATION / NOT EXECUTED" — never executed, never PASS
  const limPath = path.join(SRC, 'APPROVED_LIMITATIONS.json');
  const limitations = existsSync(limPath) ? JSON.parse(readFileSync(limPath, 'utf8')).limitations || [] : [];
  if (existsSync(limPath)) sources.push({ file: 'engine/compiler/APPROVED_LIMITATIONS.json', kind: 'release-owner-approvals', sha256: sha(limPath) });
  for (const l of limitations.filter((x) => x.kind === 'rule' && x.approved === true)) {
    const r = br.model.rules.find((x) => x.id === l.id);
    if (!r || r.status !== 'UNIMPLEMENTED') throw new Error(`APPROVED_LIMITATIONS.json approves ${l.id}, which is not an UNIMPLEMENTED rule`);
    r.approvedLimitation = { approvedBy: l.approvedBy || null, description: l.description };
    br.coverage.rules.find((x) => x.ruleId === l.id).approvedLimitation = 'APPROVED LIMITATION / NOT EXECUTED';
  }
  const authorityHash = createHash('sha256').update(JSON.stringify(sources)).digest('hex');

  const authority = {
    meta: {
      name: 'MCA C&I Taxonomy 2016 authority model',
      taxonomyVersion: 'Indian C&I General Purpose Taxonomy 2016-03-31 Ver 1.0',
      entryPoint: 'in-ci-ent-2016-03-31.xsd',
      schemaRef: SCHEMA_REF,
      schemaRefSource: SCHEMA_REF_SOURCE,
      acceptedSchemaRefs: [{ href: SCHEMA_REF, source: SCHEMA_REF_SOURCE }, ...divergences.schemaRefs.filter((x) => x.href !== SCHEMA_REF && !RETIRED_SCHEMA_REFS.includes(x.href)).map((x) => ({ href: x.href, source: x.evidence }))],
      retiredSchemaRefs: RETIRED_SCHEMA_REFS,
      cinScheme: CIN_SCHEME,
      cinSchemeSource: 'Filing Manual CNI v4.0 §1.3.1(2)',
      compilerVersion: COMPILER_VERSION,
      authorityHash,
      sources,
      externalSchemas: dts.external,
      relationshipStats: {
        rawArcs: lb.rawCount, prohibitedGroups: lb.prohibitedCount,
        presentationArcs: byKind('presentationArc').length,
        calculationArcs: byKind('calculationArc').length,
        definitionArcs: defArcs.length,
        all: defArcs.filter((a) => a.arcrole === ARC.all).length,
        notAll: defArcs.filter((a) => a.arcrole === ARC.notAll).length,
        dimensionDefault: defArcs.filter((a) => a.arcrole === ARC.dimDefault).length,
        hypercubeDimension: defArcs.filter((a) => a.arcrole === ARC.hcDim).length,
      },
      annexureCrossCheck: annexure,
    },
    namespaces: sortObj(schema.namespaces),
    types: sortObj(schema.types),
    roles: sortObj(Object.fromEntries(Object.entries(schema.roles).map(([u, r]) => [u, { ...r, code: roleCode(u) }]))),
    concepts,
    elrs,
    conceptElrs: sortObj(conceptElrs),
    presentation,
    calculation,
    definition,
    dimensionDefaults: sortObj(dim.defaults),
    hypercubes: sortObj(dim.hypercubes),
    conceptHypercubes: sortObj(dim.conceptHypercubes),
    tables: dim.tables,
    businessRules: br.model,
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(AUTHORITY_FILE, JSON.stringify(authority));
  writeFileSync(COVERAGE_FILE, JSON.stringify(br.coverage, null, 1));
  return { authority, coverage: br.coverage };
}

function classify(c) {
  const sg = c.substitutionGroup || '';
  if (sg === 'xbrldt:hypercubeItem') return 'hypercube';
  if (sg === 'xbrldt:dimensionItem') return c.typedDomainRef ? 'typedAxis' : 'explicitAxis';
  if (!c.type) return 'typedDomain';
  if (c.type === 'nonnum:domainItemType') return 'member';
  if (c.abstract) return 'abstract';
  return 'item';
}
function strip(o) { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k]; return o; }
function sortObj(o) { return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))); }

function crossCheckAnnexure(file, elrs) {
  const text = readFileSync(file, 'utf8');
  const sec = text.split('## Sheet: ')[1] || '';
  const names = sec.split('\n').map((l) => l.split('\t')[2]).filter((x) => x && /^\[\d{6}/.test(x)).map((x) => x.trim());
  const codes = new Set(names.map((n) => n.slice(1, 7)));
  const taxCodes = new Set(elrs.map((e) => e.code.slice(0, 6)));
  return {
    source: 'Annexure_II_Main_Taxonomy_V2 (ELR sheet)',
    annexureElrCount: names.length,
    presentationElrCount: elrs.length,
    inAnnexureNotInTaxonomy: [...codes].filter((c) => !taxCodes.has(c)).sort(),
    inTaxonomyNotInAnnexure: [...taxCodes].filter((c) => !codes.has(c)).sort(),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const t0 = Date.now();
  const { authority, coverage } = compile();
  const s = authority.meta.relationshipStats;
  console.log(`concepts=${Object.keys(authority.concepts).length} elrs=${authority.elrs.length} tables=${authority.tables.length} all=${s.all} notAll=${s.notAll} defaults=${s.dimensionDefault} calcArcs=${s.calculationArcs}`);
  console.log('rule coverage:', JSON.stringify(coverage.summary));
  const c = coverage.corpus;
  console.log(`rule source: ${c.sourceFile} (${c.sourceForm})`);
  for (const sh of c.sheets) console.log(`  sheet "${sh.name}": ${sh.rows} rows${sh.truncated ? '  ** TRUNCATED **' : ''}`);
  console.log(`specific-rule rows=${c.specificRuleRows} generic rules=${c.genericRuleCount} mandatory-line-item rows=${c.mandatoryLineItemRows}`);
  console.log(`first ELR=${c.firstElrInSpecificRules} last ELR=${c.lastElrInSpecificRules}`);
  console.log(`specificRulesSheetTruncated=${c.specificRulesSheetTruncated}`);
  console.log(`done in ${Date.now() - t0}ms`);
}
