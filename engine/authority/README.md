# Assembled engine authorities (generated)

`pnpm --filter @xap/engine assemble:authority` (run by the engine and ui test scripts) joins the two knowledge-base
halves of each taxonomy (ADR-0010, ADR-0011) into `<taxonomy>.authority.json`, for tests and tools that run without
the sidecar:
- `knowledge_base/<kb>_engine_authority.json`: the taxonomy half (`make engine-authority`)
- `knowledge_base/<kb>_engine_rules.json`: the business rules (`make engine-rules`)

Nothing is compiled here. The app loads both halves through the sidecar routes. All files here are git-ignored.
See `docs/04-xbrl-engine.md`.
