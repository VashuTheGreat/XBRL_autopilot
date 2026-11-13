# 01 · Research: Webtel webXBRL, competitors, MCA Validation Tool

Research done 2026-11-10. Sources:
- Webtel blog and update pages, Webtel's XBRL process-flow deck (SlideShare)
- Competitor sites
- Filing-manual summaries (TaxGuru, BCAJ, DataTracks)
- Our own inspection of `data/validation_tool/`

The colleague's reference videos:
- webXBRL demo: https://youtu.be/2MmlPon1NhY
- XBRL basics: https://youtu.be/2BqmjS6wBXM
- Post-tagging errors: https://youtu.be/GGJLPlH8ZpA?t=120

## 1. Webtel webXBRL: what we're cloning
**Workflow, from Webtel's process deck:**
1. Masters: company, directors, auditor.
2. Financial tagging.
3. Fixed-asset templates.
4. Table entry (e.g. current investments).
5. Notes tagging.
6. Generate the instance XML.
7. Validate with the MCA tool, then pre-scrutiny.
8. Attach to AOC-4 XBRL and file.

**Features to match:**
- **Masters:**
  - Enter the CIN and click *Prefill*. *Autofill* fetches all directors, *Prefill* adds one at a time.
  - The auditor's membership number is checked.
  - → Ours: General Information (ELR 400100) form + Masters panel. Online prefill comes later.
- **Financial tagging screen:**
  - The client's Excel BS/P&L opens next to a taxonomy tree. Select a cell, then double-click an element to tag it.
  - **Tagged Excel cells turn green; tagged taxonomy items turn red.**
  - CY and PY are tagged together.
  - → Ours: the split editor with colour overlay. AI pre-fills the tags, and the user confirms.
- **Notes and text blocks:**
  - Select note text, then double-click the target heading.
  - Directors'/auditors' reports can be imported from Word/Excel.
  - Footnotes can be added or edited.
  - → Ours: text-block editor (MCA HTML subset, `richtext.ts`), footnotes panel.
- **Dimensions:** non-financial data and tables are mapped to axes/members. → Ours: generic dimensional table view (`views.ts`).
- **Previous year:** loads PY for fixed assets, related parties and investments, and imports XML instances from any vendor. → Ours: `importer.ts` + carry-forward.
- **Validation:**
  - Built-in validations with a **"Global Error Locator"**: double-clicking an error opens the field.
  - Mandatory items are shown in red, with colour matching and auto-calculation.
  - Alerts for duplicate PAN, negative values and opening/closing mismatch.
  - The MCA tool is integrated.
  - → Ours: Problems panel, locate-on-double-click, quick fixes, MCA tool launcher and error import.
- **Other:**
  - Backup/restore, live updates, yearly FY registration licence.
  - The Cost XBRL (CRA-4) Rev 8.3, released 2026-03-25, uses MCA Validation Tool 5.1.

**Update 2026-11-13:** the full feature checklist, our status for each feature, and the gaps are in [13-webxbrl-parity.md](13-webxbrl-parity.md). It adds:
- webXBRL release 32.7: recent companies, "Current Year Tagging Only", CIN/PAN format check, Live Update;
- a click-by-click walkthrough taken from the video captions (§11);
- the curated video list.

Facts from the walkthrough that correct or extend the list above:
- **Add / Replace** when a line already has a value.
- A line's **"L" / F7 jump to its note table**. The table footer shows the BS-vs-note difference and turns green at 0.
- **Ctrl+E** expands the taxonomy tree.
- **F2** tags notes from Excel.
- **Narration master** for F-key text snippets.
- **Utilities → Reset Settings** for the rounding level and the CY/PY column gap.
- 3-year tagging for Ind AS.
- No public user manual exists. The videos are the documentation.

## 2. Competitors
| Product | Notable features |
|---|---|
| KDK eXBace | Excel and XML import; table converter for text blocks; entry-level validator with **jump-to-table**; one-click instance→PDF; XML viewer; CIN verification; multi-tab |
| Taxmann XBRL | Blank Excel templates → import; MCA-utility validation; unlimited clients; cost audit |
| Gen XBRL (Sag Infotech) | AOC-4 XBRL + CRA-4, pre-submission error check, ~₹10k one-time |
| Saral XBRL (Relyon) | Validation during entry, web updates, backup |
| TallyPrime | Ledger→taxonomy mapping inside Tally, then export/validate through the MCA tool |
| IRIS iFile | Spreadsheet-based iFile Lite for India |

**Gap no competitor fills:** AI suggestions for mapping from Excel or a trial balance, and AI checks on **tagging quality**. Both are our core.

## 3. MCA XBRL Validation Tool v5.1
Local copy: `data/validation_tool/MCA_XBRL_Valiation_Tool_V5.1@02-12-2025/`.

**What we found inside:**
- A **JSmooth exe** wrapping a Java jar, with a bundled JRE 1.8.
- The UI is Swing with the FlatLaf look and feel.
- The validation code is in `com/mca/xbrl/*`: formula linkbase, XPath processor, context/unit models, a presentation renderer, and `light/PDFRenderer`. It also contains MCA21 back-office classes (`com/dca21/*`, Axis2/Spring clients) used for pre-scrutiny.
- **No CLI.** It's GUI only, so treat it as an *external final check*. The app launches it; it doesn't embed it.
- Do **not** redistribute it. Users download it from mca.gov.in, and we store its path in Settings.
- Its readme notes that `WhetherCompanyIsSubsidiaryCompany` and `WhetherCompanyHasSubsidiaryCompanies` are now mandatory (C&I 2016 revision).

**Flow:**
1. Pick the taxonomy (Ind AS / C&I).
2. Open the instance.
3. View General Information.
4. Validate.
5. Pre-scrutiny. This needs internet, checks against MCA21 server-side, and is allowed only after validation passes.
6. File → **Export to PDF**. A 0 KB or failed PDF almost always means bad HTML in a text block.

**What it checks:**
- XBRL 2.1 and XML-schema validity. `cvc-*` messages come from Xerces.
- Taxonomy version.
- Calculation/arithmetic.
- Mandatory elements.
- MCA business rules (generic + specific, with exemption lists).

It does **not** check figures inside block-tagged text.

**Error format:** element names in `'single quotes'`, values in `[square brackets]`. Our `mca-errors.ts` (ported from `lagacy_js/mca-errors.js`) parses and explains:
- `cvc-complex-type.2.4.a/b`
- `cvc-pattern-valid`
- `cvc-enumeration-valid`
- `cvc-length-valid`
- `cvc-datatype-valid`
- `cvc-type.3.1.3`
- `cvc-elt.1` / `cvc-elt.3.1`
- `cvc-id`
- HTML errors

## 4. Instance rules from the filing manual (the engine must enforce these)
**Contexts:**
- Context identifier scheme `http://www.mca.gov.in/CIN`, with the company CIN as the value, in every context.
- No duplicate or unused contexts and units. No duplicate facts (same element + context).

**Periods:**
- Both CY and PY are required, except in the first financial year.

**Values:**
- INR with a single unit (subsidiary data excepted). No scale factor and no `precision`.
- `decimals` reflects the stated rounding.
- Dates `yyyy-mm-dd`, booleans `true`/`false`, percentages as decimals 0–1, ISO currency codes (not "Rs").
- Tuple sub-elements in presentation order.

**File:**
- UTF-8, and a `schemaRef` pointing to the official MCA taxonomy URI (never a local copy). C&I 2016: `https://www.mca.gov.in/V3XBRL/2016/07/26/Taxonomy/CnI/in-ci-ent-2016-03-31.xsd`.

**Text blocks:**
- Only `div, span, p, br, table/tr/td/th/thead/tbody/tfoot/col/colgroup`.
- Lowercase and properly closed, using the predefined CSS classes. No `b`/`i`/inline styles.
- Entities: only `&nbsp; &amp; &lt; &gt;`.
- Tables nested at most one level, with `xml:lang="en"`.

**Footnotes:** `loc`/`footnote`/`footnoteArc` with `#` hrefs.

## 5. Common errors after tagging (what the AI fix agent must handle)
- **Data type:** wrong date format; Yes/No instead of true/false; percentage given as > 1; "Rs" instead of INR; letters in the membership number.
- **Structural:**
  - Missing mandatory elements, e.g. basis of presentation or associate CIN.
  - Missing PY value.
  - Tuple order.
  - The `NetProfitLoss` vs `…BeforeMinorityInterest` dependency.
  - Duplicate or unused contexts.
- **Arithmetic:** parent ≠ sum of children (GR-1); opening ≠ PY closing (GR-7); statement figure ≠ note figure.
- **Tagging quality** (the validator is blind to these, but our AI reviews them):
  - Lines lumped into residual "Other …" tags.
  - Wrong element. Examples: loss on sale of fixed assets tagged as an investment; interest accrued on FDs tagged as bank balance.
  - DTA/DTL sign reversed.
  - Notes, cash flow or related parties left untagged.
- **Rendering:** garbled block-tagged notes; footnotes that appear in the viewer but not in the PDF.
- **Portal:**
  - "Latest instance document should be attached": validate on the same day you file.
  - Pre-scrutiny failures, size limits, DSC mismatch, special characters in file names.

## 6. MCA V3 portal (context only)
AOC-4 XBRL is a V3 web form (from FY 2024-25, ~July 2025):
1. Log in.
2. Enter the CIN to prefill.
3. Pick the taxonomy and standalone/consolidated.
4. Attach the validated, pre-scrutinised instance plus the signed PDFs.
5. Sign with DSC, pay the fee, get the SRN.

Our app's output is the instance XML (and preview PDF). The user uploads it.
