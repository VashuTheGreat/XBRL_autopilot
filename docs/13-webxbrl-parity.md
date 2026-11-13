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

**Not found:** no video shows the fixed-asset template. For that, request the setup from Webtel (webtel.in → Register Software → Setup Download Request → Web-e-XBRL).

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
| 5 | Generate instance → validate → pre-scrutiny | Generate XML, our validator, launch the MCA tool. **Preview tab is a placeholder** | 🟡 |

## 2. Masters
| webXBRL feature | Ours | Status | To do | Pri |
|---|---|---|---|---|
| Company master: CIN → **Prefill** company data | CIN entered in the New Filing wizard; nothing fetched | ❌ | Needs an MCA data source; manual entry is fine for v1. Show the 400100 fields in the Masters panel | P1 |
| Directors: **Prefill** (one) / **Autofill** (all, by CIN or DIN) | Typed in the Form | ❌ | Directors grid in Masters (name, DIN, designation, signing), written to the 400100 facts | P1 |
| Auditor master, membership-number check | Typed in the Form; pattern checked by validation | 🟡 | Auditor card in Masters with a live format check | P1 |
| Masters reused across years | Prefill from last year's instance (`prefillDisclosures`) | ✅ | — | — |
| Mandatory string pop-up during financial tagging 🔍 | "Empty mandatory → 0" fills numbers only | ❌ | One dialog listing the mandatory **text, date and Yes/No** items still empty, with inline inputs | P0 |

## 3. Import / export
| webXBRL feature | Ours | Status | To do | Pri |
|---|---|---|---|---|
| Excel import of BS / P&L | `.xlsx` / `.xls`, every sheet | ✅ | — | — |
| Import Directors' / Auditors' report and notes from **Word** | — | ❌ | `.docx` → MCA HTML (`richtext.ts` subset) → text block | P0 |
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
| Colour: tagged Excel cell **green**, tagged taxonomy item **red** | Excel: green / amber / red outline / grey hatch. Form: highlighted row, source chip | 🟡 | Mark tagged rows in the Taxonomy panel and in the dialog results (a tick plus the cell ref), so already-used elements are obvious | P0 |
| **Reference link per line item** (Schedule III / Ind AS para) | Not shown | ❌ | Show the element's references (already in the taxonomy KB) in the Element Inspector | P1 |
| Notes: select text, double-click the heading | Range → text block via the dialog | 🟡 | Text blocks need their own flow: the dialog should rank `textBlockItemType` elements first when the cell is text | P0 |
| Note / report **editor** (create or edit inside the software) | — | ❌ | Rich-text editor limited to the MCA HTML subset, with a live "will it render in the MCA PDF" check | P1 |
| "On Document" tagging of scattered facts | Any cell, anywhere; `pick` for numbers inside text | ✅ | — | — |
| Dimensions / tables | Map as table, Also as…, suggestions | ✅ | — | — |
| Abstract / non-taggable rows hidden | Dialog marks "table only" | 🟡 | Never offer abstract elements; grey out elements whose period type does not match the cell | P1 |

## 5. Visual aids and alerts
| webXBRL feature | Ours | Status | To do | Pri |
|---|---|---|---|---|
| Colour-wise matching of notes vs schedules | Calculation rules (GR-1), statement ≠ note checks | 🟡 | A "note ties to statement" tick or cross per note in the Filing explorer | P1 |
| Alert: opening ≠ closing, negative closing value | Rules GR-7, sign checks | ✅ | — | — |
| Duplicate PAN / DIN alert | — | ❌ | Rule on directors and related parties | P2 |
| Mandatory items shown in red | Filing explorer dots; "Empty mandatory" | 🟡 | Red marker on mandatory empty rows in the Form | P1 |
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
| **View / print the instance** (in-built viewer) | **Preview tab is a placeholder** | ❌ | MCA-like HTML render of every statement, Indian grouping, print / PDF | P0 |
| PDF of the filing | — | ❌ | From the preview (Electron `printToPDF`) | P1 |

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
**Sources:** captions of Webtel's help videos (Creating Master, Financial Tagging, Notes Tagging), the description of the Ind AS help video, and the 53-minute FY 2025-26 practical by MycsOnline (a CS filing a real company in Web-XBRL). Captions were pulled with `yt-dlp` on 2026-11-13. The "Mastering AOC-4" video's captions were rate-limited and not read.

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
| **Add / Replace** when tagging a line that already has a value (sum cells that aren't next to each other) | Contiguous range sum only; re-tag replaces silently | ❌ | **P0** |
| **Line → note table jump** (yellow L / F7 / right-click) with a **BS-vs-note difference footer**, green at 0 | Tables shown under the statement in the Form; GR-1 rule after validation | 🟡 | **P0** |
| Statement **tree with + / − and Ctrl+E**, mandatory lines red, tagged lines green | Form rows; mandatory dots in the explorer | 🟡 | **P0** |
| **Pending Issues** button in the tagging toolbar | Problems panel | ✅ | — |
| Tag a **blank cell → 0** | "Empty mandatory → 0" (whole statement) | ✅ (different) | — |
| Generate pre-check of untagged mandatory items and mismatches | Generate dialog: blocking errors, "Fix first" | ✅ | — |
| **Copy PY → CY** in note tables ("Load data from 24-25") | — | ❌ | P1 |
| Fill auditor / signatories **from masters** | Masters panel is a placeholder | ❌ | P1 |
| **Auditor name ↔ PAN, membership no. ↔ name** consistency (top pre-scrutiny errors) | — | ❌ | P1 (a warning: "check the name exactly as on the PAN") |
| Cash-flow type / "not applicable" hides cash-flow statements | — | ❌ | P1 |
| Home **process-flow chart** (where am I in the filing) | Filing explorer status dots | 🟡 | P1 |
| Share capital master with **auto total** | Share capital AI producer (counts read from the note) | ✅ (different) | — |
| **Narration master**: F-key text snippets ("Not applicable") | — | ❌ | P2 |
| 3-year tagging (Ind AS "prior to previous year") | CY / PY only | ❌ | P1 (Ind AS only, when it applies) |
| Notes: document view, select text → double-click element; F2 from Excel | Text range in Excel → dialog | 🟡 | **P0** (with Word import) |
| Per-company login and password | `.axbrl` file per filing | ➖ | — |

## 10. Suggested order
1. **P0 tagging:**
   - §8 fixes 1–6;
   - **Add / Replace** when a line already has a value (§11.6);
   - **line → note table jump with the BS-vs-note difference**, green at 0 (§11.6);
   - "This statement" tree;
   - tagged marks in the Taxonomy panel;
   - the mandatory text/date/Yes-No dialog.
2. **P0 output:** the Preview tab (MCA-like view + print).
3. **P0 notes:** Word import → text block.
4. **P1:**
   - Masters panel (company, directors, auditor);
   - footnotes UI;
   - right-click menus;
   - references in the inspector;
   - side Problems panel;
   - PDF.
5. **P2:**
   - Excel export of the mapping;
   - fixed-asset template;
   - duplicate PAN/DIN;
   - help videos;
   - CIN prefill (needs a data source).
