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
| mapping | `mapping:set-status` | invoke | `id, 'suggested' \| 'rejected'` → `MappingView`. Approving goes through `autotag:accept` / `mapping:tag` (it writes the fact); a tagged entry can't change status |
| mapping | `mapping:tag` | invoke | `TagCellInput` `{cell, concept, scope?, sign?, dims?, tableId?, preferredLabel?}` → `MappingView`. With `dims` the cell is a **table fact** (the table is found from the members unless given; written through `Session.setTableValue`). Validated field by field (`ipc/table-input.ts`) |
| mapping | `mapping:also-add` | invoke | `AlsoReportInput` `{mappingId, concept, dims, scope?, tableId?, preferredLabel?}` → `MappingView`: the tagged cell's figure is also filed as that fact ("also reported as", ADR-0013). Refused when another cell supplies the fact |
| mapping | `mapping:also-remove` | invoke | `mappingId, index` → `MappingView` (that fact is removed) |
| table | `table:catalog` | invoke | → `TableInfo[]` (tables with axes: id, title, statement code / title, line-item concepts) |
| table | `table:structure` | invoke | `tableId` → `TableStructure` (line items with period roles, axes with members) |
| table | `table:plan` | invoke | `TableBlockInput` `{cell: range, tableId, rows[{r, concept, preferredLabel?, scope?, members, cols?, also?[{concept, preferredLabel?}]}], cols[{c, members, scope?, alsoTotal?[axis]}], sign?}` → `TableBlockPlan` (one entry per non-empty cell: element, year, members, value, problems, `also[]` = the same figure reported again, each with its problems). `row.cols` limits a row to those columns. No changes |
| table | `table:apply` | invoke | `TableBlockInput` → `TableBlockResult` `{block, tagged, problems[]}`. Ready cells are tagged one by one (`blockId`), each with its ready "also" facts (one that can't be filed is listed in `problems`, the cell is still tagged; one another cell already files stays that cell's); a block over the same range is replaced |
| table | `table:list` / `table:remove` | invoke | → `TableBlock[]` / `blockId` → `void` (untags every cell of the block) |
| editor | `editor:fill-table-zeros` | invoke | `elrUri` → `TableZeroFilled[]`: in the statement's tables, the line items the mandatory-line-items rules require are reported as 0 in columns that already hold a value (engine `fillTableMandatoryZeros`) |
| autotag | `autotag:run` | invoke | → `AutoTagSummary` `{suggested, skipped, sheets[], llmUsed}`. Every imported workbook goes to `POST /api/v1/mapping/suggest`; the result is stored as `mapping.json` entries with status `suggested` (no fact). Skips cells and facts already tagged, and (cell, element) pairs the user rejected (Phase 8; `AutoTagService`) |
| autotag | `autotag:accept` | invoke | `id, concept?` → `MappingView`. `MappingService.tag` with the suggestion's origin and confidence; `concept` picks one of its alternatives (origin `manual`). Teaches `mapping_memory` |
| autotag | `autotag:reject` | invoke | `id` → `MappingView` (status `rejected`; not suggested again for that element) |
| autotag | `autotag:accept-all` | invoke | `min?` (default 0.9) → `AcceptAllResult` `{accepted, blocks, cells, problems[]}`: cell suggestions and table blocks at ≥ `min`, never suggested "also" facts; one the engine refuses stays suggested |
| autotag | `autotag:blocks` | invoke | → `BlockSuggestion[]` (mapping.json `blockSuggestions`, open and rejected; Phase 11 step 3b, `TableSuggestionService`) |
| autotag | `autotag:accept-block` | invoke | `id, edited?: TableBlockInput` → `TableBlockResult`: applies the suggested block (origin `table`), or the user's edited version (origin `manual`). Nothing tagged → validation error with the reasons; the suggestion stays open |
| autotag | `autotag:reject-block` | invoke | `id` → `BlockSuggestion` (status `rejected`; not suggested again for that range and table) |
| autotag | `autotag:accept-also` / `autotag:reject-also` | invoke | `mappingId, index` → `MappingView`: files (`addAlso`) or drops one suggested "also reported as" fact of a tagged cell (`alsoSuggested[index]`) |
| validation | `validation:get` | invoke | → `ValidationView` (latest run; revalidated 400 ms after every change) |
| validation | `validation:changed` | event | `ValidationView` (after every run; the renderer keeps the highest `revision`) |
| validation | `validation:run` | invoke | → `ValidationView` (now) |
| validation | `validation:fix` | invoke | `problemId` → `ValidationView` (engine `fixFor` on an issue of the latest run, then revalidates) |
| validation | `validation:import-mca` | invoke | `text?` (file dialog when omitted, ≤ 2 MB) → `ValidationView` (kept in `mca-errors/`) |
| validation | `validation:clear-mca` | invoke | → `ValidationView` |
| settings | `settings:get` / `settings:set` | invoke | non-secret settings |
| settings | `settings:set-groq-key` / `settings:has-groq-key` | invoke | the key is stored with safeStorage; it is never returned to the renderer |
| tools | `tools:launch-mca` | invoke | → `McaLaunchResult` `{xmlPath, toolPath, validated}`: writes `output/NNN.xml`, starts the MCA tool detached (Phase 9; `McaToolService`). The menu command `tools:open-mca-validator` calls it |
| ai | `ai:get` | invoke | → `AiView` `{revision, status, run, proposals}` (`ui/shared/ai.ts`; Phase 10, `FixAgentService`) |
| ai | `ai:changed` | event | `AiView` (after every proposal / decision, and when consent, key, sidecar or project change) |
| ai | `ai:propose` | invoke | `problemId` → `AiView`: Ask AI on one problem of the latest validation run (one sidecar request) |
| ai | `ai:fix-all` | invoke | → `AiView`: starts the Fix all loop in the background (rounds of ≤ 10 errors, ≤ 5 rounds, token / time budget) |
| ai | `ai:stop` | invoke | → `AiView` (stop reason `stopped`) |
| ai | `ai:accept` | invoke | `cardId, {input?, confirmed?}` → `AiView`: checks again, applies through Session / MappingService, revalidates. `input` = the value typed in the card (Edit, or a user-supplied value, ≤ 400 chars); `confirmed` is required for removals and user-supplied values |
| ai | `ai:reject` | invoke | `cardId, reason?` → `AiView` (recorded in `ai/history.jsonl`) |
| ai | `ai:clear` | invoke | → `AiView` (drops proposals with no open card) |
| ai | `ai:history` | invoke | → `AiHistoryEntry[]` (the newest 200 lines of `ai/history.jsonl`) |

```ts
type SidecarStatus =
  | { state: 'starting' } | { state: 'ready'; port: number; version: string }
  | { state: 'error'; message: string } | { state: 'stopped' }
```

## Main ↔ sidecar (HTTP)
- **Address and auth:** `http://127.0.0.1:<port>`. Every request except `/health` needs `Authorization: Bearer <token>`.
- **Configuration:** the port and token are passed as env vars `XAP_PORT`, `XAP_TOKEN`. `GROQ_URL` (optional, inherited) points the shared Groq client at another endpoint; only https or loopback http is accepted (the E2E's mock LLM). `XAP_PARENT_PID` (Electron main's PID) makes the sidecar exit when the app is gone, even after a crash or force-kill. The Groq key is passed as `GROQ_API_KEY` from safeStorage, or from `.env` in dev.
- **Response envelope** (existing, `api/responses.py`): `{data, message, success, errors[]}`.

| Method & path | Purpose | Status |
|---|---|---|
| `GET /health` | `{status:"ok", version, taxonomies:[…], ai:{enabled, model}}` | Phase 1 |
| `GET /api/v1/taxonomies` | List taxonomies | exists |
| `GET /api/v1/taxonomies/{id}/elrs` | Statements/notes/disclosures: `{uri,id,code,title,group}` | **used by the UI** (2026-11-10) |
| `GET /api/v1/taxonomies/{id}/elrs/{code}/tree` | Presentation tree of one ELR → XBRL Form structure | **used by the UI** |
| `GET /api/v1/taxonomies/{id}/authority` | Engine authority (taxonomy half): concepts, ELRs, networks, tables, hypercubes, defaults, schemaRef, `meta.taxonomyHash`. `ci_taxonomy`, `ind_as_taxonomy`; others 404. The file is wrapped in the envelope as bytes (5–10 MB, not re-serialised). [ADR-0010](decisions/ADR-0010-engine-authority-from-knowledge-base.md) | **used by the app** (Phase 6, `AuthorityService`) |
| `GET /api/v1/taxonomies/{id}/engine-rules` | Executable business rules: rule ASTs, exemptions, table applicability, Yes/No dependencies, `meta.taxonomyHash` / `authorityHash`. `ci_taxonomy`, `ind_as_taxonomy`; others 404 (the app then uses an empty rule model). Wrapped as bytes like `/authority`. [ADR-0011](decisions/ADR-0011-business-rules-from-knowledge-base.md) | **used by the app** (Phase 9, `SidecarRuleBundleSource`) |
| `GET /api/v1/taxonomies/{id}/concepts/search?q=&summary=true` | Ranked compact search `{total, items}` | **used by the UI**; without `summary`, the original shape is kept |
| `GET /api/v1/taxonomies/{id}/concepts/{qname}?include_rules=true` | Element + MCA business rules | fixed (was 500) |
| `GET /api/v1/taxonomies/{id}/roles/{key}` · `/business-rules/{index or element}` · `/rules` | Role detail, one rule, all rules | fixed (were 500 / returned roles) |
| `GET /api/v1/taxonomies/{id}/concepts?search=` | Concept list/filter | exists |
| `GET /api/v1/taxonomies/{id}/relationships/{kind}` | presentation/calculation/definition | exists |
| `GET /api/v1/taxonomies/{id}/business-rules?concept=` | Raw rules | exists |
| `GET /api/v1/taxonomies/recommend?keys=` | Legacy top-1 embedding recommend (needs the Chroma index, not built) | superseded by `/mapping/suggest` |
| `POST /api/v1/workbooks/read` | `{fileName, contentBase64}` → `{sheets:[{name,rowCount,colCount,cells,merges,colWidths}]}` (the `WorkbookModel` shape). python-calamine reads `.xls`; there are no number formats, so amounts round to the filing's decimal places. 422 for unreadable files | **used by the UI** (Phase 5) |
| `POST /api/v1/mapping/suggest` | Auto-tagging: `{taxonomy, sheets:[{name, cells:[{r,c,v}], merges?:[{r1,c1,r2,c2}]}], periods:{cyEnd, pyEnd}, level, memory:[{label, concept, approvals}], options:{useLlm, maxCandidates}}` → `{layout[], suggestions[] (each may carry `also[]`), blocks[] (rows / cols as `table:plan` takes them; `cells[].also` = the extra facts), llmUsed, level}`. `ci_taxonomy`, `ind_as_taxonomy` (others 422). Stateless; LLM rerank only with `useLlm` **and** a Groq key. See [06](06-ai-auto-tagging.md) | **used by the app** (Phase 8, `SidecarMappingSuggester`) |
| `POST /api/v1/mapping/review` | Tagging-quality review | later |
| `POST /api/v1/fix/propose` | Fix agent ([07](07-ai-fix-agent.md), [ADR-0012](decisions/ADR-0012-ai-fix-patches.md)): `{taxonomy, problem, facts[], sources[], meta, options:{maxSteps ≤ 6, maxTokens}}` (`src/services/fix_agent/bundle.py`) → `{summary, patches[], dropped[], resolves[], needsHuman, steps, usage, toolCalls[], stop, model}`. 409 `ai.disabled` (no key), 422 `privacy` (identity data in the bundle; nothing sent), 502 `ai.failed`. The app calls it with a 6.5 min timeout (`SidecarClient.request(…, timeoutMs)`) | **used by the app** (Phase 10, `SidecarFixProposer`) |

**Rules:**
1. Validate every request with a Pydantic schema in `api/v1/schemas/`.
2. Endpoints are stateless. Anything persistent lives in Electron.
3. Long AI calls stream progress through `text/event-stream` when it helps the UI, which is optional.
