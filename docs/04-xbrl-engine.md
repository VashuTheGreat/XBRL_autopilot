# 04 · XBRL engine (`engine/`, package `@xap/engine`)

The engine is the deterministic core. It is a pure TypeScript library with no Electron, network or AI dependencies. It runs inside Electron (main / utilityProcess) and in Vitest. It is a **port of `lagacy_js/`**, which is a tested C&I 2016 tool, generalised so other taxonomies can be added.

## Current state (2026-11-10)
- **Step 1 is done: a behaviour-preserving import.**
  - The legacy runtime modules live unchanged in `engine/src/core/*.js`, with one JSDoc annotation on `Session`.
  - `engine/src/index.ts` is the typed public entry point. With `allowJs`, TypeScript infers the core's types.
  - The rule compiler lives in `engine/compiler/*.mjs`, and the legacy tests in `engine/test/legacy/` (run with `node:test`).
- **Phase 6 is done: the taxonomy half of the authority comes from the knowledge base** ([ADR-0010](decisions/ADR-0010-engine-authority-from-knowledge-base.md)).
  - The Python ingestion builds `knowledge_base/ci_engine_authority.json` and `ind_as_engine_authority.json`, which the sidecar serves at `/api/v1/taxonomies/{id}/authority`.
  - The engine joins them with the compiled business rules via `assembleAuthority` (`src/core/authority-bundle.js`).
  - The TS DTS/tables compiler is retired.
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
  src/instance-import.ts   importXbrl (xmldom), canonicalFacts / compareInstanceFacts / verifyRoundTrip (semantic), instanceConventions
  src/core/authority-bundle.js  assembleAuthority(taxonomy, rules|null): joins the two halves (ADR-0010)
  compiler/compile.mjs    business-rule compiler (reads knowledge_base/ci_engine_authority.json + the MCA rule workbook)
  compiler/rule-formalizer.mjs, rules-source.mjs   rule workbook → rule ASTs (moves to Python in Phase 9)
  compiler/taxonomy-source.mjs, xsd-validate.mjs   test-side Arelle XSD check on a patched taxonomy copy
  compiler/golden-DIVERGENCES.json   rules downgraded to WARNING by MCA-accepted evidence (see below)
  compiler/APPROVED_LIMITATIONS.json release-owner approvals (none approved)
  authority/              generated (git-ignored): ci-2016.rules.json (what the app loads), ci-2016.authority.json
                          (taxonomy + rules, for tests/tools), ci-2016.coverage.json
  test/fixtures/ci-2016-example.golden.xml   golden XML of the example filing (TS-compiled authority, 2026-11-10)
  .taxonomy/              generated working copy of the taxonomy with validator patches (git-ignored)
  test/*.test.ts          vitest (facade)
  test/legacy/*.test.mjs  node:test (ported legacy suite)
  test/fixtures/golden/   put MCA-validated golden-*.xml here to enable ~50 skipped regression tests
```

### Commands
```bash
make engine-authority                          # data/ → knowledge_base/*_engine_authority.json (Python, ~8 s; also part of make rebuild)
pnpm --filter @xap/engine compile:authority   # rule workbook + C&I engine authority → authority/ci-2016.*.json (~1 s)
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
| Taxonomy source | `Final_C_and_I_Taxonomy_2016_V1.2.zip` + validator zip | Extracted package in `data/c&I taxonomy/…`, read by the Python builder (`src/services/engine_authority`) |
| Validator taxonomy update | Taken from the MCA validator's `Taxonomy-2016-03-31.zip` | **Explicit checked patch** (`patches` in `src/services/engine_authority/specs.py`, emitted as `meta.validatorPatches`): the second `SRNNumber` pattern `[A-Z][A-Z][0-9]{7}` (MCA V3 SRN). It fails loudly if the source text changes |
| Rule workbook | Repo root | `data/c&I taxonomy/Final Business Rules …/Final_Business_Rule_C&I_Taxonomy_2016_V1.3.xls` (`RULES_WORKBOOK`) |
| Annexure II / Filing Manual hashing | Required | Optional (`engine/compiler/`); `meta.annexureCrossCheck` is `null` when absent |
| Outputs | `MCA_AUTHORITY.json`, `BUSINESS_RULE_COVERAGE.json` | `knowledge_base/ci_engine_authority.json` (taxonomy) + `authority/ci-2016.rules.json`, `authority/ci-2016.coverage.json` |
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
  
  Built in two halves ([ADR-0010](decisions/ADR-0010-engine-authority-from-knowledge-base.md)):
  - the **taxonomy authority**, built by the Python ingestion into `knowledge_base/<kb>_engine_authority.json` and served by the route `/taxonomies/{id}/authority`;
  - the **rule bundle**, built by `engine/compiler` into `engine/authority/<id>.rules.json` (C&I only for now; Ind AS runs with an empty rule model until Phase 9).

  `assembleAuthority(taxonomy, rules)` joins them, and checks that the rules were built against that taxonomy build (`meta.taxonomyHash`).
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

## App-facing helpers (TypeScript, `engine/src`)
- `mandatory-zeros.ts`: `mandatoryZeroPlan(session, elrCode)` / `fillMandatoryZeros(session, elrCode)`. These report a statement's empty, applicable, non-dimensional mandatory **amounts** (executable `mandatory` rules of that ELR) as 0 through `Session.setValue`, with recalculation. It's an explicit user action, never automatic.
- `basics.ts`: `maxDisplayPlaces(level)` / `defaultStatementPlaces(level)` (see [ADR-0009](decisions/ADR-0009-amounts-from-excel.md)). `SHARE_CAPITAL` (from `gate.js`) is exported for the app's actual-value rule.

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
make engine-authority                          # taxonomy half, both taxonomies (Python)
pnpm --filter @xap/engine compile:authority   # rule half, C&I
```
- **Taxonomy half (Python, `src/services/engine_authority`):**
  - Reads the DTS from the entry points in `specs.py`. C&I: `in-ci-ent-2016-03-31.xsd`. Ind AS: `in-ci-ent-2017-03-31.xsd` + `in-ca-ent-2017-03-31.xsd` (union, see ADR-0010).
  - Applies the validator patches in memory and resolves prohibition and override.
  - Builds the dimensional model and writes `knowledge_base/<kb>_engine_authority.json`.
  - It is deterministic, and its key and array order equals the retired TS compiler's (`collation.py`).
- **Rule half (`engine/compiler/compile.mjs`):**
  - Reads `knowledge_base/ci_engine_authority.json` and `…/Final Business Rules … 2016 V1.3…/*.xls`.
  - Writes `engine/authority/ci-2016.rules.json`, `ci-2016.coverage.json` (the rule coverage ledger) and the assembled `ci-2016.authority.json`.
- **Browsing and AI** use `knowledge_base/<kb>_knowledge_base.json`, a separate extraction. A pytest checks that both see the same ELRs and concepts.
