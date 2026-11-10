# 09 · IPC & sidecar API contracts

## Renderer ↔ main (Electron IPC)
- Implemented in Phase 1: `app:info`, all `sidecar:*` channels and `menu:command`. The source of truth is `ui/shared/ipc.ts`; the other channels land with their phase.
- **Results, not throws:** fallible calls return `Result<T> = {ok:true,value} | {ok:false,error:{kind:'validation',problems[]}|{kind:'error',message}}`. Electron flattens thrown errors into "Error invoking remote method…", which loses form problems. Main registers handlers with `handleResult()` / `handleQuery()` (`ui/electron/main/ipc/handle.ts`); the renderer calls `unwrap()` (`ui/src/lib/result.ts`).
- **Phase 3 channels:** `project:*` (current, create, open, save, save-as, close, recent, forget-recent, recovery, recover, discard-recovery, elrs, changed) and `settings:*` (get, update, set-groq-key, clear-groq-key, pick-mca-tool, changed).
- The preload exposes **one** object, `window.xap`. It's typed in `ui/electron/preload/api.d.ts`, and the renderer never sees `ipcRenderer`.
- Channels are named `domain:action`. Request/response uses `ipcRenderer.invoke`; events from main use `on(...)` subscriptions that return an unsubscribe function.

| Domain | Channel | Direction | Payload → Result |
|---|---|---|---|
| app | `app:info` | invoke | → `{version, platform, isDev}` |
| sidecar | `sidecar:status` | invoke | → `SidecarStatus` |
| sidecar | `sidecar:status-changed` | event | `SidecarStatus` |
| sidecar | `sidecar:logs` | invoke | → `SidecarLogLine[]` (last 2000 lines, token redacted) |
| sidecar | `sidecar:log` | event | `SidecarLogLine` |
| sidecar | `sidecar:restart` | invoke | → `void` |
| menu | `menu:command` | event | `MenuCommand` (e.g. `file:save`, `filing:validate`) |
| sidecar | `sidecar:request` | invoke | `{method, path, body?}` → `{status, data}` (main adds the token; the renderer never sees it) |
| project | `project:create` | invoke | `NewFilingInput` (incl. `taxonomy`) → `ProjectSummary` |
| project | `project:open` | invoke | `path?` (dialog if empty) → `ProjectSummary` |
| project | `project:import-xbrl` | invoke | `mode: 'both' \| 'next', path?` (dialog if empty) → `{summary, report: ImportReportView}` (Phase 7; `InstanceImportService`) |
| project | `project:save` / `project:save-as` | invoke | → `{path}` |
| project | `project:recent` | invoke | → `RecentProject[]` |
| excel | `workbook:import` | invoke | `path?` → `WorkbookModel` (.xlsx/.xlsm in process; .xls through `POST /api/v1/workbooks/read`) |
| mapping | `mapping:cell-info` | invoke | `CellRef` → `CellInfo` (amount at the statement's precision + column period) |
| mapping | `mapping:set-column-period` | invoke | `CellRef, 'CY' \| 'PY' \| null` → `ColumnPeriod` (remembered per sheet column in `mapping.json`) |
| engine | `engine:set-value` / `engine:validate` / `engine:export-xml` / `engine:apply-fix` | invoke | (Phase 2+) |
| settings | `settings:get` / `settings:set` | invoke | non-secret settings |
| settings | `settings:set-groq-key` / `settings:has-groq-key` | invoke | the key is stored with safeStorage; it is never returned to the renderer |
| tools | `tools:open-mca-validator` | invoke | `xmlPath?` → `{launched}` |

```ts
type SidecarStatus =
  | { state: 'starting' } | { state: 'ready'; port: number; version: string }
  | { state: 'error'; message: string } | { state: 'stopped' }
```

## Main ↔ sidecar (HTTP)
- **Address and auth:** `http://127.0.0.1:<port>`. Every request except `/health` needs `Authorization: Bearer <token>`.
- **Configuration:** the port and token are passed as env vars `XAP_PORT`, `XAP_TOKEN`. `XAP_PARENT_PID` (Electron main's PID) makes the sidecar exit when the app is gone, even after a crash or force-kill. The Groq key is passed as `GROQ_API_KEY` from safeStorage, or from `.env` in dev.
- **Response envelope** (existing, `api/responses.py`): `{data, message, success, errors[]}`.

| Method & path | Purpose | Status |
|---|---|---|
| `GET /health` | `{status:"ok", version, taxonomies:[…], ai:{enabled, model}}` | Phase 1 |
| `GET /api/v1/taxonomies` | List taxonomies | exists |
| `GET /api/v1/taxonomies/{id}/elrs` | Statements/notes/disclosures: `{uri,id,code,title,group}` | **used by the UI** (2026-11-10) |
| `GET /api/v1/taxonomies/{id}/elrs/{code}/tree` | Presentation tree of one ELR → XBRL Form structure | **used by the UI** |
| `GET /api/v1/taxonomies/{id}/authority` | Engine authority (taxonomy half): concepts, ELRs, networks, tables, hypercubes, defaults, schemaRef, `meta.taxonomyHash`. `ci_taxonomy`, `ind_as_taxonomy`; others 404. The file is wrapped in the envelope as bytes (5–10 MB, not re-serialised). [ADR-0010](decisions/ADR-0010-engine-authority-from-knowledge-base.md) | **used by the app** (Phase 6, `AuthorityService`) |
| `GET /api/v1/taxonomies/{id}/concepts/search?q=&summary=true` | Ranked compact search `{total, items}` | **used by the UI**; without `summary`, the original shape is kept |
| `GET /api/v1/taxonomies/{id}/concepts/{qname}?include_rules=true` | Element + MCA business rules | fixed (was 500) |
| `GET /api/v1/taxonomies/{id}/roles/{key}` · `/business-rules/{index or element}` · `/rules` | Role detail, one rule, all rules | fixed (were 500 / returned roles) |
| `GET /api/v1/taxonomies/{id}/concepts?search=` | Concept list/filter | exists |
| `GET /api/v1/taxonomies/{id}/relationships/{kind}` | presentation/calculation/definition | exists |
| `GET /api/v1/taxonomies/{id}/business-rules?concept=` | Raw rules | exists |
| `GET /api/v1/taxonomies/recommend?keys=` | Legacy top-1 recommend | exists → superseded |
| `POST /api/v1/workbooks/read` | `{fileName, contentBase64}` → `{sheets:[{name,rowCount,colCount,cells,merges,colWidths}]}` (the `WorkbookModel` shape). python-calamine reads `.xls`; there are no number formats, so amounts round to the filing's decimal places. 422 for unreadable files | **used by the UI** (Phase 5) |
| `POST /api/v1/mapping/suggest` | Auto-tagging, see [06](06-ai-auto-tagging.md) | Phase 5 |
| `POST /api/v1/mapping/review` | Tagging-quality review | Phase 5 |
| `POST /api/v1/fix/propose` | Fix agent, see [07](07-ai-fix-agent.md) | Phase 7 |

**Rules:**
1. Validate every request with a Pydantic schema in `api/v1/schemas/`.
2. Endpoints are stateless. Anything persistent lives in Electron.
3. Long AI calls stream progress through `text/event-stream` when it helps the UI, which is optional.
