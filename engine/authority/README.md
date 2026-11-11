# Compiled business rules (generated)

`pnpm --filter @xap/engine compile:authority` reads `knowledge_base/ci_engine_authority.json` (the taxonomy half, built by
the Python ingestion, ADR-0010) and the MCA rule workbook in `data/`, and writes:
- `ci-2016.rules.json`: the rule model (ASTs, exemptions, applicability), tied to the taxonomy build by `meta.taxonomyHash`. The app loads this file.
- `ci-2016.authority.json`: taxonomy + rules joined (`assembleAuthority`), for tests and tools that run without the sidecar
- `ci-2016.coverage.json`: the business-rule coverage ledger (formalized / review-only / unimplemented per rule)

All are git-ignored. See `docs/04-xbrl-engine.md`.
