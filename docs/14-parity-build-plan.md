# 14 · Build plan: webXBRL parity + AI

**What this is:** the order in which we build everything [13-webxbrl-parity.md](13-webxbrl-parity.md) found missing. Each step is one chat / one PR. It is sized to finish with tests and docs in that chat.

**Rules for every step:**
- Follow CLAUDE.md: a deterministic engine, AI only proposes, decimals for money, thin IPC and components, services tested without Electron, taxonomy-generic (never key on ELR codes).
- **Done means:**
  - `pnpm typecheck` and `pnpm test` are green;
  - new engine logic has engine tests;
  - new services have UI vitest tests;
  - the doc is updated: the step's row in §13 of [13](13-webxbrl-parity.md) is flipped to ✅, and a dated line is added to [STATUS.md](STATUS.md).
- Check against the real fixtures (DGPL = Ind AS, HPL = C&I) through the existing scoreboard tests. Never send them to an AI service.

## Context for a new chat (read this first)
Each step is meant to be done in a fresh chat with no memory of earlier ones. This section is enough to start.

**The product:**
- XBRL Autopilot is an Electron desktop app for Indian CAs filing MCA **AOC-4 XBRL**, an AI-assisted alternative to Webtel webXBRL.
- The Excel financials are on the left and the XBRL Form / XML on the right; cell ↔ fact links show both ways.
- AI suggests tags. A deterministic engine generates and validates.
- Work is saved in `.axbrl` project files.
- Taxonomies: C&I 2016 and Ind AS 2017.

**Where things live:**

| Concern | Path |
|---|---|
| Rules of the repo | `CLAUDE.md` (non-negotiables), `docs/README.md` (doc index), `docs/STATUS.md` (history) |
| What webXBRL does, and our gaps | `docs/13-webxbrl-parity.md` (§11 = click-by-click, §12–13 = videos, gap tables) |
| Engine (pure, deterministic) | `engine/src/` (TS entry `index.ts`, newer modules such as `mandatory-zeros.ts`, `table-mapping.ts`), `engine/src/core/*.js` (ported core) |
| Engine pieces most steps reuse | `core/session.js` (filing state, `setTableValue`, recalculation), `core/derived.js` (`statementNoteLinks`, `statementLinksFrom`), `core/calculation.js` (`runCalculations`, `ctxOf`), `core/views.js` (`buildElrView`, `buildTableView`), `core/mandatory-marks.js`, `core/footnotes.js`, `core/richtext.js`, `core/pdf-preview.js`, `core/applicability.js`, `core/decimal.js` |
| App contracts (shared main ↔ renderer types) | `ui/shared/editor.ts` (`FormView`, `FormRow`, `FormCell`, `FormTable`), `ui/shared/project.ts`, `ui/shared/ipc.ts`, `ui/shared/workbook.ts` |
| Main-process services (Electron-free, DI through ports) | `ui/electron/main/services/` — `editor-query-service.ts` (builds the Form), `mapping-service.ts` (cell → fact tagging), `statement-service.ts`, `table-mapping-service.ts`, `validation-service.ts`, `auto-tag-service.ts`, `ports.ts` |
| IPC + preload | `ui/electron/main` (handlers), `ui/electron/preload` (typed bridge) |
| Renderer (React 19 + Tailwind 4, zustand stores) | `ui/src/features/xbrl/FormView.tsx` (the Form), `features/excel/` (Univer grid, `ManualTagDialog.tsx`), `features/taxonomy/TaxonomyPanel.tsx`, `features/tables/`, `features/bottom/ProblemsPanel.tsx`, `ui/src/stores/` (`editor.ts`, `project.ts`, `validation.ts`) |
| Python sidecar (taxonomy KB, AI) | `api/`, `src/` (FastAPI, `uv`); routes `/api/v1/taxonomies/{id}/…` |
| Tests | `engine` tests (vitest + ported node:test); `ui/test/*.test.ts` (vitest; `scoreboard-dgpl.test.ts` and `hpl-real-data.test.ts` run on the real fixtures); `ui/e2e/*.mjs` (Electron E2E, `mock-groq.mjs` for AI) |
| Real fixtures | `data/` (see `docs/12-reference-data.md`). Read-only, never sent to AI |

**Commands:**
- `pnpm install`;
- `pnpm typecheck`;
- `pnpm test` (all JS);
- `pnpm --filter @xap/engine test`;
- `uv sync --extra dev && make test` (Python).
- Run the app: `env -u ELECTRON_RUN_AS_NODE pnpm dev`. The first sidecar start takes about 60 s.

**Conventions that bite:**
- Money is engine decimal strings, never JS floats.
- Never key on ELR codes; group by title (`classify_elr`) or use authority data.
- Taxonomy facts come from the authority / KB, never hard-coded.
- IPC handlers and components only validate, delegate and render. Logic goes in services or the engine.
- pnpm only.
- Branch from the current feature branch. Commit only when the user asks.
- **Clean, reusable code with SOLID principles** (CLAUDE.md rule 7):
  - **One responsibility per module:** engine helper, service, IPC handler and component are each separate.
  - **Depend on small interfaces** (`ports.ts`) passed in through the constructor, so services are unit-tested without Electron.
  - **Extend rather than edit:** add a module or option instead of growing `if` chains in an existing one.
  - **Reuse before writing:** search `engine/src`, `engine/src/core`, `engine/src/basics.ts` and `ui/shared/` first. Shared helpers go there, never copy-paste.
  - **Keep functions small and named for what they do;** no dead code, no commented-out code.
- **No heuristic parsers.** Don't "understand" a workbook with piles of if/else (keyword matches, column guesses, per-file special cases) and call it an engine.
  - Use general mechanisms instead: workbook structure (formulas, totals that add up, number formats), taxonomy data, or AI that proposes and deterministic checks that verify.
  - Rules are fine only when they encode a real invariant.
  - If a general solution isn't feasible, stop and ask the user.

**Prompt template for a step** (paste into a new chat, replacing N):
> Read `docs/14-parity-build-plan.md` (start with "Context for a new chat"), then implement **Step N** fully in one go: engine, shared contract, main service, IPC if needed, renderer, tests, docs. Follow CLAUDE.md. Before coding, skim the files the step names and the parity sections it cites in `docs/13-webxbrl-parity.md`. When done, run `pnpm typecheck` and `pnpm test`, fix any failures, set Step N to ✅ in the plan's table, flip the matching rows in doc 13, add a dated line to `docs/STATUS.md`, and summarise what changed. Don't commit unless I ask.

**Status legend:** ⬜ not started · 🟨 in progress · ✅ done

| # | Step | Parity refs | Pri | Status |
|---|---|---|---|---|
| 1 | Statement ↔ note matching: difference per line, red / green, Go to note (F7), statement Difference footer | §11.6, §12.2, §12.9 | P0 | ✅ |
| 2 | Statement tree: E / L / T markers, mandatory red, tagged green, expand / collapse all; tagged marks in the Taxonomy panel | §4, §11.6, §12.2 | P0 | ✅ |
| 3 | Add / Replace on a tagged line + View details (cells that aren't next to each other summed into one fact) | §11.6, §12.9 | P0 | ✅ |
| 4 | Manual Tag dialog fixes (AI for untagged rows, scoped to the statement, used elements marked, text-aware ranking, range kept, description column, Next untagged, single open) | §8 | P0 | ⬜ |
| 5 | Mandatory text / date / Yes-No dialog + conditional mandatory (CSR, auditor qualification) + Generate confirmation of key answers | §2, §12.5, §13.4 | P0 | ✅ |
| 6 | Note editor (F2): MCA-subset rich text, paste from Word / Excel, Auto format tables, open a `.docx` as a document; parent-text-block warning | §3, §4, §13.1–13.4 | P0 | ✅ |
| 7 | Preview tab (MCA-like render) + PDF with MCA-style format settings | §7, §12.1 | P0 | ✅ |
| 8 | Right-click menus + footnotes UI (CY / PY, table cells, one on many) + change sign + properties | §3, §4, §12.2 | P1 | ⬜ |
| 9 | Masters panel: company, directors grid, auditor; fill auditor / signatories from masters; dropdown enumerations; PAN and name checks | §2, §11.6, §13.4 | P1 | ✅ |
| 10 | Tables: show / hide members, copy PY → CY, load static data from PY, read-only computed totals | §11.6, §12.3, §13.4 | P1 | ⬜ |
| 11 | Import hygiene + error flow: merged-cell warning, rounding check, side Problems panel, one-click MCA-tool import, notes checklist | §6, §12.9, §13.4 | P1 | ⬜ |
| 12 | AI quality review: deterministic checks for the §12.7 list + AI proposals the user accepts | §12.7 | P1 | ⬜ |
| 13 | P2 batch: export the mapping to Excel, versioned backups, applicability check, narration snippets, duplicate PAN / DIN, Ind AS 3-year, open last year's `.axbrl`, cash-flow "not applicable" | §0, §5, §11.6, §12.8 | P2 | ⬜ |

**Chat grouping.** Steps that share files and engine pieces run in one chat, so the context is loaded once. Big or risky steps stay alone. Inside a chat, finish and test the first step before starting the second. If context runs short, mark the second step 🟨 and stop at a clean point.

| Chat | Steps | Why together |
|---|---|---|
| — | 1 | Done |
| A | 2 + 5 | Both use `mandatory-marks.js` and the Form's red markers |
| B | 3 | `.axbrl` format change (ADR + migration): alone |
| C | 4 | Eight dialog fixes + an AI call: alone |
| D | 6 | New editor UI: alone |
| E | 7 + 10 | Both wire engine helpers that already exist (`buildPreviewHtml`, `carryForward`, `fillTotals`) |
| F | 8 + 9 | Right-click "Fill from master" and footnotes touch the same Form and panel code |
| G | 11 + 12 | Quality-review findings go into the Problems panel that Step 11 wires up |
| H | 13 | P2 batch |

For a combined chat, use the template with "Steps N and M (in that order)".

---

## Step 1 · Statement ↔ note matching
**Why:** this is webXBRL's main defence against the most common MCA error (statement ≠ note). A line stays red until its note or table adds up to the statement figure. The footer shows whether the whole statement is tagged.

**Already in the code (reuse, don't rebuild):**
- `statementNoteLinks(A)` and `statementLinksFrom` in `core/derived.js`: statement line → note row, table column or sum.
- `runCalculations` in `core/calculation.js`.
- `EditorQueryService.form()` builds the Form rows.

**Engine (`engine/src/note-ties.ts`, exported from `index.ts`):**
- `noteTies(session, elrUri)` returns, for each line of the ELR that has a link in `statementNoteLinks(A)` (`core/derived.js`):
  - `{ concept, kind: 'row' | 'column' | 'sum', target: { elrUri, tableId? }, cy, py }`;
  - each period holds `{ statement, note, difference, status: 'ok' | 'mismatch' | 'note-empty' | 'no-statement' }`;
  - amounts are decimal strings.
- `statementDifference(session, elrUri)` returns, per period, the calculation inconsistencies of that ELR's networks from `runCalculations`, plus one total difference figure. It is generic: it uses the ELR's own calculation roots and never hard-codes Assets = Equity + Liabilities.
- Use the engine decimal; reuse `ctxOf` / `f.value`. Respect applicability: a closed year or a non-applicable ELR is `no-statement`.

**App contract (`ui/shared/editor.ts`):**
- `FormRow.note?: { elrUri; tableId?; cy?; py? }` with the status per period.
- `FormView.difference?: { cy?: string; py?: string; issues: number }`.

**Main:** `EditorQueryService.form()` fills those fields from the engine. No new IPC is needed beyond the existing form call, plus `goToNote(concept)` if the renderer can't resolve the target from the row.

**Renderer (`FormView.tsx`):**
- The line's label is green when every period is `ok` and red on `mismatch` or `note-empty`. The tooltip shows "statement 1,23,456 · note 1,20,000 · difference 3,456".
- **Go to note:** an icon button on the row and **F7** on the selected row. It switches to the target ELR and scrolls to the table or row.
- **Footer:** "Difference CY 0 · PY 0", green at 0. Clicking it lists the issues in the Problems panel.

**Tests:**
- Engine unit tests with a small synthetic authority, plus DGPL and HPL assertions: lines known to tie show `ok`; break one note value and see `mismatch`.
- A UI test of `form()` that includes `note` and `difference`.

**Docs:** [13 §11.6 / §12.9](13-webxbrl-parity.md) rows → ✅; [04-xbrl-engine](04-xbrl-engine.md) gets a note-ties section; [08-ui-ux](08-ui-ux.md) documents the Form colours, F7 and the footer; a STATUS line.

## Step 2 · Statement tree markers and tagged status
**Already in the code:**
- `core/mandatory-marks.js` (`mandatoryCell`) evaluates the MCA rules, including "mandatory if Yes / > 0". It is **not exported or used by the app yet**: export it and use it.
- `FormRow.kind` / `dataType` / `tableId` are enough to derive E / L / T.

- On each Form row: **E** for a text block, **L** for a linked text block, **T** for a table.
  - Double-click on T opens the table (scroll or expand).
  - Double-click on E starts text tagging for that element.
- Mandatory empty rows are red (from `mandatory-marks.js`); tagged rows are green.
- Expand / collapse per header, and **Ctrl+E** for all.
- Taxonomy panel and Manual Tag dialog results: a tick plus "tagged at BS!C14" on elements already used.
- Tests: the marker derivation in the engine or a shared helper; the UI test covers the form rows.

## Step 3 · Add / Replace + View details
- Today a mapping is one cell or one contiguous range. Allow a fact to be the **sum of several sources** (cells or ranges anywhere).
  - This changes the `.axbrl` mapping shape: write an ADR, bump the format version, migrate old files.
- Tagging a line that already has a value asks **Add / Replace / Cancel**.
- **View details** lists every source cell with its value and the total, and offers to save the list as a footnote.
- Tests: mapping-service add / replace / untag-one-source; `.axbrl` round trip and migration.
- **Done (2026-11-14):** [ADR-0015](decisions/ADR-0015-multi-source-mapping.md). `MappingEntry.sources` (format 2, migration in `project/migrations.ts`); `MappingService.conflict / addSource / removeSource / details`; engine `sumAmounts`; `SourceFootnoteService` (engine footnotes now exported); renderer `stores/sources.ts`, `features/sources/` (Add / Replace dialog, View details). Tests: `ui/test/mapping-sources.test.ts`, `axbrl.test.ts` migration, `engine/test/amounts.test.ts`.

## Step 4 · Manual Tag dialog fixes
**Already done (skip):**
- showing an existing AI suggestion with confidence, rationale, runner-ups and Accept / Reject;
- prefilled search;
- manual tag = approved (`ManualTagDialog.tsx`).

§8 items 1–8, in that order:
- one sidecar suggest call for an untagged row (label + figure + sheet context, with the privacy guard), showing the top 3;
- statement-scoped ranking and a "This statement" tree tab;
- used-element marks and a duplicate-fact warning;
- text-cell ranking (text block / string / date / boolean);
- keep the range on double-click;
- the configured description column;
- **Next untagged ↓** (shortcut);
- one open path.
- Item 9 (learning from corrections) is recorded per project only.
- Tests: the ranking helper; the suggest call mocked in E2E; one live Groq smoke on synthetic data.

## Step 5 · Mandatory non-numeric + conditional mandatory + Generate confirmation
**Already in the code:**
- `core/mandatory-marks.js` handles conditional mandatory ("if Yes");
- `core/applicability.js` handles which ELRs, concepts and tables apply;
- ~~the Generate dialog already blocks on errors ("Fix first")~~ — it did not exist; Step 5 built it (the export gate blocks on errors);
- `fillMandatoryZeros` covers the numbers.

So this step is wiring plus the dialog, not new rule logic.

- One dialog lists the mandatory **text, date and Yes/No** items still empty, with inline inputs.
- Conditional rules come from the engine business rules:
  - CSR applicable = No closes the CSR items;
  - auditor's report qualified = Yes requires the remarks.
- The Form's red markers follow the same rules.
- Generate shows a confirmation of the key answers (subsidiary, holding, CSR applicable, auditor qualified) before writing.
- Tests: engine applicability for the conditional pairs; the Generate dialog flow.

## Step 6 · Note editor (F2)
**Already in the code:**
- `core/richtext.js`: `toMca`, `fromMca` and `tidyRichText` convert editor HTML ↔ MCA markup with the Filing Manual whitelist, tables included. They are exported, and `mapping-service.ts` uses `toMca` for text-range tagging.
- Missing: the editor UI, clipboard / `.docx` intake, Auto format, the parent-block warning.

- A rich-text editor limited to the MCA HTML subset (`core/richtext.js`).
  - Paste from Word or Excel keeps paragraphs and tables.
  - **Auto format** normalises pasted tables.
  - A live check shows whether the content will render in the MCA PDF.
- Open a `.docx` as a document in a notes view: convert to MCA HTML; select a block, then double-click the element.
- Warn when a sub-item is tagged but its parent text block isn't.
- Text blocks are CY only.
- Tests: the HTML sanitiser and table normaliser on Word / Excel clipboard samples; `.docx` conversion.

**Built (2026-11-14):**
- **Engine** `notes.ts`, composing `core/richtext.js` and `gate.js` (no second sanitiser): `noteValue` / `noteForEditor` (text block ↔ MCA markup, text item ↔ plain text), `checkNote` (`htmlGuidelineIssues` + `layoutReport`: "will render in the MCA PDF"), `autoFormatNote` (`tidy` with `wideTables`, then the MCA grid), `documentBlocks` (new `richtext.blocks`), `parentTextBlock` (direct presentation parent), `noteStructureIssues`.
- **Parent text block:** the hint is INFO in the Problems panel, once per element. Dixon, generated by webXBRL and accepted by MCA, reports 14 sub-items without their parent, so it is not an MCA rule. The editor shows it as a warning when opening or saving. Only non-dimensional sub-items directly under a text block count.
- **Text blocks are CY only:** the editor writes CY. Dixon carries one PY text block, so a PY text block is not reported.
- **App:** `NoteEditorService` (ports: `ProjectAccess`, `DocxConverter`), `MammothDocxConverter` (mammoth 1.8.0, images dropped), IPC `notes:*`, `ui/shared/notes.ts`; `ValidationService` adds the hints.
- **UI:** F2 (`useNoteEditorShortcut`: the last Form row clicked, or the selected Excel cell — its element, or its text with a text block to choose); `NoteEditorDialog` (rich text for text blocks, plain text for text items; paste cleaned in main; Auto format; live check; Save disabled while it would not render); `DocumentPane` (a Word document's blocks, Ctrl / Shift + click; double-click a text block in the Taxonomy panel tags them); **Open Word** in the Excel pane header.
- **Not done here:** opened Word documents are not saved in `.axbrl` (that format belonged to Step 3); there is no in-editor "insert table" (tables come in through paste).

## Step 7 · Preview + PDF
**Already in the code:**
- `buildPreviewHtml`, `groupIN` and `formatValue` (`core/pdf-preview.js`) produce a printable, MCA-like HTML of the instance (company header, one section per ELR, CY/PY rows, tables). They are exported but **not used by the UI**.
- So: a service + IPC, a Preview tab rendering that HTML in a sandboxed view, format settings, and `printToPDF`.

- The Preview tab renders every statement, note table and text block MCA-style, with Indian grouping (start from `core/pdf-preview.js`).
- Settings: borders, bold headings, spacing.
- **Export PDF** via Electron `printToPDF`.
- Tests: preview HTML snapshot on a synthetic filing; a PDF smoke in E2E.
- **Done (2026-11-14):** engine `buildPreviewHtml` gets `format` / `printBar` options, `core/preview-format.js` (CSS), `PreviewFormat` + `normalizePreviewFormat` in `basics.ts`; `.axbrl` `preview.json`; `PreviewService`, `PdfExportService` (ports `PdfRenderer`, `FileWriter`), `infra/electron-pdf-renderer.ts`; IPC `preview:document | set-format | export-pdf`; renderer `PreviewView.tsx`, `stores/preview.ts`. Tests: `engine/test/preview.test.ts` (snapshot), `ui/test/preview-service.test.ts` (settings round trip, printToPDF mocked), `axbrl.test.ts`. The E2E PDF smoke isn't written yet: the service test covers the flow with printToPDF mocked.

## Step 8 · Right-click menus, footnotes, change sign
**Already in the code:**
- `core/footnotes.js` handles list, add, update, link, unlink and remove on the existing filing footnote store.
- The generator writes footnotes and `.axbrl` saves them.
- It is **not exported**: export it and build only the service, IPC and UI.

- **Excel cell menu:** Tag… · Untag · Accept / Reject suggestion · Map as table · Go to fact.
- **Form row menu:** Tag selected cell · Tag CY only · Tag PY only · Untag · Go to linked cell · Footnote CY / PY · Remove footnote · Change sign · View details · Go to note (F7) · Properties.
- **Footnotes panel** on top of `core/footnotes.js`: add, edit, attach one footnote to many facts, and Ctrl+F on table cells.
- Tests: the footnote service; change-sign on the mapping (decimal sign flip).

## Step 9 · Masters panel
**Already in the code:**
- The Masters side panel exists as an **empty placeholder** (`ui/src/app/SidePanel.tsx`).
- The 400100 General Information facts are editable in the Form.
- `prefillDisclosures` copies them from last year.
- CIN is entered in the New Filing wizard.

- **Company card:** the 400100 fields.
- **Directors grid:** name, DIN, designation from the taxonomy enumeration / MCA list, signing.
- **Auditor card:** a live membership-number and PAN format check.
- "Fill from master" buttons in the auditor's report and signatories, and "Load company name from master" in group-company tables.
- Warning: "auditor name must match the PAN exactly". PAN format check.
- Tests: the masters service writing the 400100 facts; format validators.

**Built (2026-11-14):**
- **Curation, not code:** `src/services/engine_rules/curation/<kb>/masters.json` → `businessRules.masters` (builder `load_masters` checks every reference against the taxonomy). It names the sections by ELR title, the designation list (`DesignationOfDirector` → `TypeOfKeyManagerialPersonnel`), the ICAI membership-number format, and the auditor PAN ↔ name pair per category.
- **Engine** `masters.ts`: sections = an ELR's non-dimensional items (a card, under their headings) and its single-typed-axis tables (grids); field lists (own enumeration = strict, curated vocabulary = suggestions); formats (type pattern → rule `format` assertion → curated); read / write CY items and rows through the Session; fill targets = other typed tables that report the same elements; `fillTableFromRecords` skips rows already there. `basics.ts`: `formatProblem`, `panNameProblems` (PAN holder type = 4th character, initial = 5th).
- **App:** `MastersService` (ports: `ProjectAccess`, `MasterLibraryStore`), `KeyValueMasterLibrary` (app.db; values by local name so a C&I master fills an Ind AS filing), IPC `masters:*`, `ui/shared/masters.ts` (contract + live `fieldProblems`).
- **UI:** Masters side panel: Company card, Auditor grid, Directors and signatories (directors grid, CS / CFO card, managers grid), each row a card; live format / list / PAN checks and the "exactly as on the PAN" reminder; **Fill from master** (library → a grid; director rows → the directors' report signatories), **Load company name from master** (library companies → the holding / subsidiary / associate table); the master library list.
- **Not done here:** the Form itself has no fill buttons (they are in the Masters panel, to stay out of the Form files Step 3 was changing).

## Step 10 · Table extras
**Already in the code:**
- `carryForwardPlan` / `carryForward` (`core/carry-forward.js`, exported, **not used by the app**) carry a table's PY columns and values into CY. That is "Copy PY → CY".
- `disclosureCarry` is wired.
- `core/totals-fill.js` (`fillTotals`, not exported) fills empty totals from their parts.
- `core/member-hints.js` provides the totals hints.

- **Show / Hide members** per table, saved in `.axbrl`.
- **Copy PY → CY** for a table.
- **Load static data from PY** (KMP DOB, qualification), extending `disclosureCarry`.
- Computed totals shown read-only, with a tick or cross against a tagged total.
- Tests: the engine helpers; `.axbrl` round trip of hidden members.

## Step 11 · Import hygiene + error flow
**Already in the code:**
- The bottom Problems panel, with double-click → `locate`.
- `mca-tool-service.ts` launches the MCA tool and imports its errors (paste).
- `core/mca-errors.js` parses the error list.
- The side Problems panel is a placeholder.

- Flag merged cells inside tagged ranges.
- Check that the rounding level matches the statement's figures.
- Wire the side Problems panel to the existing list, grouped by statement.
- One-click import of the MCA tool's error list.
- A **Notes checklist** view (category 1 / 2 from §12.4).
- Tests: the merged-cell detector in the workbook parser; the checklist derivation.

## Step 12 · AI quality review
- **Deterministic checks first:**
  - several subsidiaries in the notes but one disclosed;
  - an amount tagged as "Others" with no footnote;
  - salaries 0 while the P&L has employee cost;
  - the PDF rounding ≠ the XBRL rounding.
- **AI proposes** only the suspicious tag pairs (power & fuel vs electricity), as patches the user accepts.
- Tests: rule unit tests; the AI prompt mocked in E2E; one live Groq smoke on synthetic data.

## Step 13 · P2 batch
Pick items as time allows:
- export the mapping to Excel;
- versioned autosave copies;
- an applicability check in New Filing;
- narration snippets on F-keys;
- duplicate PAN / DIN;
- Ind AS prior-to-previous year;
- open last year's `.axbrl` as next year;
- cash-flow "not applicable".
