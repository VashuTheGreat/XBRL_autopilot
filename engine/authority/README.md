# Compiled authorities (generated)

`pnpm --filter @xap/engine compile:authority` writes:
- `ci-2016.authority.json`: the executable C&I 2016 authority (concepts, ELRs, tables, calculation networks, rule ASTs)
- `ci-2016.coverage.json`: the business-rule coverage ledger (formalized / review-only / unimplemented per rule)

Both are git-ignored and rebuilt from `data/`. See `docs/04-xbrl-engine.md`.
