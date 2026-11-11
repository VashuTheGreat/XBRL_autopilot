# End-to-end scripts (Chrome DevTools Protocol)

These scripts drive the real Electron app over CDP. They aren't Vitest tests yet; Playwright `_electron` is planned for Phase 11.

```bash
# from ui/ — isolated user data, dev build (window.__xap_test__ hooks exist only in dev)
taskkill //IM electron.exe //F            # make sure no instance holds the single-instance lock
XAP_USER_DATA="$TEMP/xap-e2e-$RANDOM" env -u ELECTRON_RUN_AS_NODE \
  ./node_modules/.bin/electron-vite dev -- --remote-debugging-port=9350 &
node e2e/phase4-editor.mjs 9350 <screenshotDir> "../data/sample_financials.xlsx"
```

`phase11-tables.mjs` (dev app, Ind AS + DGPL `.xls`, no AI): the steps are
1. Map as table on FA!B10:F29: real selects for the table, 9 rows (line item, role, year, gross / accumulated member) and 4 class columns; Preview reports 36 ready; Map tags 36 cells.
2. FA!E18 = PPE closing, computers, gross, CY, 0.73.
3. Excel → Form opens [400600] on that value, with its source chip and highlight. Form → Excel reveals E18.
4. Also as… (dialog, ★ tables first, element preselected): Equity share capital I39 is also reported as class "Equity shares 1"; the inspector chip and the Form's "also reported from I39" chip show it.
5. Table zeros → 0 clears the PPE ML-13 errors.
6. Removing the block untags its cells.

Usage: `node e2e/phase11-tables.mjs <port> <screenshotDir> "<path>/data/BS DGPL Mar-2026-V1.xls"`.

`linkage-follow.mjs` (dev app): Excel → Form follows the selection. A statement that shows the element stays open; selecting a tagged cell while another note is open switches to the statement that shows its element; the row is in view (below the sticky header) and highlighted; a row scrolled away comes back on a repeat click; clicking a Form value selects and reveals its cell. Usage: `node e2e/linkage-follow.mjs <port> <screenshotDir> "<path>/data/sample_financials.xlsx"`.

**Disk space:** each run's `XAP_USER_DATA` folder (~30–50 MB) stays in `%TEMP%`; delete old `xap-e2e-*` folders now and then. The unit tests clean up after themselves (`ui/test/global-setup.ts`).

`phase10-ai-fix.mjs` (dev app, **mock LLM**): start the app with `GROQ_URL=http://127.0.0.1:8765/openai/v1/chat/completions` in its environment; the script runs the mock (`mock-groq.mjs`) on that port. AI off without consent → consent + a dummy `gsk_…` key → PY-only share capital on BS!D9 → Ask AI → diff card from Excel C9 that clears the problem (dry run) → Accept → problem gone, C9 tagged with origin ai → History shows the exact payload (no CIN, no company name) → a user-supplied value needs input + confirmation; Reject recorded → Fix all: round 1 of ≤ 10 problems, all rejected → "nothing accepted" → consent off: Ask AI disabled, quick fixes stay. Usage: `node e2e/phase10-ai-fix.mjs <port> <screenshotDir> "<path>/data/sample_financials.xlsx" 8765`.

`phase10-live-groq.mjs` (dev app, **real Groq**, key from `.env`, no `GROQ_URL`): synthetic sample only; asks about the D9 problem and a few missing mandatory amounts and prints what the model proposed (cards, dropped, steps, tokens). Checks the contract only: a real model is not deterministic. Usage: `node e2e/phase10-live-groq.mjs <port> <screenshotDir> "<path>/data/sample_financials.xlsx" [problems=3]`.

`phase9-validation.mjs` (dev app): C&I filing + sample workbook → live problems and status-bar counts, rule coverage → a PY-only share capital tag gives a problem on BS!D9 → double-click locates D9 and opens [100100] → Fix clears it → pasted MCA errors are explained and linked to their element. Usage: `node e2e/phase9-validation.mjs <port> <screenshotDir> "<path>/data/sample_financials.xlsx"`.

`phase8-autotag.mjs` (dev app): Ind AS filing → import DGPL (.xls) → Auto-tag button → amber suggestions → inspector Accept (real click on I24) / Reject (I25) → Accept all ≥ 90% → the Form shows Total assets 1,904.45. LLM off (no AI consent). Usage: `node e2e/phase8-autotag.mjs <port> <screenshotDir> "<path>/data/BS DGPL Mar-2026-V1.xls"`.

`phase7-import.mjs` (dev app): Import XBRL dialog → Dixon import report (round trip, conventions) → Ind AS filing open. Usage: `node e2e/phase7-import.mjs <port> <screenshotDir> <instance.xml>` (the native file dialog is bypassed through the store's path argument).

`phase6-taxonomy.mjs` (dev app): New Filing taxonomy choice → Ind AS 2017 filing → status bar, 66 ELRs, Ind AS schemaRef. Usage: `node e2e/phase6-taxonomy.mjs <port> <screenshotDir>`.

`phase3-filing.mjs` runs against the built app (`pnpm build`, then `electron . --remote-debugging-port=…`). It doesn't need the test hooks.

## Gotchas learned the hard way
- **Univer 1.4 selection events:**
  - On a fresh grid the selection events start firing only after about the third click; `CellPointerUp` fires on every click and after a drag. The grid listens to both (a user's first click used to leave the inspector blank).
  - A user click fires `SelectionMoveEnd`, **not** `SelectionChanged`.
  - The payload's `selections` can be empty, so read `getActiveWorkbook().getActiveRange()` instead.
  - Programmatic `range.activate()` fires no event at all.
- **Clicking a cell from a test:** compute its position from `worksheet.getSkeleton()`: `rowHeaderWidth` / `columnHeaderHeight` plus `columnWidthAccumulation` / `rowHeightAccumulation`, relative to the **largest visible** canvas in the host. Don't use `getCellRect()` or `getScrollState()`, whose coordinates aren't page pixels.
- **Univer lifecycle:** create and dispose in a `setTimeout`, never inside React's commit. Two live instances (StrictMode double-mount with only disposal deferred) stop selection events reaching our handlers.
- **Fresh `XAP_USER_DATA`:** the main process creates the folder itself (SQLite opens before `app.ready`).
- **Orphaned sidecars:** `taskkill //F electron.exe` skips the app's quit handler. Before 2026-11-10 each run left a Python sidecar (~130 MB) behind; 11 of them starved the machine and the renderer died out of memory (black window, `renderer gone: oom` in the main log). The sidecar now exits when its parent PID (`XAP_PARENT_PID`) is gone. If memory looks short, check with `Get-CimInstance Win32_Process -Filter "Name like 'python%'"`.
- **Renderer crashes** are logged by main (`[main] renderer gone: <reason>`), and the page reloads (the filing lives in main).
- **Single instance:** a still-running app holds the single-instance lock, so a new instance quits at once. Kill old `electron.exe` first and use a fresh `XAP_USER_DATA`.
- **`ELECTRON_RUN_AS_NODE`** is set inside VS Code terminals: always launch with `env -u ELECTRON_RUN_AS_NODE`.
- **React effects:** `scrollIntoView()` returns a Promise in Electron 45's Chromium. Never write expression-bodied `useEffect`s.

The script prints `PASS`/`FAIL` per check and exits 1 on any failure (last green run: 2026-11-10).
