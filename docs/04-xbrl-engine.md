# 04 · XBRL engine (`engine/`, package `@xap/engine`)

The engine is the deterministic core. It is a pure TypeScript library with no Electron, network or AI dependencies. It runs inside Electron (main / utilityProcess) and in Vitest. It is a **port of `lagacy_js/`**, which is a tested C&I 2016 tool, generalised so other taxonomies can be added.

## Current state (2026-11-10)
- **Step 1 is done: a behaviour-preserving import.**
  - The legacy runtime modules live unchanged in `engine/src/core/*.js`, with one JSDoc annotation on `Session`.
  - `engine/src/index.ts` is the typed public entry point. With `allowJs`, TypeScript infers the core's types.
  - The legacy tests live in `engine/test/legacy/` (run with `node:test`). The rule compiler moved to Python in Phase 9 ([ADR-0011](decisions/ADR-0011-business-rules-from-knowledge-base.md)).
- **Phase 6 is done: the taxonomy half of the authority comes from the knowledge base** ([ADR-0010](decisions/ADR-0010-engine-authority-from-knowledge-base.md)).
  - The Python ingestion builds `knowledge_base/ci_engine_authority.json` and `ind_as_engine_authority.json`, which the sidecar serves at `/api/v1/taxonomies/{id}/authority`.
  - The engine joins them with the business rules via `assembleAuthority` (`src/core/authority-bundle.js`).
  - The TS DTS/tables compiler is retired.
- **Phase 9: the business rules come from the knowledge base too** ([ADR-0011](decisions/ADR-0011-business-rules-from-knowledge-base.md)).
  - `src/services/engine_rules/` (Python) builds `knowledge_base/<kb>_engine_rules.json` for C&I **and Ind AS**; the sidecar serves them at `/api/v1/taxonomies/{id}/engine-rules`.
  - The TS rule compiler (`compile.mjs`, `rule-formalizer.mjs`, `rules-source.mjs`) and the `xlsx` dependency are retired. Its C&I output is frozen in `tests/fixtures/engine_rules/` and the Python port is deep-equal to it.
  - The runtime finds generic rules by **handler**, not by C&I rule number (Ind AS numbers them differently), and tags applicability reasons with the rule's own id.
- **Phase 11 (2026-11-11): ELR groups by title** ([ADR-0013](decisions/ADR-0013-table-tagging.md)). Each ELR's `group` (Statements / Notes / Disclosures) in the engine authority comes from its title (`classify_elr`, as the catalog routes), no longer from C&I code ranges.
  - `derived.js` (statement ↔ note links), `Session.noteLink` and `carry-forward.js` (disclosure tabs) read it.
  - C&I is byte-identical.
  - Ind AS changes: its P&L, cash flow and changes in equity are now Statements, its 400xxx notes are Notes, and its 7xxxxx ELRs are Disclosures. It gets 38 statement ↔ note links (PPE, share capital, borrowings, receivables, P&L lines …); before, it got almost none.
  - Dixon: the statements agree with their notes, and nothing is re-derived on opening (`test/elr-groups.test.ts`).
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
  scripts/assemble-authority.mjs   joins knowledge_base/<kb>_engine_authority.json + <kb>_engine_rules.json (no compiling)
  compiler/taxonomy-source.mjs, xsd-validate.mjs   test-side Arelle XSD check on a patched taxonomy copy (Arelle: dev extra)
  authority/              generated (git-ignored): ci-2016.authority.json, ind-as-2017.authority.json (taxonomy + rules,
                          for tests/tools; the app loads both halves through the sidecar)
  test/fixtures/ci-2016-example.golden.xml   golden XML of the example filing (TS-compiled authority, 2026-11-10)
  .taxonomy/              generated working copy of the taxonomy with validator patches (git-ignored)
  test/*.test.ts          vitest (facade)
  test/legacy/*.test.mjs  node:test (ported legacy suite)
  test/fixtures/golden/   put MCA-validated golden-*.xml here to enable ~50 skipped regression tests
```

### Commands
```bash
make engine-authority                          # data/ → knowledge_base/*_engine_authority.json (Python, ~8 s; also part of make rebuild)
make engine-rules                              # MCA rule workbooks → knowledge_base/*_engine_rules.json (Python, ~1 s)
pnpm --filter @xap/engine test                # joins the KB files into authority/, then vitest + legacy suite
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
  - the **rule bundle**, built by the Python rule builder into `knowledge_base/<kb>_engine_rules.json` (C&I and Ind AS) and served by `/taxonomies/{id}/engine-rules` ([ADR-0011](decisions/ADR-0011-business-rules-from-knowledge-base.md)).

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
| `derived.js`, `member-rollup.js`, `totals-fill.js` | `derived.ts` | Carrying amounts, roll-forwards, parent-member roll-ups, totals |
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
- `mandatory-zeros.ts`, tables (Phase 11, [ADR-0013](decisions/ADR-0013-table-tagging.md)): `tableZeroPlan(session, tableId?)` / `fillTableMandatoryZeros(session, tableId?)`.
  - **What it fills:** in every table column (dimension combination) that **already holds a value** for the year, the line items its mandatory-line-items rules (ML-*) require and that are still empty. Only amounts, share counts and per-share amounts are filled; rates and text are left to the user.
  - **What it skips:** tables needed under one member only, and elements an MCA-accepted filing omits (`softConcepts`).
  - **Fixpoint:** the fill can derive a value into a new column (net carrying amount = gross − accumulated), so it runs again until nothing is left, at most 5 rounds.
  - **Shared code:** "a column has a value" is `core/table-columns.js` `filledTableColumns`, the same function the rule engine's `lineItemsMandatory` uses. `singleMemberTables` is no longer copy-pasted.
  - **Never against a statement figure:** a line that a reported, non-zero statement figure is the sum of (statement ← note, e.g. share capital = Σ paid-up value over the classes, SR-L541-1) is never filled with 0. And `Session.deriveStatements` keeps a statement figure the user entered when an empty note now sums to 0 (a rule zero, or a part entered as 0): the rule shows the difference. Found by the engine-side scoreboard (docs/06), where "Table zeros" had zeroed DGPL's share capital. Test: `table-zeros.test.ts`.
  - **Golden** (`test/table-zeros.test.ts`): Dixon without its 1,260 zero table facts has 73 ERRORs. After the fill it has **0 ERRORs**, and the fill added 163 facts (133 filled + 30 derived), every one a zero Dixon filed. Dixon's other 1,097 zeros are optional.
- `table-mapping.ts` (Phase 11, [ADR-0013](decisions/ADR-0013-table-tagging.md)): `planTableBlock(A, spec, { hasValue, columnScope })` takes an Excel block mapped to one table and gives one planned fact per non-empty cell, with its problems. It is pure, and is shared by the app's preview, the apply step and the evaluation.
  - **Element:** from the row. Only the period label roles choose the fact: opening = the table's periodStartLabel row, closing = its periodEndLabel row. A negated or total role only changes how the table displays the value, so the fact takes the table row's own role (DGPL's "Charge for the year" is the negated-total depreciation row).
  - **Dimensions:** the row's members ∪ the column's members; an axis given twice must agree.
  - **Period:** the row's, else the column's, else the sheet column's.
  - **Problems** are given per cell: not a line item, not an axis of the table, member syntax, dimensional validity, unknown period, two cells being the same fact.
  - `tableOfFact(A, concept, dims)` finds the table of a single dimensional tag.
  - Tested on Ind AS (a DGPL-style PPE roll-forward) and C&I (tangible assets), both applied through `Session.setTableValue`.
- **Parent-member roll-ups** (`core/member-rollup.js`, Phase 11 step 3b, [ADR-0013](decisions/ADR-0013-table-tagging.md)): a table value under a child member derives its parent members, as the sum of the values under the parent's children on that slice (the same element, period and other members). The derivation is deterministic and taxonomy-generic.
  - **Member tree:** read from the authority's table axes (`members[].parent`); a member whose parent differs between tables is left out.
  - **What is derived:** only real, usable members. The axis default (the domain, the "total" column) is the statement figure or the table's total column, which other derivations or the filer supply. Amounts and share counts only.
  - **How:** `Session.deriveFrom` → `applyDerived`, like a carrying amount: origin `calculated`, recursive up the tree (Other retained earning → Retained earnings → Reserves → Equity attributable). An entered or imported parent that differs from its children is the filer's figure and is kept, unless it agreed before the edit. An override is never replaced. `refreshCalculatedCells` knows the roll-up.
  - **With the roll-forward:** a parent cell whose children hold values belongs to the roll-up. The roll-forward (closing = opening + change) leaves it alone (`undefined`), and the roll-up leaves a closing balance it doesn't feed to the roll-forward. Before this fix, a previous-year edit removed the current-year roll-up of Dixon's financial assets at amortised cost.
  - **Golden** (`test/member-rollup.test.ts`): every parent-member value Dixon filed equals the sum of its filed children. Dixon without those facts, re-derived from the children, gives the same values and **0 ERRORs**. C&I: Equity shares 1 → Equity shares (share capital classes).
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
make engine-rules                              # rule half, both taxonomies (Python)
```
- **Taxonomy half (Python, `src/services/engine_authority`):**
  - Reads the DTS from the entry points in `specs.py`. C&I: `in-ci-ent-2016-03-31.xsd`. Ind AS: `in-ci-ent-2017-03-31.xsd` + `in-ca-ent-2017-03-31.xsd` (union, see ADR-0010).
  - Applies the validator patches in memory and resolves prohibition and override.
  - Builds the dimensional model and writes `knowledge_base/<kb>_engine_authority.json`.
  - It is deterministic, and its key and array order equals the retired TS compiler's (`collation.py`).
- **Rule half (Python, `src/services/engine_rules`, see [05-validation](05-validation.md)):**
  - Reads `knowledge_base/<kb>_engine_authority.json` and the MCA rule workbook of the taxonomy (`specs.py`).
  - Writes `knowledge_base/<kb>_engine_rules.json`, `<kb>_rule_coverage.json` and `docs/generated/rule-coverage-<kb>.md`.
  - Curated exceptions with evidence: `src/services/engine_rules/curation/<kb>/`.
- **Browsing and AI** use `knowledge_base/<kb>_knowledge_base.json`, a separate extraction. A pytest checks that both see the same ELRs and concepts.
