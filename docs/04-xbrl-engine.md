# 04 · XBRL engine (`engine/`, package `@xap/engine`)

The engine is the deterministic core. It is a pure TypeScript library with no Electron, network or AI dependencies. It runs inside Electron (main / utilityProcess) and in Vitest. It is a **port of `lagacy_js/`**, which is a tested C&I 2016 tool, generalised so other taxonomies can be added.

## Current state (2026-11-10)
- **Step 1 is done: a behaviour-preserving import.**
  - The legacy runtime modules live unchanged in `engine/src/core/*.js`, with one JSDoc annotation on `Session`.
  - `engine/src/index.ts` is the typed public entry point. With `allowJs`, TypeScript infers the core's types.
  - The compiler lives in `engine/compiler/*.mjs`, and the legacy tests in `engine/test/legacy/` (run with `node:test`).
- **Step 2 is next: convert `src/core/*.js` to TS one module at a time.**
  - Start with the leaves: decimal, periods, units, scaling, dates, dimensions, then up the import graph.
  - After each module, `pnpm --filter @xap/engine test` must stay green.
- **Not ported:**
  - `app.js`, `shell.html`, `styles.css`, `build.mjs`, `browser-smoke.mjs`: the legacy UI.
  - `excel-import.js` and its test: SheetJS-based browser import; layout analysis moves to the Python sidecar (06).
  - `xml-errors-v144.test`: it reads the legacy UI source.
  - `release-gate.mjs`.

### Layout
```
engine/
  src/index.ts            typed public API (re-exports the core)
  src/core/*.js           runtime: model, session, rules, gate, generator, importer, …
  compiler/*.mjs          authority compiler (DTS loader, tables, rule formalizer, taxonomy source)
  compiler/golden-DIVERGENCES.json   rules downgraded to WARNING by MCA-accepted evidence (see below)
  compiler/APPROVED_LIMITATIONS.json release-owner approvals (none approved)
  authority/              generated: ci-2016.authority.json (~6 MB), ci-2016.coverage.json (git-ignored)
  .taxonomy/              generated working copy of the taxonomy with validator patches (git-ignored)
  test/*.test.ts          vitest (facade)
  test/legacy/*.test.mjs  node:test (ported legacy suite)
  test/fixtures/golden/   put MCA-validated golden-*.xml here to enable ~50 skipped regression tests
```

### Commands
```bash
pnpm --filter @xap/engine compile:authority   # data/ → authority/ci-2016.*.json (~2.5 s)
pnpm --filter @xap/engine test                # vitest + legacy suite (needs the compiled authority)
```
Results on 2026-11-10:
- **Compiler:** 962 executable rules, 48 review-only (they need MCA21 master data), 153 not applicable, 1 unimplemented (ML-20-b).
- **Legacy suite:** 284 tests, 220 pass, 0 fail, 64 skipped:
  - ~50 need `golden-*.xml`
  - 7 need Arelle
  - 2 need the workbook text export
  - the rest are skipped by the tests themselves

### Differences from `lagacy_js` (deliberate)
| Area | Legacy | Now |
|---|---|---|
| Taxonomy source | `Final_C_and_I_Taxonomy_2016_V1.2.zip` + validator zip | Extracted package in `data/c&I taxonomy/…`, copied to `engine/.taxonomy/` |
| Validator taxonomy update | Taken from the MCA validator's `Taxonomy-2016-03-31.zip` | **Explicit checked patch** (`VALIDATOR_PATCHES` in `compiler/taxonomy-source.mjs`): the second `SRNNumber` pattern `[A-Z][A-Z][0-9]{7}` (MCA V3 SRN). It fails loudly if the source text changes |
| Rule workbook | Repo root | `data/c&I taxonomy/Final Business Rules …/Final_Business_Rule_C&I_Taxonomy_2016_V1.3.xls` (`RULES_WORKBOOK`) |
| Annexure II / Filing Manual hashing | Required | Optional (`engine/compiler/`); `meta.annexureCrossCheck` is `null` when absent |
| Outputs | `MCA_AUTHORITY.json`, `BUSINESS_RULE_COVERAGE.json` | `authority/ci-2016.authority.json`, `authority/ci-2016.coverage.json` |
| `rule-formalizer` source file name | `split('/')` | `split(/[\/]/)`, so it works on Windows |

### Evidence files: reconstructed ⚠️
The original `golden-DIVERGENCES.json`, `APPROVED_LIMITATIONS.json` and the MCA-validated reference instances (`golden-FILING-A/B_2024-25.xml`) were **never committed** to `lagacy_js`.
- `golden-DIVERGENCES.json` was **reconstructed from what the legacy tests assert**. It downgrades these rules to WARNING:
  - SR-L2116-1
  - SR-L3996-1 and CH-4 (`NameOfMainProductOrService`)
  - SR-L4140-1
  - ML-41: the board-approval-dates element only
- Each entry says it was reconstructed.
- **Ask whoever wrote `lagacy_js` for the originals.** Then replace the file and drop the golden XMLs into `engine/test/fixtures/golden/`.

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
