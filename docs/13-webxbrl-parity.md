# 13 · webXBRL parity: feature checklist and gaps

**Goal:** match webXBRL screen for screen, then make the tagging good enough that "wrong tag" errors stop happening. Validation now only fills missing mandatory items with 0; every other error is fixed by the user or by a better tagger. A wrong tag is a tagger bug, not something a later AI step should patch.

**Sources:**
- Webtel pages and the process-flow deck (see [01](01-research-webxbrl-and-mca-tool.md); re-read 2026-11-13): webtel.in/xbrl-filing-software, webxbrl.com (Web_XBRL, Essentials, Training, Process_Flow_Conversion), the SlideShare "XBRL process flow" deck.
- Web-XBRL release notes, revision 32.7, released 2026-09-24 (webtel.in/SoftwareUpdate/WXBRL.aspx). This is the only dated changelog Webtel publishes.
- Our code at commit `767f460`.

**There is no public manual.** Webtel's support page has only tickets and a phone line. The two Scribd decks (an installation guide uploaded by Webtel, and a "common errors" deck) show only an AI summary without a login.

**The best guide is the videos.** Watch them in this order. Write what you see in §9 and §11, especially anything §11 doesn't already list.

**1. The full flow (watch first)**
| Video | Length | Link |
|---|---|---|
| AOC-4 XBRL Filing 2026, full practical in Web-XBRL (MycsOnline) | 53 min | https://www.youtube.com/watch?v=pCu12GxgX0E |
| Mastering XBRL AOC-4 Filing (Webtel, 2024) | 33 min | https://www.youtube.com/watch?v=oVGs4zOvnzo |
| "webxbrl" (Webtel) | 22 min | https://www.youtube.com/watch?v=SHhw8Fixu5w |
| Webtel's XBRL Filing Software video | 19 min | https://www.youtube.com/watch?v=2MmlPon1NhY |

**2. Notes and reports in depth**
| Video | Length | Link |
|---|---|---|
| Notes tagging through Web-XBRL (Webtel Talks) | 1 h 14 min | https://www.youtube.com/watch?v=fIGpH2vgvn0 |
| Directors' report & other tagging (Webtel Talks) | 58 min | https://www.youtube.com/watch?v=GCLUAczd2NY |

**3. Short videos on specific features**
| Topic | Length | Link |
|---|---|---|
| Table tagging (Ind AS) | 3 min | https://www.youtube.com/watch?v=qsC0TPxCF6A |
| Error Locator (Ind AS) | 4 min | https://www.youtube.com/watch?v=4myFG3H9EF0 |
| Generate XML, resolve errors, validate, PDF | 5 min | https://www.youtube.com/watch?v=GGJLPlH8ZpA |
| Key features of Web-XBRL v29.2 | 6 min | https://www.youtube.com/watch?v=6kCWpYszz9M |
| Web-XBRL new features added | 3.5 min | https://www.youtube.com/watch?v=86HY20GtPAk |
| Switch to the Ind AS taxonomy | 44 s | https://www.youtube.com/watch?v=mSZRmElmGFM |

**4. Older help videos (already summarised in §11)**
- Creating Master: https://www.youtube.com/watch?v=nlAV-yhvaPE
- Financial Tagging: https://www.youtube.com/watch?v=AafdW_SmXeQ
- Notes Tagging: https://www.youtube.com/watch?v=zXKR4CrIJEQ
- Ind AS conversion: https://www.youtube.com/watch?v=iw_35mR1v10
- Ind AS financial tagging: https://www.youtube.com/watch?v=yGgpJH4zeyU

**Not found:** no video shows the fixed-asset template; §13.3 has what the web says. For the rest, request the setup from Webtel (webtel.in → Register Software → Setup Download Request → Web-e-XBRL).

## 0. Recent webXBRL changes (revision 32.7)
| webXBRL 32.7 | Ours | Status | Pri |
|---|---|---|---|
| "Recently used company" tab on company selection | Recent projects on the Welcome screen | ✅ | — |
| Import all previous-year data from last year's XML | Import instance → "Start next year's filing" | ✅ | — |
| Load previous-year data straight from the previous FY's company file | Open last year's `.axbrl` as next year | ❌ | P1 |
| "Current Year Tagging Only" option for financial tagging (PY comes from last year's data) | CY-only scope per tag; no filing-wide switch | 🟡 | P1 |
| Validation of CIN and PAN formats | CIN checked in the wizard; PAN not checked | 🟡 | P1 |
| Live Update (auto-update), manual patch zip as fallback | — | ❌ | P2 |

> **The click-level details still need a hands-on run.** Webtel publishes no manual, so the rows marked 🔍 come from marketing pages. Install webXBRL on Windows, file one company end to end (DGPL is a good test case), and fill in the "Observed in webXBRL" notes in §9. Record every screen, right-click menu, shortcut and dialog.

**Legend**
- **Status:** ✅ done · 🟡 partial · ❌ missing · ➖ deliberately different
- **Priority:**
  - **P0:** needed before a CA can file with us instead of webXBRL.
  - **P1:** expected by webXBRL users.
  - **P2:** nice to have.

## 1. Workflow (webXBRL's 5 steps)
| # | webXBRL step | Ours | Status |
|---|---|---|---|
| 1 | Masters: company, directors, auditor | General Information form (400100) in the XBRL Form. The **Masters side panel is an empty placeholder** | 🟡 |
| 2 | Financial tagging + fixed-asset templates | Auto-tag, double-click manual tag, Taxonomy panel. No fixed-asset template | 🟡 |
| 3 | Tables (dimensions) | "Map as table", suggested tables, "Also as…" | ✅ |
| 4 | Notes tagging (text blocks) | Text range → text block (`<p>` per row). No note editor, no Word import | 🟡 |
| 5 | Generate instance → validate → pre-scrutiny | Generate XML, our validator, launch the MCA tool, Preview tab + Export PDF (Step 7) | ✅ |

## 2. Masters
| webXBRL feature | Ours | Status | To do | Pri |
|---|---|---|---|---|
| Company master: CIN → **Prefill** company data | Masters panel **Company** card: every General information item, under its heading; saved companies in the master library fill the next filing (Step 9, 2026-11-14). Nothing fetched from MCA | ✅ (no MCA fetch) | An MCA data source, later | — |
| Directors: **Prefill** (one) / **Autofill** (all, by CIN or DIN) | Masters **Directors and signatories**: directors signing grid (name, DIN, designation list, signing date), CS / CFO, managers, written to the signatory facts; saved directors reused from the library (Step 9, 2026-11-14). Nothing fetched from MCA | ✅ (no MCA fetch) | — | — |
| Auditor master, membership-number check | Masters **Auditor** grid: live membership-number (6 digits), PAN and SRN format checks; PAN holder type and initial checked against the name (Step 9, 2026-11-14) | ✅ | — | — |
| Masters reused across years | Prefill from last year's instance (`prefillDisclosures`) | ✅ | — | — |
| Mandatory string pop-up during financial tagging 🔍 | **Mandatory items** dialog (Form toolbar, and Review… in Generate): the text / date / Yes-No / list items still empty per year, grouped by statement, with inline inputs; tables an answer makes mandatory; double-click → the Form (Step 5, 2026-11-14) | ✅ | — | — |

## 3. Import / export
| webXBRL feature | Ours | Status | To do | Pri |
|---|---|---|---|---|
| Excel import of BS / P&L | `.xlsx` / `.xls`, every sheet | ✅ | — | — |
| Import Directors' / Auditors' report and notes from **Word** | **Open Word** (Excel pane): the `.docx` as a notes view of blocks in the MCA subset; select blocks, double-click a text block to tag (Step 6, 2026-11-14) | ✅ | — | — |
| CY and PY mapped in one pass | Sheet CY/PY columns, "Both" scope | ✅ | — | — |
| Load PY data (fixed assets, related parties, investments) | Import an instance from any vendor → "Start next year's filing" | ✅ | — | — |
| Fixed-asset schedule **template** with auto-tagging | Map as table / suggested tables on the client's own schedule | 🟡 | Optional blank template (Excel) for clients with no schedule. Low value if table suggestions keep improving | P2 |
| Footnote import from Excel; one footnote on many items | Engine and `.axbrl` support footnotes; **no UI** | ❌ | Footnotes panel: add, edit, attach to facts | P1 |
| Export bulk data to Excel / Word / XML | XML only | 🟡 | "Export mapping to Excel" (cell, element, period, value), for review by the partner | P2 |
| Import XML from any vendor | Import + round-trip report | ✅ | — | — |

## 4. Tagging (the main focus)
| webXBRL feature | Ours | Status | To do | Pri |
|---|---|---|---|---|
| **Single-click source, double-click target element** | Double-click a cell → Manual Tag dialog; double-click an element in the Taxonomy panel | ✅ | See §8 for the fixes the dialog needs | P0 |
| Taxonomy shown as the **statement's tree** (Form layout), not a flat search | Flat search in the dialog; tree in the XBRL Form | 🟡 | Add a "This statement" tab in the dialog: the open ELR's tree, untagged rows first | P0 |
| **Right-click menu on taxonomy items** 🔍 | — | ❌ | Right-click on an element (Taxonomy panel and Form): Tag selected cell · Tag CY only · Tag PY only · Untag · Show reference · Copy name. Right-click on an Excel cell: Tag… · Untag · Accept / Reject suggestion · Map as table | P1 |
| Colour: tagged Excel cell **green**, tagged taxonomy item **red** | Excel: green / amber / red outline / grey hatch. Form: tagged lines green, mandatory-empty lines red (one `rowTone` with the note colours); Taxonomy panel and Manual Tag results show a tick plus "tagged at Sheet!C14 (CY)" (Step 2, 2026-11-14) | ✅ | — | — |
| **Reference link per line item** (Schedule III / Ind AS para) | Not shown | ❌ | Show the element's references (already in the taxonomy KB) in the Element Inspector | P1 |
| Notes: select text, double-click the heading | Word notes view: select blocks, double-click the text block in the Taxonomy panel; Excel text: F2 → choose the text block (Step 6, 2026-11-14). The Manual Tag dialog's ranking is Step 4 | ✅ | — | — |
| Note / report **editor** (create or edit inside the software) | **F2** note editor: MCA-subset rich text, live "will render in the MCA PDF" check (Step 6, 2026-11-14) | ✅ | — | — |
| "On Document" tagging of scattered facts | Any cell, anywhere; `pick` for numbers inside text | ✅ | — | — |
| Dimensions / tables | Map as table, Also as…, suggestions | ✅ | — | — |
| Abstract / non-taggable rows hidden | Dialog marks "table only" | 🟡 | Never offer abstract elements; grey out elements whose period type does not match the cell | P1 |

## 5. Visual aids and alerts
| webXBRL feature | Ours | Status | To do | Pri |
|---|---|---|---|---|
| Colour-wise matching of notes vs schedules | Calculation rules (GR-1), statement ≠ note checks | 🟡 | A "note ties to statement" tick or cross per note in the Filing explorer | P1 |
| Alert: opening ≠ closing, negative closing value | Rules GR-7, sign checks | ✅ | — | — |
| Duplicate PAN / DIN alert | — | ❌ | Rule on directors and related parties | P2 |
| Mandatory items shown in red | Form: empty mandatory lines red per year (Step 2, 2026-11-14) | ✅ | — | — |
| Audio-visual help | — | ❌ | Short help videos or GIFs per screen | P2 |

## 6. Validation and errors
| webXBRL feature | Ours | Status | To do | Pri |
|---|---|---|---|---|
| In-built validations | Engine rules + MCA business rules | ✅ | — | — |
| **Error Locator**: mandatory list before validation | Problems panel (bottom); the **side-panel Problems is a placeholder** | 🟡 | Wire the side panel to the same list, grouped by statement | P1 |
| Double-click an error → open the field | `locate` on double-click | ✅ | — | — |
| Validate with the MCA tool from inside the app | Launch the tool; import its errors | 🟡 | The tool is GUI-only (no CLI), so stay with launch + paste/import. Make the import one click | P1 |
| Pre-scrutiny | Done inside the MCA tool (needs internet) | ➖ | Explain it in-app; we can't call MCA21 | — |
| AI auto-fix after validation | **Removed** (gave wrong fixes). Only "missing mandatory → 0" stays | ➖ | Wrong-tag errors feed back into the tagger (§7), not into a fixer | — |

## 7. Output and preview
| webXBRL feature | Ours | Status | To do | Pri |
|---|---|---|---|---|
| Generate instance, save anywhere | Generate XML dialog | ✅ | — | — |
| **View / print the instance** (in-built viewer) | Preview tab: MCA-like render of every statement, note table and text block with Indian grouping, in a sandboxed frame, re-rendered on every change (engine `buildPreviewHtml`, `PreviewService`; Step 7, 2026-11-14) | ✅ | — | — |
| PDF of the filing | **Export PDF** in the Preview tab: Electron `printToPDF` in a hidden sandboxed window, A4, to a chosen path (`PdfExportService`; Step 7, 2026-11-14) | ✅ | — | — |

## 8. Double-click manual tagging: how it works with AI, and what to fix
**Today** ([ManualTagDialog.tsx](../ui/src/features/excel/ManualTagDialog.tsx)):
- Double-click a cell (Univer grid) or a Form row or value → the dialog opens.
- The search box is prefilled with the row's label (or the element, or the existing tag).
- **AI is involved only if auto-tag already left a suggestion on that cell.** Then the dialog shows it with its confidence, rationale and runner-up alternatives: Accept, Reject, or click an alternative to search for it.
- Tagging calls `tagSelected` → origin `manual`, status approved. A row label tags CY and PY together ("Both").

**Gaps (in fix order):**
1. **No AI on an untagged row.** If auto-tag skipped the row, the dialog is plain keyword search.
   - **Fix:** on open, call the sidecar suggester for this one row (label + figure + sheet context) and show its top 3 above the search results.
   - One row = one cheap call. This is where "AI-integrated webXBRL" actually shows.
2. **Search isn't scoped to the statement.** A Balance Sheet row gets P&L and note elements mixed in.
   - **Fix:** rank elements in the sheet's statement (from `sheet → ELR` or the open Form ELR) first, then the rest. Add the "This statement" tree tab (§4).
3. **Already-used elements aren't marked.**
   - **Fix:** show "tagged at BS!C14" on hits, and warn before tagging the same element and period twice (the duplicate-fact error).
4. **Text cells get numeric elements.**
   - **Fix:** when the cell is text, rank text-block, string, date and boolean elements by the cell's content.
   - Notes are mostly text (Vansh's observation), so this matters for notes tagging.
5. **A range is lost.** Double-click collapses the selection to one cell, so "sum of N cells" and text ranges can't go through the dialog.
   - **Fix:** keep the range when the double-click is inside it.
6. **The row label assumes column B** (`c === 1`).
   - **Fix:** use the sheet's configured description column, as auto-tag does.
7. **Speed.** webXBRL users tag dozens of rows in a row.
   - **Fix:** after tagging, offer "Next untagged row ↓" (a keyboard shortcut) without closing and reopening.
8. **Double open.** The grid opens the dialog from both the `dblclick` listener and the pointer-up timing check.
   - **Fix:** keep one of them.
9. **Learning from corrections.** When the user replaces an AI suggestion manually, record the label → element pair for the project (and, with consent, for later tagger evaluation). This is the "wrong tag never comes back" loop.

## 9. Hands-on run checklist (fill in while using webXBRL)
§11 answers most of this from the videos. A hands-on run is still worth doing for:
- fixed assets;
- tables (members);
- Word import;
- the exact error report;
- backup.
For each screen, write what you see, every button, right-click item and shortcut, and what ours lacks.
- [ ] Install, licence, new company: what is asked, in what order
- [ ] Company master Prefill, director Autofill, auditor check
- [ ] Excel import: which formats; does it ask for CY/PY columns?
- [ ] Financial tagging screen: layout, colours, single/double click, right-click menus, untag, re-tag
- [ ] Fixed-asset template: fields, auto-tagging
- [ ] Tables (current investments, related parties): how members are chosen
- [ ] Notes: Word import, editor, select-and-double-click
- [ ] Footnotes: add, edit, one on many
- [ ] Error Locator before validation; the error report; double-click jump
- [ ] Generate, view/print instance, MCA tool from inside, pre-scrutiny
- [ ] Backup/restore, next-year load
- [ ] Every keyboard shortcut seen

## 11. webXBRL click by click (from the videos)
**Sources:** captions of Webtel's help videos (Creating Master, Financial Tagging, Notes Tagging), the description of the Ind AS help video, and the 53-minute FY 2025-26 practical by MycsOnline (a CS filing a real company in Web-XBRL). Captions were pulled with `yt-dlp` on 2026-11-13. The "Mastering AOC-4" video was read on 2026-11-14; see §12.

### 11.1 Company, login, year
1. **Create New Company:**
   - Enter the CIN → **Pre-fill**. It fetches display name, company name, PAN, address and city from MCA.
   - Set a login ID and password for this company.
   - Tick "first year of incorporation".
   - Choose **Standalone / Consolidated**.
   - Choose the **cash-flow type**, or "not applicable", which hides the cash-flow statements entirely.
   - Save.
2. **Login:** pick the company in a dropdown, enter ID and password, then pick the **financial year** → OK.
3. **The home page is a process-flow chart:** Masters → Financial tagging → Notes tagging → Generate → Validation tool. It is the user's map.
4. **Ind AS:**
   - Context Master: tick "IND-AS" to load that taxonomy.
   - Tick "Prior to previous year applicable" for **3-year tagging** (CY, PY, and the year before).

### 11.2 Masters menu
| Item | What it does |
|---|---|
| Company Master | Add or modify a company |
| Director Master | **Autofill:** fetch all directors from MCA by CIN, tick the ones serving this FY, Save. **Prefill:** one director by DIN, then type gender, designation, state |
| Document Master | Upload the Excel / Word files of the financials (also reachable from tagging) |
| Directors' report master | Shareholding pattern: top-10 shareholders, change in promoter shareholding |
| Share capital master | Per class and year: number of shares, nominal value → **total auto-calculated**. CY and PY |
| Auditor Master | Firm, signing partner, address, city, PIN, **membership no. and PAN, verified** |
| Taxonomy Master | (not shown in the videos) |
| **Narration Master** | Text shortcuts on function keys, e.g. **F10 = "Not applicable"** |
| Change Year | Reopen the same company in another FY |
| Log off | Switch company |

**Utilities → Reset Settings:**
- **Rounding level:** actual / thousands / lakhs / millions / crores.
  - A wrong setting makes XBRL figures differ from Excel. This is the #1 beginner confusion.
- **Column difference:** CY ↔ PY, and CY ↔ prior-to-previous for Ind AS.
- **Load setting:** rows to consider or ignore. If PY shows 0, the column gap is wrong.

**Import XBRL XML file:**
- Last year's numbers come from last year's XML.
- Their flow: Change Year to PY → Import XML (warns that it may overwrite) → Change Year back to CY.

### 11.3 Financial tagging
- **Toolbar:** List of Documents (Upload File; double-click a document to open it) · **Pending Issues** · **Switch to Note Tagging** · Refresh.
- **Choose a view:** Balance Sheet / Income Statement / Both. Users pick one at a time because "Both" is crowded.
- **Layout:** the uploaded Excel on the **left**; the statement's taxonomy **tree** on the **right**.
  - The tree has **+ / −** to expand and collapse each head.
  - **Ctrl+E** expands all.
- **Tagging:** click the figure in Excel, then **double-click the taxonomy line**.
  - If the line already has a value, it asks **Add / Replace**. Add sums another cell into the same element.
  - The tagged line's box turns **green**.
  - **Red** lines are mandatory.
  - Tagging a **blank** Excel cell files 0. This is how users fill mandatory zeros early, e.g. "Share application money pending allotment".
- **Line → its note table:**
  - Each line has a **yellow "L" / edit button**; right-click → **Go to notes** or **F7** also works. It opens the note's table for that line (share capital, reserves, borrowings, cash and bank…).
  - The table has **CY / PY** tabs.
  - **"Load data from 24-25"** copies PY into CY, so only the changes are edited.
  - The footer shows **value as per balance sheet vs table value, and the difference**.
  - When the difference is 0, the label turns **green**.
  - This is their main defence against "statement ≠ note" errors, and users are told to fill the note **right after** the line.
- **Footnote:** right-click the line → **View details** → type the note → Save. The line then shows a footnote marker.
- **General disclosures:**
  - Number of employees.
  - Principal products / activity, from a **dropdown**.
  - Turnover.
  - "Load data from last year".
- **Auditor's report section:**
  - **"Fill data detail from auditor master"** → pick the auditor → category, name and signing partner are prefilled. Only a few fields, such as the SRN of ADT-1, are typed.
  - Then the remarks per clause: favourable / adverse / disclaimer / clause not applicable.
- **Directors' report section:**
  - Narrative, number of board meetings.
  - Signatories via **"Load details from director master"**, which pops up a pick list, plus dates.
- **Other:** secretarial audit if applicable. CSR, subsidiaries and related parties are in general disclosures.

### 11.4 Notes tagging
- **Switch to Note Tagging** → pick a document (e.g. the Directors' Report Word file). The **document is on the left**, the taxonomy on the right.
- **Select a block of text, then double-click the element** (e.g. "Disclosure in board of directors report explanatory"). The tagged content shows below the tree.
- **"M"** marks mandatory items. Users can also **paste** text into the item.
- **F2** tags or edits a note **directly from the Excel** and edits tagged text.
- Notes are always **text blocks**.

### 11.5 Generate and after
1. **Generate:**
   - Lists the **mandatory items not tagged** and the **mismatches**, e.g. "surplus must equal profit for the period".
   - The user fixes them and clicks Generate again.
   - Once nothing is left → **Yes** → the XML is written.
2. **MCA Validation Tool (external):** open the XML → validate. Errors are typically statement ≠ note; fix them in the software and regenerate.
3. **Pre-scrutiny** (in the MCA tool, after a clean validation). Typical errors:
   - The **auditor's name doesn't match the PAN** ("& Co." vs "Company").
   - The **membership number doesn't match the name**.
4. **Export to PDF** (in the MCA tool) to eyeball everything. That XML is the final one.

> **The presenter's first filing had about 300 validation errors and 10–15 pre-scrutiny errors.** This is the pain we remove.

### 11.6 What this adds to our gap list
| webXBRL behaviour | Ours | Status | Pri |
|---|---|---|---|
| **Add / Replace** when tagging a line that already has a value (sum cells that aren't next to each other) | Tagging a line with a value asks **Add / Replace / Cancel** (Manual Tag, Form, Taxonomy panel share one flow); Add makes the fact the exact decimal sum of its sources on any sheet ([ADR-0015](decisions/ADR-0015-multi-source-mapping.md), Step 3, 2026-11-14) | ✅ | — |
| **Line → note table jump** (yellow L / F7 / right-click) with a **BS-vs-note difference footer**, green at 0 | Form line labels green / red against their note (tooltip: statement · note · difference); **Go to note** button and **F7** open the note at its table or row; statement **Difference** footer (CY / PY), green at 0 (Step 1, 2026-11-14) | ✅ | — |
| Statement **tree with + / − and Ctrl+E**, mandatory lines red, tagged lines green | Form tree folds per head and per table (+ / −), Ctrl+E for all; empty mandatory lines red per year (engine `mandatoryCell`), tagged lines green (Step 2, 2026-11-14) | ✅ | — |
| **Pending Issues** button in the tagging toolbar | Problems panel | ✅ | — |
| Tag a **blank cell → 0** | "Empty mandatory → 0" (whole statement) | ✅ (different) | — |
| Generate pre-check of untagged mandatory items and mismatches | Generate dialog (Ctrl+G): key answers to confirm, mandatory items still empty (Review…), validation errors block with **Fix first**; main refuses a gated filing (Step 5, 2026-11-14) | ✅ | — |
| **Copy PY → CY** in note tables ("Load data from 24-25") | — | ❌ | P1 |
| Fill auditor / signatories **from masters** | **Fill from master** in the Masters panel: library auditors → the auditor grid; director rows → the directors' report signatories (Step 9, 2026-11-14) | ✅ | — |
| **Auditor name ↔ PAN, membership no. ↔ name** consistency (top pre-scrutiny errors) | "Enter it exactly as on the PAN" on the auditor names; the PAN's holder type (firm F / individual P) and 5th character checked against the name by category (Step 9, 2026-11-14). Membership no. ↔ name needs the ICAI database | ✅ (PAN) | — |
| Cash-flow type / "not applicable" hides cash-flow statements | — | ❌ | P1 |
| Home **process-flow chart** (where am I in the filing) | Filing explorer status dots | 🟡 | P1 |
| Share capital master with **auto total** | Share capital AI producer (counts read from the note) | ✅ (different) | — |
| **Narration master**: F-key text snippets ("Not applicable") | — | ❌ | P2 |
| 3-year tagging (Ind AS "prior to previous year") | CY / PY only | ❌ | P1 (Ind AS only, when it applies) |
| Notes: document view, select text → double-click element; F2 from Excel | Word notes view (select blocks → double-click element); F2 on a Form row or an Excel text cell (Step 6, 2026-11-14) | ✅ | — |
| Per-company login and password | `.axbrl` file per filing | ➖ | — |

## 12. Webtel playlist (6 videos, read 2026-11-14)
**Sources:** the Webtel playlist `PLE270oTr8XpFNm7MLwMwCxIq852Q31UHz`. Transcripts were pulled with `youtube-transcript-api` (English auto-captions; Hindi auto-captions for videos 5 and 6).

| # | Video | Length | Useful for |
|---|---|---|---|
| 1 | What is financial tagging & notes tagging (`XscMCGRx4oU`) | 9 min | Right-click menu, E/L/T markers, notes flow, mandatory notes list |
| 2 | Generate XML, resolve errors, validate, PDF (`GGJLPlH8ZpA`) | 5 min | MCA tool flow, error colours |
| 3 | Quality tagging & common mistakes (`sTDnVOz8fNw`) | 6 min | The top errors and how webXBRL prevents them |
| 4 | Outsourcing benefits (`sWNaU6V43kk`) | 5 min | Marketing only, nothing to build |
| 5 | Comprehensive guide to XBRL filing (`O515SsZ5AEI`) | 13 min | Applicability, required documents, due dates, penalties |
| 6 | Mastering XBRL AOC-4 filing (`oVGs4zOvnzo`) | 33 min | The full flow on a sample company (masters → tagging → tables → notes → generate → MCA tool → PDF → backup) |

Only what §11 doesn't already say is listed here.

### 12.1 Settings that decide whether figures come out right
- **Utilities → Reset Settings (F9)**, set before tagging:
  - **Label column:** the Excel column that holds the particulars.
  - **Column difference CY ↔ PY.** Video 6 shows the classic bug: PY came out blank because the gap was 1 but should have been 2. Fix the gap, untag, re-tag, and PY fills.
  - **Rounding level** (thousands in the demo).
  - **Statement to tag:** Balance Sheet / Income Statement / Both.
- **Utilities → Other Settings (F8): the PDF format.**
  - **General:** plain text, no borders, no bold, tables not aligned.
  - **As per MCA → Advanced:** borders, bold headings and sub-headings, auto page layout, line and paragraph spacing in text blocks.
  - This changes how the text blocks look in the MCA PDF.

### 12.2 Financial tagging screen (more detail)
- **Search element (Ctrl+S)** jumps to the element in the tree.
- **Right-click on an Excel cell** → list of uploaded documents → pick one to switch sheet.
- **Right-click on a tagged taxonomy line:**

| Item | What it does |
|---|---|
| Remove tagging / Delete | Untag |
| Go to linked cell | Jumps to the Excel cell the value came from, or to the linked note sheet (e.g. "Disclosure of classes of share capital") |
| Footnote (CY / PY separately) | Adds a footnote per period. The line is then underlined, and hovering shows the text |
| Remove footnote | — |
| Change sign (Ctrl+N) | Stores the value as negative |
| View details | Lists every cell summed into the line (after **Add**), e.g. share capital + reserves |
| Go to notes (F7) | Opens the note or text block for this line |
| Properties | Standard label, element name, data type, period type, definition |
| Expand all | Opens the whole tree |

- **Markers on taxonomy lines:**
  - **E** = explanatory text block. Double-click opens notes tagging for it, and **F2** adds the text.
  - **L** = a linked text block.
  - **T** = a table. Double-click opens the table.
- **Statement footer: "Difference".** 0 means the statement is fully tagged and balanced for CY and PY. Anything else means a line is missing or wrong.
- **Red head after tagging** = its sub-schedule (note or table) is still empty. It turns green once the note is filled and matches. This is their "matching concept".

### 12.3 Tables
- A **Documents** button (top left) picks the source sheet inside the table view. Double-click tags into a table cell.
- **Show / Hide members:** hide members the company doesn't use (e.g. "Other buildings" in PPE), so the table only shows real columns.
- Mandatory cells are red.
- The footer shows **value as per balance sheet vs table value, and the difference**. A non-zero difference means the table isn't tagged correctly.

### 12.4 Notes tagging (Excel route)
- Format the note text in Excel first; it gives a better PDF.
- Select the text in Excel → find the heading in the tree → **F2** → paste → **Auto format** → Save.
- Or open a Word document (Directors' report) in notes tagging, copy a block, then double-click the element.
- **Mandatory notes (video 1):**
  - **Category 1:** share capital, statement of changes in equity, borrowings, investments, PPE, accounting policies, corporate information, Ind AS RPT, financial instruments / fair value, employee benefits, EPS, CSR, Directors' report, Auditor's report, secretarial audit report.
  - **Category 2:** other notes to accounts not covered by financial tagging; text of notes from sub-classification; notes on income and expenses; notes on assets and liabilities; additional P&L and BS disclosures.

### 12.5 Generate, MCA tool, PDF
1. **Generate:**
   - Pick the CY start period, the PY and (Ind AS) the prior-to-previous year.
   - It lists the **mandatory items not tagged** first. The user may still generate.
   - A **final confirmation dialog** asks them to review subsidiary status, holding status, **CSR applicability** and other Yes/No answers, because "incorrect information may affect filing (e.g. CSR-2)".
2. **MCA Validation Tool:** pick the taxonomy (it loads in about 3 min) → File → Open → Validate.
   - Error colours: **blue / purple = line item missing, orange = member missing, green = table**.
   - Click the underlined label → jumps to where the error is.
   - Then **pre-scrutinize**, then **PDF**.
3. **Export to PDF** inside webXBRL, using the F8 format.

### 12.6 Utilities
- **Backup / Restore** of all work.
- **Import data from XBRL** made by any software, as long as the company's CIN, standalone or consolidated, FY and taxonomy already exist.
- **Quick links:** MCA, ICAI, ICSI.
- **Taxonomy master:** choose the taxonomy (C&I / Ind AS) and the year per company.
- **Auditor master:** a **Verify** button checks the membership number.
- **Directors:** double-click a row to edit. Red fields are mandatory.
- **Document master** also accepts PDF and other formats.

### 12.7 The common errors, and what webXBRL does about them (video 3)
| Error | Cause | webXBRL guard |
|---|---|---|
| **Reported value** | PY closing ≠ CY opening | Red alert with the amounts on save |
| **At least one child member** | A table has a CY value but no PY value | The table footer and red cells |
| **Mandatory line item** | A mandatory head left untagged | Red head |

**Quality mistakes reviewers find** (no software guard; a good target for AI review):
- Only one subsidiary disclosed when the company has several.
- Related-party transactions incomplete.
- Additional disclosures untagged: forex, segments, contingent liabilities, commitments.
- No footnote when an amount is tagged as "Others".
- Rounding differs between the PDF and the XBRL (thousands vs actuals).
- Wrong element, e.g. power & fuel tagged as electricity.
- Salaries tagged 0 or clubbed into other expenses.

### 12.8 Filing facts for the New Filing wizard (video 5)
- **Who must file in XBRL:**
  - Ind AS companies with net worth ≥ ₹250 cr, listed companies, and their holding, subsidiary, JV or associate companies.
  - Other companies with paid-up capital ≥ ₹5 cr or turnover ≥ ₹100 cr.
  - **Exempt:** NBFCs, housing finance companies, banking and insurance (their formats differ from Schedule III).
- **Holding companies** file standalone **and** consolidated. Subsidiaries and JVs file standalone.
- **Required documents:** BS with notes, P&L with notes, cash flow, SOCIE, Board's report with annexures, auditor's report with annexures, CSR report, AOC-1, significant accounting policies.
- **Due date:** 30 days from the AGM (AGM by 30 Sep → 30 Oct). **Late fee:** ₹100 per day.

### 12.9 What this adds to our gap list
| webXBRL behaviour | Ours | Status | Pri |
|---|---|---|---|
| **Statement "Difference" footer** (CY and PY), 0 = fully tagged | Form footer "Difference CY · PY" from the statement's own calculation totals, green at 0; click lists that statement's problems (Step 1, 2026-11-14) | ✅ | — |
| **Red head until its note / table matches** ("matching concept") | Engine `noteTies`: a line stays red while its note is empty or differs, green once it adds up (Step 1, 2026-11-14) | ✅ | — |
| **E / L / T markers** on tree lines with double-click into text block / table | E (text block), L (text block also presented in other ELRs), T (table) from taxonomy data; double-click T opens and scrolls to the table, E / L opens Manual Tag preset to the element (Step 2, 2026-11-14) | ✅ | — |
| **View details** (every cell summed into a line) | Double-click a Form value (or **Details** in the inspector): every source with its amount, the total, remove one source (the last untags), **Save as footnote**; the source chip reads "BS!C14 + Notes!D20" (Step 3, 2026-11-14) | ✅ | — |
| **Change sign** on a tagged value | Sign handled by the tagger and rules | ❌ | P1 |
| **Go to linked cell** from a taxonomy line | `locate` from a fact | ✅ | — |
| **Properties** of an element (label, type, period, definition) | Element Inspector | ✅ | — |
| **Show / Hide members** in a table | All members shown | ❌ | P1 |
| Column-gap setting, re-tag when PY is blank | Per-sheet CY/PY columns picked by auto-tag | ✅ (different) | — |
| **PDF format settings** (MCA style: borders, bold, spacing) | Borders, bold headings and spacing in the Preview toolbar, saved per filing (`.axbrl` `preview.json`), applied to the preview and the PDF (Step 7, 2026-11-14) | ✅ | — |
| **Generate confirmation of the key Yes/No answers** (subsidiary, holding, CSR applicable) | Generate dialog confirms holding / subsidiaries / CSR applicable / auditor qualified (curated `keyAnswers` in the KB rule bundle, each a Yes/No dependency parent), with what each answer requires (Step 5, 2026-11-14) | ✅ | — |
| Error colour code (line item / member / table) | Problems panel by severity | 🟡 | P2 |
| **Backup / Restore** | `.axbrl` save; no versioned backup | 🟡 | P2 (autosave copies) |
| **Membership-number Verify** button | Pattern check only | 🟡 | P1 (needs ICAI data; pattern check for now) |
| **Mandatory notes checklist** (category 1 / 2) | Filing explorer dots | 🟡 | P1 (a "Notes checklist" view) |
| **AI quality review** for the §12.7 list (one subsidiary, "Others" without footnote, salaries zero, power ≠ electricity, rounding) | — | ❌ | **P1, our differentiator:** deterministic checks where possible, AI only proposes |
| **Applicability check** in the New Filing wizard (§12.8), standalone + consolidated reminder for holding companies | — | ❌ | P2 |

## 13. The two long webinars and the web (read 2026-11-14)
**Sources:**
- "Notes tagging through Web-XBRL" (`fIGpH2vgvn0`, Webtel Talks session 3, English captions).
- "Directors' report & other tagging" (`GCLUAczd2NY`, session 2, Hindi captions).
- webtel.in/xbrl-filing-software, webxbrl.com/Web_XBRL.aspx, and the SlideShare "XBRL process flow" deck (27 slides).

### 13.1 Notes, tables and generation (session 3)
- **Home page buttons are shortcuts** into each step.
- **Totals are grey and frozen.** Totals such as "Total non-current assets" are computed from the tagged children and can't be edited. This is the cross-check while tagging.
- **One tag fills CY and PY.** If the PY column isn't next to the CY column, set the gap in F9.
- **Re-tagging a tagged line** prompts "already tagged, tag with new?" (Yes / No).
- **F7 goes to the line's table or detail schedule**, depending on the tag.
  - Tables **auto-calculate their totals** and show whether they match the statement.
  - Tables have **CY / PY** buttons; PY can be loaded from last year.
- **F2 on a text item opens a Word-like editor** (bold, tables).
  - **Auto format** fixes pasted tables. MGT-9 is full of them: shareholding, promoter holding, KMP remuneration.
  - **F2 on a figure** edits it.
- **Text-block hierarchy:**
  - The parent is a **text block** and its sub-items are **string items**.
  - Tagging a sub-item without its parent prompts "the parent text block must be tagged".
- **Yes/No items are conditional.**
  - **Auditor's report:** "Auditor's report applicable?", then "Qualified or reservations?". If that is **Yes**, the remarks become mandatory (F2).
  - **CSR applicable = No** skips the whole CSR section. **Yes** makes its fields mandatory.
- **Tables with fixed vocabularies:**
  - The KMP / director remuneration table has red mandatory columns.
  - **Designation must come from the dropdown** (MD, CS, CFO…), because free text fails the MCA tool.
  - Dates have a fixed format.
  - **Ctrl+F** adds a footnote on a table cell.
- **Generate:**
  - Asks for both years' start and end dates.
  - Lists **mandatory items not tagged**; double-click one to jump to it and tag it.
  - Lists the **"zero tags"**: mandatory items that will go out as 0. The user can tag those residual items, or generate anyway.
- **Formatting tips from the trainer:**
  - **Unmerge merged cells before tagging.** "99% of formatting problems are merged cells."
  - F8 has an **"enable HTML content"** option. It is off by default because it causes "exceptional errors" in the MCA tool.
  - Blank lines or blank pages in the MCA PDF come from the MCA tool's handling of special characters and HTML, not from the tagging software.
- **Text blocks are CY only.** Monetary items are always tagged for both years.

### 13.2 Directors' report (session 2)
- **Long text:**
  - Format the report in Word or Excel first.
  - In notes tagging, find the item (widen the column, because Directors' report element names are long) → **F2** → paste → Save.
- **Short items** (one line): click the text, then double-click the element, as in financial tagging. That is faster than F2.
- **If F2 doesn't open the editor:** Utilities → Other Settings, last option (a fallback editor).
- **Mandatory items:**
  - Generate lists every mandatory Directors' report item still empty; click one to tag it.
  - Examples: details of foreign exchange earnings and outgo, the state of the company's affairs, energy conservation.
  - Sub-items under a mandatory text block are optional.
- **Numeric parts are in financial tagging,** not notes: number of board meetings, dividend paid.
- **MGT-9 / extract of annual return (sec 92(3)) tables:**
  - principal business activities (≥ 10 % of turnover);
  - particulars of holding, subsidiary and associate companies, with a **"Load company name from master"** button;
  - shareholding pattern, top-10 shareholders, change in promoter holding;
  - shareholding of directors and KMP;
  - remuneration of directors and KMP.
- **"Load data from <PY>"** in these tables copies the static details (DOB, qualification) from last year's filing. Only shares and salary change.
- **Directors who joined or resigned during the year:** add a footnote (Ctrl+F) with the dates.
- **Signatories:** "Load details from director master".
- **Unsaved changes:** closing a screen prompts to save.

### 13.3 What the web says about the three open items
| Item | What we found | Confidence |
|---|---|---|
| **Fixed-asset template** | "No need to punch fixed assets schedule data; import from template for automatic tagging." The deck's step 2 screenshot shows "Method of depreciation" and "Details of taxonomy"; PY fixed-asset data can be loaded. No procedure published | Vendor claim only. Our "Map as table" on the client's own schedule covers the same need |
| **Word import** | "Import Auditor's Report / Directors' Report / Notes from Word file / create in software itself." In both webinars the actual flow is **open the Word document in notes tagging and select text**, or **copy → F2 editor → paste → Auto format** | Confirmed by the webinars |
| **Error report** | Made by the in-software validation **before the XML is generated**: a list of errors, double-click → the field. After it is clean: generate, then the MCA tool, then pre-scrutiny | Confirmed (deck slide 20 + webinars). Layout not published |

### 13.4 What this adds to our gap list
| webXBRL behaviour | Ours | Status | Pri |
|---|---|---|---|
| **Note editor** (F2): rich text with tables, paste from Word/Excel, **Auto format** of pasted tables, MCA HTML subset | F2 editor: paste from Word / Excel keeps paragraphs and tables (cleaned to the MCA subset), **Auto format** rebuilds tables on a grid and drops empty rows / columns / paragraphs, live check; CY only (Step 6, 2026-11-14) | ✅ | — |
| **Conditional mandatory** (CSR = No skips CSR; qualified = Yes requires remarks) shown while tagging | `mandatoryCell` drives the Form's red markers and the Mandatory items dialog: CSR = No no longer requires the CSR items (C&I also closes them), qualified = Yes requires the remarks (Ind AS field; C&I table SR-L3893-1, listed as a required table) (Step 5, 2026-11-14) | ✅ | — |
| **Parent text block required** when a sub-item is tagged | Note editor warns on open / save; Problems panel lists it as info (MCA accepts it: Dixon has 14) (Step 6, 2026-11-14) | ✅ | — |
| **Enumerated fields as dropdowns** (designation, category…) | Masters panel: taxonomy enumerations as strict lists (category of auditor); the designation of a director offered from the taxonomy's KMP list (curated, still accepts other text) (Step 9, 2026-11-14). Form inputs unchanged | ✅ (Masters) | — |
| **Frozen computed totals** in the statement and tables | Calculation rules; Form shows totals | 🟡 | P1: show computed totals read-only, with a tick or cross against the tagged total |
| **Merged-cell warning** on Excel import | — | ❌ | P1 (cheap: flag merged cells in tagged ranges) |
| **"Zero tags" list at Generate** (mandatory items that will go out as 0) | "Empty mandatory → 0" | ✅ (different) | — |
| **Load static table data from PY** (KMP DOB, qualification) | `prefillDisclosures` for general disclosures | 🟡 | P1: extend to typed tables |
| **"Load company name from master"** in group-company tables | Masters panel: saved companies → the holding / subsidiary / associate companies table (same element, `NameOfCompany`) (Step 9, 2026-11-14) | ✅ | — |
| Footnote on a table cell (Ctrl+F) | No footnotes UI | ❌ | P1 (same work as §3) |

**What still needs a hands-on webXBRL run:** only the exact fixed-asset template fields and the layout of the error report. Neither blocks us: tables cover fixed assets, and our Problems panel is our error report.

## 10. Suggested order
> The step-by-step build plan, one chat per step, is in [14-parity-build-plan.md](14-parity-build-plan.md).

1. **P0 tagging:**
   - §8 fixes 1–6;
   - **Add / Replace** when a line already has a value (§11.6);
   - **line → note table jump with the BS-vs-note difference**, green at 0 (§11.6);
   - "This statement" tree;
   - tagged marks in the Taxonomy panel;
   - the mandatory text/date/Yes-No dialog;
   - the statement **Difference footer**, **E / L / T markers**, **View details** (§12.9);
   - the **Generate confirmation** of subsidiary / holding / CSR answers (§12.9).
2. **P0 output:** the Preview tab (MCA-like view + print).
3. **P0 notes:** the F2 note editor (paste from Word / Excel, Auto format of tables, MCA HTML subset) → text block; conditional mandatory markers (CSR, auditor qualification) (§13.4).
4. **P1:**
   - Masters panel (company, directors, auditor);
   - footnotes UI;
   - right-click menus;
   - references in the inspector;
   - side Problems panel;
   - PDF with MCA-style format settings;
   - change sign, show / hide members, notes checklist;
   - AI quality review (§12.7).
5. **P2:**
   - Excel export of the mapping;
   - fixed-asset template;
   - duplicate PAN/DIN;
   - help videos;
   - CIN prefill (needs a data source).
