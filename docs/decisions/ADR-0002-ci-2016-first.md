# ADR-0002 · v1 targets C&I 2016 (AOC-4 XBRL) only
- **Status:** superseded by [ADR-0007](ADR-0007-real-data-both-taxonomies.md) (2026-11-10)
- **Context:** the legacy engine and rule formalizer cover C&I 2016. Ind AS and Costing need new rule compilers.
- **Decision:** ship the full loop for C&I first. Keep the engine taxonomy-generic: authority JSON per taxonomy, no hard-coded qnames outside the compiler or curated rule files.
- **Consequences:** the Ind AS compiler work happens in Phase 9. The Python knowledge base already has all three taxonomies for AI context.
