# 03 · Project file `.axbrl`

An **`.axbrl`** ("AutoPilot XBRL") file is one filing: one company, one financial year, standalone or consolidated. It's a **zip archive**, the same idea as `.docx`, so it's portable, inspectable and can be emailed between colleagues. The extension is registered with Windows at install, so double-clicking a file opens the app exactly where the user left off.

## Layout (format version 1)
```
my-company_FY2025-26_standalone.axbrl
├─ manifest.json          # required, read first
├─ filing.json            # engine Filing.toJSON() — facts, footnotes, meta (source of truth for XML)
├─ mapping.json           # Excel cell ↔ fact linkage + AI provenance
├─ source/
│  ├─ workbook-1.xlsx     # original imported workbook(s), byte-identical
│  └─ edits.json          # cell edits made inside the app (sheet!A1 → value), applied over the xlsx
├─ validation.json        # last issue snapshot (for instant reopen; recomputed on load)
├─ mca-errors/
│  └─ 2026-11-10T1015.txt # raw text imported from the MCA Validation Tool
├─ ai/
│  └─ history.jsonl       # one line per AI suggestion / patch proposal + user decision
├─ output/
│  └─ 001.xml, 002.xml    # generated instances (numbered; latest = highest)
└─ ui-state.json          # open tabs, selected ELR, pane sizes (optional, cosmetic)
```

### `manifest.json`
```json
{
  "format": "axbrl",
  "formatVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "2026-11-10T10:00:00Z",
  "updatedAt": "2026-11-10T11:30:00Z",
  "taxonomy": { "id": "ci-2016", "authorityHash": "sha256:…" },
  "company": { "name": "Acme Pvt Ltd", "cin": "U12345MH2010PTC123456" },
  "filing": { "reportType": "standalone", "cy": { "start": "2025-04-01", "end": "2026-03-31" },
              "py": { "start": "2024-04-01", "end": "2025-03-31" }, "firstFinancialYear": false,
              "roundingLevel": "Lakhs" }
}
```

### `mapping.json`
```json
{
  "version": 1,
  "entries": [
    {
      "id": "m_01H…",
      "cell": { "workbook": "workbook-1.xlsx", "sheet": "BS", "ref": "C5" },
      "label": "Share capital",
      "fact": { "concept": "in-gaap:ShareCapital", "period": "cy", "dims": [] },
      "sign": 1, "scale": "Lakhs",
      "origin": "ai",            // ai | memory | exact | manual
      "confidence": 0.93,
      "rationale": "Row label matches standard label; balance credit; ELR 100100",
      "status": "approved"       // suggested | approved | rejected
    }
  ]
}
```

## Rules
- **The source of truth for XML is `filing.json`.** `mapping.json` explains where each value came from, and lets "re-pull from Excel" work after the workbook changes.
- **Never modify `source/*.xlsx`.** In-app edits go to `edits.json`.
- **Unknown files in the zip are preserved** on save, for forward compatibility.
- **Version migration:** check `formatVersion` on open. Newer than supported → open read-only with a warning. Older → migrate in memory, and write the new version on the next save.
- **Writes are atomic:** write to `*.axbrl.tmp` → fsync → rename. Keep the previous file as `*.axbrl.bak` (one generation).
- **Legacy import:** `lagacy_js` project files (`*.mca-ci.json`) can be imported; they become `filing.json`.

## Autosave and recovery
- Autosave every 30 s while dirty, and on window blur, to `%APPDATA%/XBRL Autopilot/autosave/<projectId>.axbrl`.
- On a clean close, delete the autosave. On start, if any autosave exists → "Recover unsaved work?" dialog.
- The title bar shows `•` while there are unsaved changes. Ctrl+S saves.

## App database (not in the project file)
`%APPDATA%/XBRL Autopilot/app.db` (SQLite):
- `recent_projects(path, company, cin, fy, opened_at)`
- `mapping_memory(norm_label, sheet_kind, concept, period_hint, dims_json, approvals, last_used, taxonomy_id)`. This is the "learns from your approvals" store, reused across clients and years.
- `settings(key, value)`. Secrets aren't stored here; the Groq key is kept with `safeStorage`.
