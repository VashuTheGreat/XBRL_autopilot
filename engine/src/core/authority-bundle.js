// Joins the two halves of an engine authority (ADR-0010):
//   * the taxonomy authority (concepts, ELRs, networks, dimensional model), built by the Python ingestion from the
//     official MCA taxonomy and served by GET /api/v1/taxonomies/{id}/authority;
//   * the business-rule model (rule ASTs, exemptions, applicability), compiled by engine/compiler from the MCA rule
//     workbook against that same taxonomy build. Phase 9 moves the rules into the knowledge base as well.
// A taxonomy without compiled rules (Ind AS for now) gets an empty rule model: facts, XML and the structural gate
// work, the MCA business rules don't run.

export class AuthorityMismatchError extends Error {
  constructor(message) { super(message); this.name = 'AuthorityMismatchError'; }
}

export function emptyRuleModel() {
  return {
    rules: [],
    exemptions: { parentMember: [], childMember: [], calculation: [] },
    countries: [],
    applicableElrs: [],
    tableApplicability: {},
    booleanDependencies: [],
    corpus: null,
  };
}

/**
 * @param {object} taxonomy taxonomy authority JSON (meta.taxonomyHash identifies the build)
 * @param {object|null} rules rule bundle `{ meta: { taxonomyHash, authorityHash, sources, … }, businessRules }`
 * @returns {Record<string, any>} authority JSON for `new Authority(json)`
 */
export function assembleAuthority(taxonomy, rules = null) {
  const taxonomyHash = taxonomy?.meta?.taxonomyHash;
  if (!taxonomyHash) throw new AuthorityMismatchError('The taxonomy authority has no meta.taxonomyHash; rebuild it (make rebuild).');
  if (!rules) {
    return { ...taxonomy, meta: { ...taxonomy.meta, authorityHash: taxonomyHash, rulesHash: null }, businessRules: emptyRuleModel() };
  }
  if (rules.meta?.taxonomyHash !== taxonomyHash) {
    throw new AuthorityMismatchError(
      `The business rules were compiled against another build of ${taxonomy.meta.taxonomyId ?? 'the taxonomy'} ` +
      `(${String(rules.meta?.taxonomyHash).slice(0, 12)} ≠ ${taxonomyHash.slice(0, 12)}). Run "make engine-rules" (ADR-0011).`,
    );
  }
  const { sources: ruleSources = [], acceptedSchemaRefs = [], authorityHash, rulesHash, compilerVersion } = rules.meta;
  const accepted = [...taxonomy.meta.acceptedSchemaRefs];
  for (const r of acceptedSchemaRefs) if (!accepted.some((x) => x.href === r.href)) accepted.push(r);
  return {
    ...taxonomy,
    meta: {
      ...taxonomy.meta,
      acceptedSchemaRefs: accepted,
      sources: [...taxonomy.meta.sources, ...ruleSources],
      rulesCompilerVersion: compilerVersion ?? null,
      rulesHash,
      authorityHash,
    },
    businessRules: rules.businessRules,
  };
}
