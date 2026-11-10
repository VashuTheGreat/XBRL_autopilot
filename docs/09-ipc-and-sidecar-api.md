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
| project | `project:new` | invoke | `NewFilingInput` → `ProjectSummary` |
| project | `project:open` | invoke | `path?` (dialog if empty) → `ProjectSummary` |
| project | `project:save` / `project:save-as` | invoke | → `{path}` |
| project | `project:recent` | invoke | → `RecentProject[]` |
| excel | `excel:import` | invoke | `path?` → `WorkbookModel` |
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
- **Configuration:** the port and token are passed as env vars `XAP_PORT`, `XAP_TOKEN`. The Groq key is passed as `GROQ_API_KEY` from safeStorage, or from `.env` in dev.
- **Response envelope** (existing, `api/responses.py`): `{data, message, success, errors[]}`.

| Method & path | Purpose | Status |
|---|---|---|
| `GET /health` | `{status:"ok", version, taxonomies:[…], ai:{enabled, model}}` | Phase 1 |
| `GET /api/v1/taxonomies` | List taxonomies | exists |
| `GET /api/v1/taxonomies/{id}/concepts?search=` | Concept search | exists (fix Authority bug, Phase 5) |
| `GET /api/v1/taxonomies/{id}/relationships/{kind}` | presentation/calculation/definition | exists |
| `GET /api/v1/taxonomies/{id}/business-rules?concept=` | Raw rules | exists |
| `GET /api/v1/taxonomies/recommend?keys=` | Legacy top-1 recommend | exists → superseded |
| `POST /api/v1/mapping/suggest` | Auto-tagging, see [06](06-ai-auto-tagging.md) | Phase 5 |
| `POST /api/v1/mapping/review` | Tagging-quality review | Phase 5 |
| `POST /api/v1/fix/propose` | Fix agent, see [07](07-ai-fix-agent.md) | Phase 7 |

**Rules:**
1. Validate every request with a Pydantic schema in `api/v1/schemas/`.
2. Endpoints are stateless. Anything persistent lives in Electron.
3. Long AI calls stream progress through `text/event-stream` when it helps the UI, which is optional.
