# 05 · Validation

Validation has **three layers**. The first two run in the app; the third is MCA's own tool. The goal is that by the time the user opens the MCA tool, it reports **zero errors**.

```
Layer 1  Engine (TS, live, offline)       ── authoritative, deterministic, executable rules
Layer 2  Knowledge base (Python JSON)     ── raw MCA rule text; AI context + coverage audit
Layer 3  MCA Validation Tool v5.1 (Java)  ── external final check; errors imported back
```

## Layer 1: engine checks (`engine/src`; rules from `knowledge_base/<kb>_engine_rules.json`)
| Family | Module | Examples (issue codes) |
|---|---|---|
| Document | `gate.ts` | `schemaRef`, `cin.missing`, `cin.format`, `periods`, `reportType`, `empty` |
| Fact / type | `gate.ts` | `concept.unknown`, `period.type`, `period.unmapped`, `period.overlap`, `nil`, `value.type`, `value.pattern`, `value.length`, `value.canonical`, `value.xmlChar` |
| Units / decimals | `gate.ts` | `unit.missing`, `unit.type`, `decimals`, `decimals.nonSignificant`, `shareCapital.rounded` |
| Text blocks | `gate.ts` + `richtext.ts` | `html`, `html.entity`, `lang` |
| Dimensions | `dimensions.ts` | `dim.hypercube`, `dim.unknownAxis`, `dim.unknownMember`, `dim.memberNotInDomain`, `dim.memberNotUsable`, `dim.defaultReported`, `dim.duplicateAxis`, `dim.typedAsExplicit`, `dim.explicitAsTyped`, `dim.emptyTyped` |
| Calculation | `calculation.ts` | Parent ≠ Σ weighted children per ELR (Calculations 1.1 rounding) |
| MCA business rules | `rules.ts` + `expr.ts` | `rule.GR-n` (generic), `rule.SR-L<row>-n` (specific), `review.*`, `unimplemented.*` |
| Import | `importer.ts` | `import.unresolved`, `import.conflict` |

**Severities:** `ERROR` blocks XML export; the user can force it, with a warning. `WARNING` and `INFO` don't block.

**Generic rules (C&I 2016; Ind AS below):**
| Rule | Meaning |
|---|---|
| GR-1 | Parent = sum of children |
| GR-2 | Mandatory line items |
| GR-3 | Parent member required if a child is reported |
| GR-4 | Typed members sequential |
| GR-5 | No images |
| GR-6 | CY/PY pairing |
| GR-7 | Opening = PY closing (structural: one instant context) |
| GR-8 | Money ≤ 2 decimals |
| GR-9 | INR only |
| GR-10 | Incorporation date (review only) |
| GR-11…14 | Standalone/consolidated/PY applicability of ELRs |
| GR-15 | Mandatory axes |
| GR-17 | Taxonomy applies from 2014-04-01 |

**Specific-rule patterns:** `format-cin/pan/country`, `gte0`, `gt0`, `lte100pct`, `lte-today`, `eq-ref`, `lte-ref`, `eq-product`, `sum-two-eq`, `listed-members-sum`, `member-difference`, `mandatory-if-*`, `table-conditional`, `cin-or-pan-if-india`, plus curated rules such as `sharecapital-lte-subscribed` and `kmp-din-required`.

**Review-only rules:** rules that need MCA21 master data (DIN/SRN validity, ICAI membership, company class) can't be checked offline. The user sees them as `review.*` INFO items.

Every issue has a **location**: `{elr, table?, concept, period, dims, cell?}`. If the fact came from Excel, `cell` points to the workbook cell, so a double-click in Problems selects it.

## Layer 2: knowledge-base rules (`knowledge_base/*.json`)
These are built by the Python extractors (`src/services/extractors/*.py`) from the same MCA workbooks:
- `businessRules.rules[]`: `{element, concept, elr, type: mandatory|conditional-mandatory|mandatory-consolidated|validation-rule, ruleText}`. The rule text is **plain English and not executable**.
- Also: `mandatoryLineItems`, `conditionalMandatory`, `tableRules` (Ind AS), `genericRules` (prose), and `isMandatory*` flags on concepts.

| Taxonomy | Concepts | Specific rules | Mandatory concepts |
|---|---|---|---|
| C&I 2016 | 3660 | 567 | 152 |
| Ind AS 2017 | 5647 | 812 | 220 |
| Costing 2019 | 452 | 223 | 103 |

**What it's used for:**
1. **AI context:** the fix agent retrieves the exact rule text and concept definitions to explain an error and ground its patch.
2. **Coverage audit:** the diff below.

**Known gaps in the extractors (Layer 2 text only), to fix later:**
- Ind AS sheets not extracted into the browsing file: "Applicable ELR", "Exempt parent/child member", "formulas Linkbase", "Parent Child Exempt Calculation", "Country/Currency codes". The executable rule builder reads all of them except "Currency Code".
- The Ind AS XBRL formula linkbase file (`for_cro.xml`) is not read; its opening/closing formulas come from the workbook sheet "formulas Linkbase" (Ind AS GR-6).
- The Costing "ApplicableExtended Links" sheet is not extracted.
- 2 C&I rules have `concept: null`.

## Executable rules: built from the MCA workbooks ([ADR-0011](decisions/ADR-0011-business-rules-from-knowledge-base.md))
The engine's rules come from the same MCA workbooks as the Layer 2 text, formalized by `src/services/engine_rules/` (Python):

| | Executable rules (Layer 1) | Knowledge base text (Layer 2) |
|---|---|---|
| Built by | `src/services/engine_rules` → `knowledge_base/<kb>_engine_rules.json` | `src/services/extractors/*.py` → `<kb>_knowledge_base.json` |
| Served by | `/{id}/engine-rules` (the app's `AuthorityService`) | `/{id}/rules`, `/{id}/concepts/{qname}?include_rules=true` |
| Rule form | **Executable ASTs** + a coverage ledger | Raw `ruleText` + coarse `type` |
| Purpose | Decide pass/fail | Explain, retrieve, audit |

**How a sentence becomes a rule** (`make engine-rules`, about 1 s for both taxonomies):
1. `workbook.py` reads the workbook (python-calamine) with each sheet's own layout: C&I `[nnnnnn] Title` blocks, Ind AS `LinkRole` / `Definition` blocks with `prefix | name | … | Business Rule | Status | FTA`. Lines count from the sheet's stored range (`sheet_origin.py`), so rule ids (`SR-L<line>-n`) are stable.
2. `specific.py`, the port of the TS formalizer (deep-equal on C&I, frozen in `tests/fixtures/engine_rules/`): each clause gets the first text pattern (`pattern:*`) or curated reading (`curated:*`) that matches. `jsre.py` makes Python regexes behave like JavaScript's.
3. `specific_fallback.py` runs only on clauses still UNIMPLEMENTED: it normalizes wording variants (`"yes"`, `selecetd`, `Mandatory table is …`, `is other than 0`, a trailing `in [401100] …`) and retries, then tries further forms (typed "Others" table sums, members "or its child members", "is tagged", note sums against the balance sheet). It cannot change a rule the main pass formalizes.
4. `generic.py` / `generic_ind_as.py` map the workbook's generic-rule numbers to engine handlers per taxonomy. Ind AS ELRs are named by title in the MCA text and resolved to codes of the built DTS; a name that resolves to nothing fails the build.
5. `builder.py` applies the curation (below), computes the coverage measure, and writes the rule file, `<kb>_rule_coverage.json` and `docs/generated/rule-coverage-<kb>.md`.

**The runtime finds generic rules by handler**, not by number (`applicability.js`, `rules.js`, `fixes.js`), and tags applicability reasons with the rule's own id (C&I `GR-12: …`, Ind AS `GR-11: …`).

**Ind AS generic rules** (numbered differently from C&I):

| Rule | Handler | Note |
|---|---|---|
| GR-1 | `calc-parent-child` | + sheet "Parent Child Exempt Calculation" |
| GR-2 | `mandatory-line-items-driver` | executed through the ML-* rules |
| GR-3 | `sequential-members` | |
| GR-4 | `no-images` | |
| GR-5 | `cy-py-pairing` | |
| GR-6 | `opening-closing-roll-forward` | **new**: closing = opening + change for the 36 elements of sheet "formulas Linkbase" |
| GR-7 | `monetary-max-2-decimals` | |
| GR-8 | `inr-currency` | exempt: the 19 listed subsidiary elements (`exemptConcepts`) |
| GR-9 | review-only | no date-of-incorporation element in the DTS |
| GR-10 | `elr-not-for-consolidated` | 700100, 700500, 700600, 700700, 700200 |
| GR-11 | `elr-not-for-prior-year` | 8 ELRs, element exceptions, plus one table and two elements of other ELRs (`tables`, `concepts`) |
| GR-12 | `general-info-consolidated` | `elrCode` 700300 |
| GR-13 | `elr-not-for-standalone` | 613400 |
| GR-14 | `mandatory-axes` | every axis of the six listed tables |
| GR-15 | not applicable | guidance |
| GR-16 | `fta-opening-balance-sheet` | **new**: a first-time adopter reports the previous year's opening balance sheet |

**Yes/No answers.** For C&I, a field or table that a rule requires under "Yes" is also unavailable under "No" (MCA-validated C&I filings). For Ind AS it is not (`yes_no_restricts: False`). The MCA-accepted Dixon instance answers "No" and still files the major-customer, share-based payment and lease tables and nil OCI / CSR amounts. The dependency is recorded (`restricts: false`) for the UI; the rules still require the values under "Yes".

### Coverage
**Executable share = EXECUTABLE ÷ (all rules − NOT_APPLICABLE).** Review-only and unimplemented are reported separately (`measure` in the coverage file). Bar: ≥ 95% per taxonomy.

| Taxonomy | Rules | Not applicable | Counted | Executable | Review-only | Unimplemented | Share |
|---|---|---|---|---|---|---|---|
| C&I 2016 | 1164 | 153 | 1011 | 962 | 48 | 1 | **95.15%** |
| Ind AS 2017 | 1351 | 16 | 1335 | 1273 | 60 | 2 | **95.36%** |

The two Ind AS gaps: SR-L4235-1 ("yes is selected in above element": the element isn't named) and ML-39-b (outstanding balances, ambiguous in the MCA source, like C&I ML-20-b). Every rule with its status is in [rule-coverage-ci](generated/rule-coverage-ci.md) and [rule-coverage-ind_as](generated/rule-coverage-ind_as.md).

### Curation: exceptions with evidence
`src/services/engine_rules/curation/<kb>/divergences.json` lists rules contradicted by an MCA-accepted instance. Each entry has `ruleId`, `evidence`, and for Ind AS also `ruleText` and `instanceFact`. Optional narrowing:
- `concepts`: only failures about these elements (any rule; for mandatory line items, the elements not required);
- `scopes`: only these periods (`CY`, `PY`, `PYO` = previous-year opening).

Matching failures are reported as **warnings with the evidence attached**, never dropped. Without narrowing, the whole rule becomes a warning. `approved_limitations.json` holds release-owner approvals of UNIMPLEMENTED rules (none approved).

**Ind AS acceptance (Phase 9):** the Dixon instance gives **0 ERRORs** (`engine/test/ind-as-rules.test.ts`). Six exceptions are curated: SR-L1304-1, ML-7, SR-L5417-2 (PY), SR-L6075-1 and SR-L6392-1 (PY), GR-1 (EquityShareCapital at the previous-year opening). The test also checks that each of them appears as a warning.

## Layer 3: MCA Validation Tool v5.1
- It is GUI-only (see [01-research](01-research-webxbrl-and-mca-tool.md)), so it can't be embedded.
- **Settings:** the user sets the path to `MCA_XBRL_Valiation_Tool_V5.1.exe`. We auto-detect common folders and `data/validation_tool` in dev.
- **Tools → Validate in MCA Tool:**
  1. The app writes the latest XML to `output/NNN.xml`.
  2. It launches the tool.
  3. It shows instructions: choose the C&I taxonomy, File → Open, Validate.
- **Problems → Import MCA errors:** paste the text, or load a saved report. `mca-errors.ts` then:
  1. Parses each line: code, element in `'quotes'`, value in `[brackets]`.
  2. Maps it to facts and cells.
  3. Explains it in plain language.
  4. Offers a quick fix or "Ask AI".
- **Future spike:** check whether the `com/mca/xbrl` classes can run headless through the bundled JRE. Investigate only; check licensing before any use.
