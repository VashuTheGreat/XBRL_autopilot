# 05 · Validation

Validation has **three layers**. The first two run in the app; the third is MCA's own tool. The goal is that by the time the user opens the MCA tool, it reports **zero errors**.

```
Layer 1  Engine (TS, live, offline)       ── authoritative, deterministic, executable rules
Layer 2  Knowledge base (Python JSON)     ── raw MCA rule text; AI context + coverage audit
Layer 3  MCA Validation Tool v5.1 (Java)  ── external final check; errors imported back
```

## Layer 1: engine checks (`engine/src`)
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

**Generic rules (C&I 2016):**
| Rule | Meaning |
|---|---|
| GR-1 | Parent = sum of children |
| GR-2 | Mandatory line items |
| GR-3 | Parent member required if a child is reported |
| GR-4 | Typed members sequential |
| GR-5 | No images |
| GR-6 | CY/PY pairing |
| GR-7 | Opening = PY closing |
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

**Known gaps in the extractors, to fix later:**
- Ind AS sheets not extracted: "Applicable ELR", "Exempt parent/child member", "formulas Linkbase", "Parent Child Exempt Calculation", "Country/Currency codes".
- The Ind AS XBRL formula linkbase (`for_cro.xml`) is ignored.
- The Costing "ApplicableExtended Links" sheet is not extracted.
- 2 C&I rules have `concept: null`.

## Layer 1 vs Layer 2: the diff (the colleague's question)
| | Engine authority (Layer 1) | Knowledge base JSON (Layer 2) |
|---|---|---|
| Built by | `engine/compiler` (TS, port of `rule-formalizer.mjs`) | `src/services/extractors/*.py` |
| Rule form | **Executable ASTs** with a coverage ledger | Raw `ruleText` + coarse `type` |
| Dimensions | Full hypercube/table model | Raw definition arcs only |
| Calculation | Executed | Arcs stored, not executed |
| Generic rules | GR-1…17 executed | Prose descriptions |
| Purpose | Decide pass/fail | Explain, retrieve, audit |

**Deliverable** (Phase 6): `engine/authority/ci-2016.coverage.json` plus a generated report `docs/generated/rule-coverage-ci-2016.md`. It lists every KB rule (all 567) with its engine status: `formalized | review-only | approved-limitation | missing`. Any rule marked `missing` is a backlog item.

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
