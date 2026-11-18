# ADR-0016 · Canonical Financial Package as the hinge of the pipeline
- **Status:** proposed (2026-11-18). Design in [docs/16](../16-target-architecture.md).
- **Context:**
  - The planned pipeline normalizes each client workbook into six fixed canonical Excel files (BS, PL, CF, SOCIE, PPE schedule, Notes) and tags those. Decoupling understanding from tagging is right.
  - The fixed files have gaps:
    - In Dixon's accepted instance, 1,548 of 2,666 facts are table amounts and 268 are table text. There is only one table schema (PPE), and it maps columns to concepts that don't exist in Ind AS: gross / depreciation / net is an axis.
    - Numeric note breakdowns have no file.
    - Amounts are floats.
    - Values lose their source cell, scale and presented places.
  - The planned normalizer relies on keyword lists or LLM-written parsing code, with no check that its output equals the workbook.
- **Decision:**
  1. The pipeline is **Ingest → Normalize → Tag → Assure → File**. Its hinge is one **Canonical Financial Package** per filing, stored in `.axbrl`:
     - generic shapes `statement` / `noteTable` / `noteText` / `master`;
     - exact decimal strings with scale and presented places;
     - every value carries its source cells;
     - stable row ids;
     - stored check results.
  2. **Normalize = propose, then prove.** Structural signals (plus an optional LLM given a number-masked shape view) propose candidate packages. Arithmetic checks choose: footing, balance, statement ↔ note ties, roll-forward, cash-flow closing = balance-sheet cash. The CA confirms.
  3. **Tags attach to package items,** not raw cells. Kinds: `L` statements, `T` tables, `E` text blocks, `M` masters.
  4. **Tables are tagged through templates generated from the definition linkbase** (axes, members, line items, period-start / end labels, applicable rules), not hand-written column maps.
  5. **One deterministic engine in the app** owns facts, live validation, zero and fix plans, and XML. The sidecar parses, proposes and suggests only; it holds no state and writes no XML.
  6. The six canonical Excel files remain as an **export view** of the package for CA review.
- **Consequences:**
  - New contracts (TS + pydantic) for the package and tags; `.axbrl` gains `package/`, `tags/`, `checks/`.
  - New build artifacts from `make rebuild`: table templates, master field definitions, a partitioned local search index, calibration maps.
  - Sidecar routes become `/normalize/propose`, `/tag/statements`, `/tag/tables`, `/tag/texts`; no `/instances/generate`.
  - Every phase is gated on answer-key measurements (P0 first).
- **Alternatives rejected:**
  - **Six fixed canonical files as the pipeline stage:** too narrow for real note tables; float amounts; no provenance.
  - **Tagging raw cells with no package:** every consumer re-guesses the layout, and the CA can't review the understanding in one place.
  - **XML generation in the sidecar next to validation in the app:** two models of contexts, periods and decimals that will drift; what MCA checks would not be what the CA saw validated.
  - **Keyword normalizer, or LLM-written parsing code:** not general, not testable, no proof of equality with the workbook.
