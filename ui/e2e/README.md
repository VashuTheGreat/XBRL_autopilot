# End-to-end scripts (Chrome DevTools Protocol)

These scripts drive the real Electron app over CDP. They aren't Vitest tests yet; Playwright `_electron` is planned for Phase 11.

```bash
# from ui/ — isolated user data, dev build (window.__xap_test__ hooks exist only in dev)
taskkill //IM electron.exe //F            # make sure no instance holds the single-instance lock
XAP_USER_DATA="$TEMP/xap-e2e-$RANDOM" env -u ELECTRON_RUN_AS_NODE \
  ./node_modules/.bin/electron-vite dev -- --remote-debugging-port=9350 &
node e2e/phase4-editor.mjs 9350 <screenshotDir> "../data/sample_financials.xlsx"
```

`phase3-filing.mjs` runs against the built app (`pnpm build`, then `electron . --remote-debugging-port=…`). It doesn't need the test hooks.

## Gotchas learned the hard way
- **Univer 1.4 selection events:**
  - A user click fires `SelectionMoveEnd`, **not** `SelectionChanged`.
  - The payload's `selections` can be empty, so read `getActiveWorkbook().getActiveRange()` instead.
  - Programmatic `range.activate()` fires no event at all.
- **Clicking a cell from a test:** compute its position from `worksheet.getSkeleton()`: `rowHeaderWidth` / `columnHeaderHeight` plus `columnWidthAccumulation` / `rowHeightAccumulation`, relative to the **largest visible** canvas in the host. Don't use `getCellRect()` or `getScrollState()`, whose coordinates aren't page pixels.
- **Single instance:** a still-running app holds the single-instance lock, so a new instance quits at once. Kill old `electron.exe` first and use a fresh `XAP_USER_DATA`.
- **`ELECTRON_RUN_AS_NODE`** is set inside VS Code terminals: always launch with `env -u ELECTRON_RUN_AS_NODE`.
- **React effects:** `scrollIntoView()` returns a Promise in Electron 45's Chromium. Never write expression-bodied `useEffect`s.

## Known open items (Phase 4)
- **Unmount warning:** "Attempted to synchronously unmount a root while React was already rendering" appears when the Univer grid unmounts. Defer `univer.dispose()` with `setTimeout`.
- **XML highlight:** the selected-fact line highlight (`.xap-xml-line`) wasn't counted in the last run. Check decoration timing after Monaco mounts.
