# 16 · XBRL pipeline architecture

**Status:** proposed 2026-11-18 for team review. The central decision is in [ADR-0016](decisions/ADR-0016-canonical-financial-package.md).

**How to read this:**
- §1 summarizes the pipeline as currently planned (docs 13-gap, 14-canonical, 15-master, `workflow.md`, `roadmap.md`).
- §2 goes through it stage by stage: what the plan **has**, what's **wrong** with it, and what we **add**.
- §3 is the resulting pipeline we propose to build; §4 its contracts; §5 the build order.

The existing code is not treated as a constraint. Where it's reused, §3 says why it is the right choice on the merits.

---

## 1. The current plan in brief

```
 Messy client files ──▶ Normalizer ──▶ 6 canonical Excel files + COMPANY_MASTER.json
 (.xlsx/.xls/.pdf)      (keywords / LLM-written code)    │
                                                         ▼
                        ELR-scoped vector search (3 partitions: line items, members, text blocks)
                                                         │
                         ┌───────────────────────────────┼──────────────────────────────┐
                         ▼                               ▼                              ▼
                 Statements [L]                    Tables [T]                      Notes [E]
              breadcrumb + line item         asset class → member,           chunk → text block,
              → concept (score bands)        column → concept, diff = 0      LLM picks, XHTML
                         └───────────────────────────────┼──────────────────────────────┘
                                                         ▼
                     Validate: calculations → table reconciliation → GR-3 zero-fill → schema
                                                         ▼
                                     Python XML generator → AOC-4 instance
```

**CA flow (7 tabs, as in webXBRL):** Master → Financial tagging → Notes tagging → Fixed assets / tables → Generate tuples → Validation → Utilities.

**Three ideas carry the plan, and all three are right:**
1. **Separate understanding the client's workbook from tagging it.** Once the data is in a known shape, everything downstream can be deterministic.
2. **Use the taxonomy's structure to narrow the search:** the statement, the concept kind, the breadcrumb, debit/credit.
3. **Treat statements `[L]`, tables `[T]` and narrative `[E]` as three different tagging problems.**

## 2. Stage by stage

### 2.1 Masters (company, directors, auditors, documents)
- **Has:** a separate Master tab, kept apart from notes tagging; `COMPANY_MASTER.json`; "Prefill from MCA" by CIN; reuse from last year.
- **Wrong:**
  - MCA has no public prefill API; the plan doesn't say where the data comes from.
  - The JSON shape is ad hoc. The master fields are taxonomy elements (`in-ca:` general information, auditor, director tables), but nothing ties a JSON key to its element, so the XML step needs hand-written glue.
- **Add:**
  - **Master fields defined from the taxonomy:** each field is `{element, dims?, type, mandatory-by-rule}`, generated from the general-information, auditor and directors ELRs. The form, the validation and the XML then all read the same definition.
  - Prefill from last year's XBRL instance (any vendor's), and from a **master library** shared across clients (auditor firms repeat).
  - MCA prefill only if a lawful source is confirmed (open question).

### 2.2 Import and normalize
- **Has:** classify each sheet (statement / notes / schedule / scratch), detect the header and the label / note / CY / PY columns, build breadcrumbs from headings, clean numbers ("(15,00,000)" → negative, "-" → 0), drop scratch sheets.
- **Wrong:**
  - **Keyword rules.** Sheet roles come from substrings of the sheet name (`'fa'`, `'tb'`, `'sheet1'`…) and headers from word lists. Every new client adds a rule, and nothing tells you when a rule misfired.
  - **An LLM writing parsing code per workbook** can't be reviewed by an accountant or tested, and it gives a different result on every run.
  - **No proof.** Nothing checks that the normalized output is the same accounts as the workbook.
  - **Headings found by "row has no amounts"** confuse blank lines, qualifiers ("(Unsecured, considered good)") and note titles.
- **Add:**
  - **Propose, then prove.** Candidate layouts come from general structural signals: dates matching the filing's period ends, numeric density, indent, bold or all-caps style, merges, note-reference cells. An optional LLM proposer sees only a *shape view*: labels and styles, numbers masked as `#`.
  - **Arithmetic decides between candidates:** totals foot, assets = equity + liabilities, a statement line = its note's total, PPE opening + movements = closing, cash-flow closing = balance-sheet cash.
  - **The CA confirms in a Normalize step** (the plan's Schema & Column Mapper), seeing the checks. A failing check names the row.

### 2.3 The canonical files
- **Has:** `CANONICAL_BS / PL / CF / SOCIE / PPE_SCHEDULE / NOTES` + `COMPANY_MASTER`, readable by a CA, zero XBRL in them.
- **Wrong:**
  - **They cover a fraction of a real filing.** In Dixon's MCA-accepted instance, 1,548 of the 2,666 facts are table amounts and 268 are table text (share classes, related parties, financial assets by category, ageing, KMP…). The plan has one table schema (PPE). Every other note table has nowhere to go.
  - **Numeric note breakdowns are missing.** `CANONICAL_NOTES` holds narrative only, but most notes are numbers (borrowings, trade payables, revenue, expenses).
  - **Amounts are floats.** `14500000.0` breaks paise and lakh-scaled figures (a figure of 5,443.47 lakhs is stored as `5443.466337358575`). MCA wants figures as presented, and share capital to the rupee.
  - **No link back to the cell.** Once copied, a figure no longer knows where it came from. Clicking a fact can't show the cell, an edit in Excel can't flow through, and Add / Replace / "view sources" are impossible.
  - **No scale, no rounding level, no per-sheet units.** "(₹ in lakhs)" is lost.
  - **Fixed column names** (`Gross_Opening`, `Dep_For_Year`…) are one company's layout. Other companies show ROU assets, CWIP ageing, impairment and transfer columns.
- **Add: one Canonical Financial Package** (§3.2). It keeps the good part (a clean, CA-readable, XBRL-free picture of the accounts) with four changes:
  1. **Generic shapes instead of one file per statement:** `statement`, `noteTable` (any grid), `noteText`, `master`. They cover every note.
  2. **Exact decimal strings** plus the scale and the presented decimal places.
  3. **Every value carries its source** (`sheet!cell`, or several cells for a sum).
  4. **Its own checks** are stored with it.

  The six Excel files become an **export view** of the package, generated for review.

### 2.4 Knowledge base and vector partitions
- **Has:** a tour of `ind_as_knowledge_base.json`. Three partitions so searches don't pollute each other: line items, members, text blocks. Abstracts excluded.
- **Wrong:**
  - **Partition rules are inexact.**
    - The line-item partition takes only `monetaryItemType`, so it misses shares, per-share and percent items (EPS, number of shares).
    - The text-block partition takes `stringItemType` (1,962 plain strings: names, PAN, addresses) when text blocks are `textBlockItemType` (405).
  - **One concept lives in many ELRs.** A filter like `elr == "110000"` assumes one ELR per concept.
  - **ELR codes differ per taxonomy.** `110000` is Ind AS numbering; C&I numbers differently.
  - **The vector DB is in the cloud,** so a desktop filing tool can't tag offline.
- **Add:**
  - **Partitions by data type and role:** `lineItem` (all non-abstract numeric types), `member`, `axis`, `textBlock` (`textBlockItemType`), `masterField` (string / date / boolean / PAN in the general ELRs).
  - Each concept is indexed with **all the statements it appears in**, as statement-group names from the ELR title (`Balance sheet`, `Profit and loss`, `Property, plant and equipment`…), never codes.
  - **A local index shipped with the app:** BM25 plus precomputed embeddings with a small ONNX query encoder. The cloud DB is optional (dev, chat assistant).

### 2.5 Statement tagging `[L]`
- **Has:** query = breadcrumb + line item; search scoped to the statement; a debit/credit filter; score bands (≥ 0.88 auto, 0.70–0.88 amber, < 0.70 red).
- **Wrong:**
  - **Hard debit/credit rejection breaks on contra and netted lines:** "Less: provision for doubtful debts", "Changes in inventories" (negative expense), deferred tax shown net.
  - **Search scoped to one statement only** misses lines that the taxonomy presents elsewhere. Some face lines only exist in a detail ELR.
  - **Fixed score bands** aren't measured. "99.9% accuracy" is a claim, not a result.
  - **No current / non-current qualifier, no period type** (instant vs duration), **no data type** (EPS is per-share).
  - **No memory:** the CA's corrections don't teach the next filing.
  - **The face line and its note total** are the same figure. The plan doesn't say which one is tagged, or how double counting is avoided.
- **Add:**
  - **Hard filters:** reportable, period type from the column header ("As at" / "Year ended"), data type, current / non-current qualifier from the breadcrumb.
  - **Soft signals:** balance side (a penalty, sign-aware: a negated label or a negative figure flips it); statement scope (own statement first, then widen with a penalty).
  - **Evidence ladder:** CA memory → exact label (all label roles) → BM25 → dense → cross-encoder rerank → LLM picks only among the offered candidates, or none.
  - **Calibrated confidence:** scores mapped to the observed hit rate on answer keys, so "90%" means right 9 times in 10. Bands come from data.
  - **Face ↔ note rule:** the face line tags the plain element; the note total is the same figure. It's linked as one fact, or as "also reported as" when the note puts it under a member. One fact always comes from one source.

### 2.6 Table tagging `[T]`
- **Has:**
  - a dedicated table window;
  - rows mapped to members (Land, Buildings…), a total row → domain member;
  - a live difference against the balance-sheet line (green at 0, red otherwise);
  - show / hide unused members.
- **Wrong:**
  - **The column → concept map is hand-written and wrong for Ind AS.** There is no `GrossCarryingAmount` concept. Gross / accumulated depreciation / net is an **axis** (`CarryingAmountAccumulatedDepreciationAndGrossCarryingAmountAxis` with `GrossCarryingAmountMember`…). Opening and closing balances are the same element with period-start / period-end labels.
  - **Example mappings are wrong:** "Office Equipment" → `FurnitureAndFixturesMember`, though `OfficeEquipmentMember` exists.
  - **Only the PPE table is designed.** There are ~200 tables in Ind AS, ~30 used by a typical filing.
  - **The reconciliation covers only schedule total vs balance sheet.** The roll-forward (opening + additions − disposals = closing per class) and the gross − depreciation = net identity are only in a code sketch, using floats.
  - **Zeros:** the plan doesn't say which empty cells must be reported as 0. In Dixon, 1,260 table facts are rule-required zeros.
- **Add:**
  - **Table templates generated from the definition linkbase:** for each table, its axes, members (with hierarchy), line items, period-start / period-end labels and applicable rules. No hand-written maps.
  - **Table matching is a 2-D assignment:** the note table's row headers and column headers are matched to (axis, member) or (line item, period role) using the template. Each cell's fact is then *derived* (concept + dims + period), not guessed.
  - **Reconciliation from the template:** roll-forward per member, axis totals (members sum to the domain), and the tie to the statement line, all in exact decimals. These run live in the table window.
  - **Unmatched rows** become a "choose member" prompt, or a typed / custom member where the taxonomy allows one.
  - **Rule-driven zeros:** for each slice that has a value, report as 0 the line items that the MCA rules make mandatory. This runs as an explicit action with a list of what it filled.

### 2.7 Notes tagging `[E]`
- **Has:** narrative text blocks vs discrete values inside notes; heading-based chunking; the LLM picks among top candidates; XHTML clean-up; a missing-disclosure check (CSR expense but no CSR text).
- **Wrong:**
  - **The LLM formats the XHTML.** The output changes from run to run and can drop or alter words in a statutory document.
  - **The missing-disclosure check is given to the LLM.** It's a rule ("if X reported then Y required"); MCA publishes these as conditional-mandatory rules.
  - **Discrete values inside text** ("41,78,300 shares") have no path to a fact.
- **Add:**
  - **A deterministic XHTML sanitizer:** an allow-list of tags, tables kept, styles stripped, a word-for-word diff check against the source.
  - **Missing disclosures come from the executable conditional-mandatory rules.** The LLM may only explain them.
  - **Picking numbers from text:** a figure inside a text cell becomes a fact with its source (cell + character offsets).
  - Text-block candidates are scoped to the note's statement group, ranked like §2.5.

### 2.8 Validation and zero-fill
- **Has:**
  - order: calculations → table reconciliation → zero-fill → schema check;
  - an interactive error table with jump-to-cell;
  - business rules compiled from MCA's workbook into data (no code change when MCA updates);
  - Arelle for syntax; the MCA tool as the final gate.
- **Wrong:**
  - **"GR-3: fill every mandatory empty element with 0.00" overfills.** Zeros are required per **applicable slice** and per rule (ML-*, SR-*). Blanket filling creates facts MCA then flags.
  - **Validation is a one-shot gate** before generation. CAs work faster when problems appear as they tag.
  - **No fix path:** errors are listed, not resolved.
- **Add:**
  - **Live validation on every change:** gate (types, periods, contexts), the 1,351 MCA rules, calculations, table reconciliation, ties. Each problem points at a canonical row and therefore at a cell.
  - **Zero plans** as above: explicit, listed, reversible.
  - **Fix plans:** each quick fix or AI suggestion is a typed patch the engine dry-runs ("fixes 3, introduces 0") before the CA applies it.
  - MCA tool errors imported back onto the same problems list.

### 2.9 XML generation
- **Has:** a deterministic generator; contexts (instant, duration, dimensional), units, master facts, statement and table facts, escaped text blocks.
- **Wrong:**
  - **Two engines.** The plan validates in the app (doc 13 §4, in-memory) but generates XML in a new Python service (roadmap Phase 7). Two implementations of contexts, periods, decimals and dimensions will disagree, and the XML MCA checks would not be the model the CA saw validated.
  - `decimals="2"` is fixed; it must follow the rounding level and the presented places.
  - Context ids, schemaRef and namespaces are hand-written in the example. Ind AS uses both `ind-as` and `in-ca` element families.
- **Add:**
  - **One engine** owns the filing model, validation and XML (§3.5). It's deterministic, has no network access and is golden-tested: generating Dixon's facts must give an MCA-equal instance.
  - **Round-trip:** importing any vendor's instance and regenerating it gives the same facts. This proves the generator and gives "start from last year".

### 2.10 Project storage and process split
- **Has:**
  - a project folder per company and year (`raw/`, `canonical/`, `mappings/`, `validation/`, `output/`);
  - Electron UI + a stateless FastAPI sidecar on localhost with a per-launch token;
  - client data stays local.
- **Wrong:**
  - **A loose folder** is easy to break: a moved or edited CSV goes out of sync silently. It can't be emailed or attached as one item, and it can't be saved atomically.
  - **The sidecar is "stateless" but asked to generate XML,** which means sending it the whole filing.
- **Add:**
  - **One project file (`.axbrl`, a zip) whose inside *is* that folder layout:** `raw/`, `package/`, `tags/`, `checks/`, `output/`. Saved atomically with autosave and recovery, and still human-inspectable by unzipping.
  - **The sidecar does AI and parsing only.** State and the engine live in the app.

### 2.11 AI usage and privacy
- **Has:** Groq LLM for note classification and the chat assistant; RAG over MCA guidance.
- **Wrong:**
  - Every feature builds its own payload, so nothing controls what leaves the machine.
  - The prototype sends whole client sheets.
- **Add:** an **LLM gateway** in the app. Every AI call goes through it:
  - **redaction per call type:** shape views for layout, labels without amounts for tagging, minimal context for fixes;
  - **consent per project**;
  - **a local log** of what was sent.

---

## 3. Our pipeline

```
 ① INGEST        ② NORMALIZE            ③ TAG                     ④ ASSURE            ⑤ FILE
 workbook,  ──▶  Canonical Financial ──▶ Tag map            ──▶  live validation ──▶ XML + filing
 Word/PDF,       Package (proved by       [L] statements          zero plans          pack
 last year's     arithmetic, CA-          [T] tables (templates)  fix plans           MCA tool
 XML             confirmed)               [E] text blocks         ties, roll-fwd      round-trip
                                          [M] masters
     │                 │                        │                      │                  │
   app            sidecar proposes,        sidecar suggests,      engine (app)       engine (app)
                  app stores               CA accepts
```

### 3.1 Ingest
- **Inputs:** `.xlsx` / `.xls` (values, number formats, merges, indent, bold), Word / PDF of the signed financials and reports (paragraphs with offsets), and last year's XBRL instance (facts → masters and PY values).
- **Output:** a `SourceModel`. Raw cells and paragraphs, untouched, kept in the project under `raw/`.

### 3.2 Normalize → Canonical Financial Package (CFP)
```ts
interface CanonicalPackage {
  version: 1;
  filing: { taxonomy: 'ci' | 'ind_as'; periods: { cy: Period; py: Period };
            scale: Scale; presentedPlaces: number; rounding: RoundingLevel };
  statements: Statement[];   // balance sheet, P&L, cash flow (+ SOCIE as a table)
  noteTables: NoteTable[];   // any grid in the notes: PPE, ageing, share classes, related parties…
  noteTexts: NoteText[];     // narrative: policies, contingencies, reports
  master: MasterValues;      // keyed by master field id (§2.1), not free JSON
  checks: CheckResult[];     // footing, balance, ties, roll-forward, CF cash = BS cash
  confirmed: boolean;
}
interface Statement { id: string; kind: string /* group name from the ELR title */; rows: StatementRow[] }
interface StatementRow {
  id: string;                       // stable across re-normalize
  label: string; breadcrumb: string[];
  role: 'heading' | 'line' | 'total' | 'subtotal';
  side?: 'assets' | 'liabilities' | 'equity' | 'income' | 'expense';
  qualifier?: 'current' | 'noncurrent';
  noteRef?: string; childIds?: string[];
  values: Record<'cy' | 'py', Amount | null>;
}
interface Amount { value: string /* exact decimal */; sources: { cell: string; sign: 1 | -1 }[] }
interface NoteTable {
  id: string; noteRef: string; title: string;
  rowHeaders: Header[]; colHeaders: Header[];      // multi-level, each with its source cells
  cells: { r: number; c: number; amount: Amount }[];
}
interface NoteText { id: string; noteRef?: string; title: string;
                     paragraphs: { text: string; source: string /* cell range or doc offsets */ }[] }
```
- **How it's built** (§2.2): structural proposal + optional LLM proposal → candidates scored by `checks` → the CA confirms in the **Normalize** screen. Each statement, table and text is shown with its check results.
- **Re-normalize is safe:** row ids are stable, so tags survive, and changed values flow through their sources.
- **Export:** "Canonical Excel" writes BS / PL / CF / SOCIE / one sheet per note table / notes text, with a check sheet. This is the CA's review copy.

### 3.3 Tag → Tag map
Tags attach to **package items**, never to raw cells, so tagging is independent of the client's layout.
```ts
type Tag =
  | { kind: 'L'; rowId: string; period: 'cy' | 'py'; concept: string; dims?: Dims; also?: FactRef[] }
  | { kind: 'T'; tableId: string; template: string;     // table template id
      rows: { r: number; member?: MemberRef; lineItem?: string; periodRole?: 'start' | 'end' }[];
      cols: { c: number; member?: MemberRef; lineItem?: string; period?: 'cy' | 'py' }[] }
  | { kind: 'E'; textId: string; concept: string; paragraphs: number[] }
  | { kind: 'M'; field: string; value: string };
// each Tag also records: origin ('memory' | 'exact' | 'search' | 'llm' | 'manual'), confidence, accepted
```
| Tagger | Input | Method | Output |
|---|---|---|---|
| **[L] statements** | statement rows | hard filters → soft signals → evidence ladder → calibrated confidence (§2.5) | `L` tags + "also reported as" |
| **[T] tables** | note tables + table templates | header → (axis, member \| line item, period role) assignment, then derive each cell; reconciliation live (§2.6) | `T` tags |
| **[E] text** | note texts | heading chunks → text-block candidates in the note's group → rerank / LLM pick (§2.7) | `E` tags |
| **[M] masters** | master values | field ids are elements already; no search | `M` tags |

**Statement ↔ note linkage:** `noteRef` ties a statement row to its note table / text. The face line and the note total are checked equal (a check) and tagged once.

### 3.4 Knowledge base, templates and index (built offline by `make rebuild`)
| Artifact | Built from | Used by |
|---|---|---|
| Engine authority + executable rules | official taxonomy + MCA rule workbooks | engine (validation, XML) |
| **Table templates** | definition linkbase + labels + rules | [T] tagger, table window, zero plans |
| **Master field definitions** | general-information / auditor / director ELRs + rules | Master tab, [M] |
| **Search index** (partitions: lineItem, member, axis, textBlock, masterField; statement groups per concept) | browsing knowledge base | taggers (local BM25 + ONNX dense) |
| **Calibration maps** | answer-key runs | taggers' confidence |

All of it is data. A new MCA taxonomy or rule workbook means a rebuild, not code.

### 3.5 Assure and file: one engine
- **Where it runs:** in the app process (a worker).
- **What it does:** turns package + tags + masters into facts, validates live, plans zeros and fixes, generates XML and imports instances.
- **Why in the app, not in the sidecar:**
  - validation must run on every edit, with no round-trip;
  - generation must be the same model that was validated;
  - filing must work with the sidecar down.
- **Why TypeScript:** the app is TypeScript. The existing `@xap/engine` already meets the bar (golden-tested on C&I, 0 ERRORs on Dixon, byte-identical regeneration) and would have to be rebuilt to that bar in any other language. If that weren't true, the choice would be open.
- **Filing pack** in `output/`: XML, the MCA tool report, the zero-plan list, the source audit (fact → package item → cell), and the canonical Excel export.

### 3.6 Process split
| Process | Owns | Never |
|---|---|---|
| **Renderer** | screens: Master, Normalize, Tag [L] / [T] / [E], Problems, Preview | files, network |
| **App main** | `.axbrl`, package, tags, engine worker, LLM gateway, settings / secrets | heavy work on the main thread |
| **Sidecar** | parsing `.xls` / Word / PDF, normalize proposals, the taggers, chat | project state, writing XML |

## 4. Sidecar routes (stateless; each request carries what it needs)
| Route | In | Out |
|---|---|---|
| `GET /health` | – | taxonomies, index version, AI availability |
| `GET /taxonomies/{id}/…` | – | catalog, trees, authority, rules, **table templates**, **master fields** |
| `POST /normalize/propose` | source model (+ shape view for the LLM if enabled) | candidate packages with check results |
| `POST /tag/statements` | statement rows + filing context | `L` suggestions with candidates and calibrated confidence |
| `POST /tag/tables` | note table + candidate templates | `T` suggestions + the derived facts preview |
| `POST /tag/texts` | note texts | `E` suggestions |
| `POST /fix/propose` | problem + minimal context | fix plan (patches) |
| `POST /chat`, `/conversations` | question | answer (RAG over MCA guidance) |

There is no `/instances/generate` route: the engine is in the app.

## 5. Build order
Each phase is merged only when its measurement passes on the answer keys: DGPL ↔ Dixon (Ind AS), HPL (C&I), Rebel when available.

| Phase | What | Done when |
|---|---|---|
| **P0 · Measure** | Answer-key harness on the new contracts: package checks, [L] precision / recall, [T] cell yield, [E] hit rate, calibration error. Runs in CI | baseline numbers recorded |
| **P1 · Package** | CFP contract (TS + pydantic), stored in `.axbrl`; `/normalize/propose` (structural); the checks; Normalize screen; Canonical Excel export | DGPL and HPL normalize with all checks green after CA confirmation |
| **P2 · Statements [L]** | Search index + partitions, hard / soft filters, evidence ladder, calibration, face ↔ note linkage | precision / recall ≥ target on DGPL and HPL |
| **P3 · Templates + tables [T]** | Table templates from the definition linkbase; header assignment; table window with live reconciliation; zero plans | Dixon's table facts reproduced (yield target agreed after P0) |
| **P4 · Text [E] + masters [M]** | Sanitizer, text-block tagger, numbers-in-text; master field definitions, Master tab, prefill from last year's XML | Dixon text blocks and general-information facts measured |
| **P5 · Assure + file** | Engine on package + tags: live validation, fix plans with dry-run, filing pack, MCA tool round-trip | Dixon regenerated → 0 ERRORs in the MCA tool |
| **P6 · AI gateway** | Redaction profiles, consent, audit; optional LLM normalize proposer and rerank; live LLM evaluation on synthetic workbooks | LLM adds measurable gain or stays off |
| **P7 · Offline + ship** | Local ONNX dense retrieval, installer with index, auto-update, taxonomy / rule data packages | offline = online within 1 point |

## 6. Product decisions (recommended; confirm with the team)
| # | Question | Recommendation | Why |
|---|---|---|---|
| 1 | **Masters prefill**: where does company / director / auditor data come from? | Last year's XBRL instance (any vendor's, already importable) + a firm-wide master library + "paste MCA master data" (the CA copies the company's master-data page and we parse it). No scraping of the MCA portal | MCA has no public API; scraping fights captchas and the portal's terms, and breaks when the portal changes |
| 2 | **Normalize screen**: when is it shown? | Only when a check fails or the layout is new for this client. Otherwise a banner: "Normalized ✓ 14/14 checks · Review". The client's layout is remembered for next year | Full review every time slows the CA; never showing it hides mistakes. The checks tell us when the CA needs to look |
| 3 | **Vector DB** in the shipped app? | Local only: BM25 + ONNX embeddings shipped (~10–17 MB). Qdrant only for development and the optional chat assistant | The taxonomy is a fixed ~5.6k concepts; the cloud adds latency, outages, cost and a key to distribute, and breaks offline filing |
| 4 | **LLM consent** | Everything works without an LLM. LLM help is one firm-level switch, asked once at first run; redaction is always on; amounts never leave the machine; every call is logged locally | CAs are bound by client confidentiality; a clear, single choice is easier to trust than per-feature prompts |
| 5 | **Answer keys** beyond DGPL ↔ Dixon and HPL | Target 10 pairs (5 Ind AS, 5 C&I) of workbook + MCA-accepted XML: past filings from CAs we know; MCA "View Public Documents" (paid, per company) for filed XBRL + financial-statement PDF, to be verified | Two pairs can't tell a real improvement from overfitting; every phase in §5 is gated on these numbers |
