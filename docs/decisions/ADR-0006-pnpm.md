# ADR-0006 · pnpm workspaces
- **Status:** accepted (2026-11-10). Requested by the user: no npm.
- **Decision:** pnpm workspaces with `engine` and `ui`. Commit only `pnpm-lock.yaml`. If electron-builder struggles with pnpm symlinks, use `node-linker=hoisted`.
