# ADR-0007 · v1 covers C&I 2016 **and** Ind AS 2017; plan driven by real client data
- **Status:** accepted (2026-11-10). Supersedes [ADR-0002](ADR-0002-ci-2016-first.md).
- **Context:** the first real client files ([12-reference-data](../12-reference-data.md)) show both taxonomies in daily use:
  - **HPL** (Helmier Pvt Ltd) is a C&I filing (Schedule III Division I).
  - **DGPL** (Dixon Global Pvt Ltd) is an Ind AS filing, and its XBRL was produced by Webtel Web-e-XBRL v32.7.
- **Decision:**
  1. The engine becomes **taxonomy-generic**: one authority per taxonomy (`ci-2016`, `ind-as-2017`), each built by the same compiler from a per-taxonomy profile.
  2. **Ind AS 2017 joins v1.** It comes right after the editor and real-data readiness (`.xls`, float rounding), before AI tagging, because AI tagging is evaluated on the Ind AS answer key.
  3. **Importing existing XBRL instances (any vendor, Webtel first) is a v1 feature.** CAs switching from Webtel bring last year's XML; it also gives us exact golden tests.
  4. **Accuracy is measured, not asserted.** Workbook ↔ instance pairs (DGPL ↔ Dixon) become a labelled evaluation set for auto-tagging.
  5. The client reference files are committed to the repo (owner's decision) as test fixtures.
- **Consequences:**
  - The rule formalizer, which today handles C&I only, must also handle the Ind AS workbook's sheets (table rules, conditional mandatory, formulas linkbase).
  - The New Filing wizard gets a taxonomy choice.
  - `.xls` reading is needed: exceljs can't read it, so it goes through python-calamine in the sidecar.
