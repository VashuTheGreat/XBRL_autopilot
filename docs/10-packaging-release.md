# 10 · Packaging & release

**Target:** one Windows installer, `XBRL-Autopilot-Setup-<version>.exe` (NSIS). The user needs nothing else: no Python, Node or Java.

## Build pipeline
```
1. engine      pnpm --filter @xap/engine build          → engine/dist (bundled into ui by Vite)
2. knowledge   make rebuild (committed knowledge_base/*.json: taxonomies, engine authorities, business rules)
3. sidecar     uv run pyinstaller sidecar.spec           → sidecar-dist/xap-sidecar/ (onedir)
4. ui          pnpm --filter ui build                    → ui/out (main, preload, renderer)
5. installer   pnpm --filter ui dist                     → ui/release/*.exe
```

## electron-builder (in `ui/electron-builder.yml`)
- `appId: in.xbrlautopilot.desktop`, `productName: XBRL Autopilot`.
- `extraResources`:
  - `../sidecar-dist/xap-sidecar` → `resources/sidecar`
  - `../knowledge_base` → `resources/knowledge_base`
- `fileAssociations`: `{ ext: "axbrl", name: "XBRL Autopilot Project", role: "Editor", icon: build/axbrl.ico }`.
- NSIS: per-user install by default (no admin needed), with an option to change the directory, plus desktop and Start-menu shortcuts.
- `asar: true`. Native modules (better-sqlite3) are unpacked with `asarUnpack` and rebuilt for Electron through `electron-builder install-app-deps`.
- **pnpm:** if packaging trips over symlinked `node_modules`, set `node-linker=hoisted` in `.npmrc`.

## PyInstaller (`sidecar.spec`)
- **onedir**, not onefile. Startup is faster and antivirus false positives are fewer.
- Entry script: `api/__main__.py` → `uvicorn.run(app, host="127.0.0.1", port=$XAP_PORT)`.
- Hidden imports: uvicorn workers, chromadb, pydantic. Data: none, because the knowledge base and index ship in Electron `resources/`, located via the `XAP_RESOURCES` env var.
- Size control: replace torch/sentence-transformers with an ONNX runtime before release (see [06](06-ai-auto-tagging.md)).

## Runtime paths (packaged)
| What | Where |
|---|---|
| Sidecar exe | `process.resourcesPath/sidecar/xap-sidecar.exe` |
| Knowledge base (incl. engine authority + business rules) | `process.resourcesPath/knowledge_base` (read by the sidecar) |
| User data | `%APPDATA%/XBRL Autopilot/` (app.db, autosave/, logs/, chroma/) |

## Signing and updates (later)
- An EV code-signing certificate is needed to avoid SmartScreen warnings. Set it up in CI.
- Auto-update via `electron-updater` with a static update feed, after v1.

## Release checklist
- [ ] `pnpm test` and `make test` are green.
- [ ] The golden XML matches. The sample filing passes MCA Validation Tool v5.1 with 0 errors.
- [ ] Clean-VM install: start → sidecar ready → open a `.axbrl` by double-click → generate XML.
- [ ] Bump the version and update `docs/STATUS.md` changelog.
