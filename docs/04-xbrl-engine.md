# 04 · XBRL engine (`engine/`, package `@xap/engine`)

The engine is the deterministic core. It is a pure TypeScript library with no Electron, network or AI dependencies. It runs inside Electron (main / utilityProcess) and in Vitest. It is a **port of `lagacy_js/`**, which is a tested C&I 2016 tool, generalised so other taxonomies can be added.

## Concepts
- **Authority:** a compiled, executable taxonomy for one taxonomy version. It contains:
  - concepts: type, periodType, balance, labels
  - ELRs: statements and notes, with presentation trees
  - tables, hypercubes, axes, domains and members; dimension defaults
  - calculation networks
  - business rules, compiled into rule ASTs
  - `schemaRef`
  
  Produced offline by `engine/compiler` from `data/…`, and stored at `engine/authority/<id>.json`.
- **Filing:** the facts store, keyed by `concept#period#dims`. Each fact holds `{concept, period, dims[], value (canonical string), nil, decimals, unit, lang, origin, source}`, plus meta (company, CIN, periods, rounding, report type), footnotes, and set-aside (hidden) data.
- **Session:** the controller over Filing + Authority. Every write enforces applicability and dimension validity, recalculates derived cells, and tracks dirty state.

## Porting map (`lagacy_js` → `engine/src`)
| Legacy file | TS module | Notes |
|---|---|---|
| `decimal.js` | `decimal.ts` | BigInt exact decimal; **all money math goes through this** |
| `periods.js`, `dates.js` | `periods.ts`, `dates.ts` | CY/PY, instant/duration, dd-mm-yyyy ↔ ISO |
| `units.js`, `scaling.js` | `units.ts`, `scaling.ts` | INR/shares/pure/INRPerShare; Actual…Crores |
| `model.js` | `model.ts` | `Filing`, `factKey`, `normDims`, `toJSON/fromJSON` |
| `authority.js` | `authority.ts` | Loads compiled authority JSON (no DOM `<script>` read) |
| `dimensions.js` | `dimensions.ts` | Hypercube validity, explicit vs typed members |
| `expr.js` | `expr.ts` | Rule predicate language, `FORMATS` (CIN, PAN, …) |
| `rules.js` | `rules.ts` | `RuleEngine`: PASS/FAIL/WARN/NOT_APPLICABLE/REVIEW_ONLY/UNIMPLEMENTED |
| `calculation.js` | `calculation.ts` | Calculation linkbase checks (Calculations 1.1 rounding) |
| `applicability.js` | `applicability.ts` | Which ELRs/tables apply (standalone/consolidated, CY/PY, cash-flow method) |
| `gate.js` | `gate.ts` | Pre-export gate, issue codes, `locate()` |
| `generator.js` | `generator.ts` | `generateInstance()`, deterministic contexts/units/facts/footnotes |
| `importer.js` | `importer.ts` | Read an existing instance (any vendor) back into a Filing |
| `fixes.js` | `fixes.ts` | Deterministic quick fixes |
| `richtext.js` | `richtext.ts` | Editor HTML ↔ MCA HTML subset |
| `mca-errors.js` | `mca-errors.ts` | Parse and explain MCA validator error text |
| `derived.js`, `totals-fill.js` | `derived.ts` | Carrying amounts, roll-forwards, totals |
| `views.js`, `member-hints.js`, `mandatory-marks.js` | `views.ts` | ELR/table view model for the XBRL Form grid |
| `carry-forward.js`, `upkeep.js`, `compare.js` | `carry-forward.ts`, `compare.ts` | Next-year prep, compare with the filed version |
| `footnotes.js` | `footnotes.ts` | Footnote CRUD |
| `pdf-preview.js` | `preview.ts` | HTML preview; PDF through Electron `printToPDF` |
| `session.js` | `session.ts` | Controller API used by the UI |
| `dts.mjs`, `tables.mjs`, `taxonomy-source.mjs`, `rules-source.mjs`, `rule-formalizer.mjs`, `compile.mjs` | `compiler/*` | Offline build tooling; paths rewired to `data/c&I taxonomy/…`; Annexure/manual hashing made optional |
| `app.js`, `shell.html`, `styles.css`, `workspace.js`, `build.mjs` | — | **Not ported.** Replaced by React UI and Node `fs` |
| `*.test.mjs` | `test/*.test.ts` | Ported to Vitest as each module is ported |

**Porting rules:**
1. Port the behaviour first and refactor later. Keep the function names so the legacy tests port almost verbatim.
2. Add strict types at module boundaries (`Fact`, `Issue`, `RuleAst`, `AuthorityJson`).
3. Any port that changes behaviour gets a note here and a test.

## Public API (target)
```ts
import { loadAuthority, Session, generateInstance, importInstance, explainMcaErrors } from '@xap/engine'

const authority = loadAuthority(json)            // compiled authority
const s = new Session(authority, filingJson?)    // new or restored filing
s.setValue({ concept, period: 'cy', dims: [] }, '1234.56')
const issues = s.validate()                      // Issue[] {code, severity, message, location, fixes[]}
s.applyFix(issue.fixes[0])
const xml = s.exportXml()                        // throws GateError if blocking issues (unless force)
s.toJSON()                                        // → filing.json
```

## Determinism guarantees
- The same Filing and Authority always produce byte-identical XML: stable context ids (`D2026`, `I2026` + FNV hash for dims), CY before PY, sorted facts.
- `decimals` is always set and `precision` is never used. The CIN scheme `http://www.mca.gov.in/CIN` is used in every context.

## Authority compilation
```bash
pnpm --filter @xap/engine compile:authority -- --taxonomy ci-2016
```
- **Reads:** `data/c&I taxonomy/Final C and I Taxonomy 2016 V1.2@31-03-2016/…` (the DTS) and `…/Final Business Rules … 2016 V1.3…/*.xls`.
- **Writes:** `engine/authority/ci-2016.json` and `engine/authority/ci-2016.coverage.json` (the rule coverage ledger).
- **The Python knowledge base is separate.** `knowledge_base/ci_knowledge_base.json`, built by the Python ingestion, is for AI retrieval. The two are compared in [05-validation](05-validation.md).
