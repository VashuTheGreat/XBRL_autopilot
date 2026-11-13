# 07 · AI fix agent (post-tagging errors)

> [!NOTE]
> **Status: Deferred (2026-11-13)**
> The AI fix agent implementation has been temporarily deferred in favor of frontend software workflows and deterministic engine validation:
> 1. **Deterministic Resolution for Missing Lines:** Validation errors resulting from missing mandatory amounts are handled deterministically in the frontend and engine via automated zero-filling (`engine/src/core/fixes.js` and rule-driven zeros), which requires no probabilistic LLM intervention.
> 2. **Tagging-Time Quality Over Post-Tagging Guessing:** Substantive errors (e.g. calculation mismatches or mis-tagged elements) stem from tagging decisions. High-accuracy auto-tagging (`/api/v1/mapping/suggest_column` with Hybrid Search + FlashRank reranking) coupled with accountant review solves these at the source. Any genuine discrepancies require CA judgment rather than autonomous AI adjustments.
> 3. **Sidecar Status:** The endpoint `/api/v1/fix/propose` remains a stub returning `503 Service Unavailable`. Development effort is concentrated on frontend spreadsheet interaction, tag workflows, and deterministic validation.

**Goal:** after tagging, validation errors appear, both from our engine and from the MCA tool. The agent proposes concrete, reviewable **patches** that resolve them. **The agent never edits the filing.** It returns proposals, the engine checks every one, the user accepts or rejects each, and accepted patches are applied through the ordinary editing paths and revalidated. Architecture: [ADR-0012](decisions/ADR-0012-ai-fix-patches.md).

## Escalation ladder
1. **Deterministic quick fixes** (`engine/src/core/fixes.js`, the **Fix** button in Problems). They are instant, need no AI, and always work, with or without AI:
   - GR-1: total = sum of its parts.
   - Missing mandatory amount → 0.
   - CY/PY pairing → 0 for the missing year.
   - Statement ≠ note → take the note's value.
   - Share capital to the rupee.
   - V3 schemaRef.
   - Move a column off a disallowed default member.
2. **AI fix** for anything without a deterministic fix, or where several fixes are plausible:
   - **✦ Ask AI** on one problem;
   - **Fix all with AI** in the Problems or AI Agent toolbar.

## Pipeline
```
Problem ──▶ ContextBundleBuilder (Electron) ──▶ POST /api/v1/fix/propose (sidecar)
              no identity data, opaque ids        privacy check → Groq tool loop (≤ 6 calls) → strict JSON
                                                   → structural check of every patch against the bundle
        ◀── PatchVerifier (engine checkPatch + Excel checks + dry run) ◀──┘
        ──▶ AI panel diff cards ──▶ Accept: PatchApplier (Session / MappingService) → revalidate
                                    Reject: recorded
        every request (exact payload), response and decision → ai/history.jsonl
```

### Context bundle (`ui/electron/main/services/context-bundle-builder.ts`)
**Sent:**
- **The problem:** severity, family, code, rule id, the rule's MCA text and executable form (AST), message, statement, element, year, Excel cell. For MCA tool errors, the MCA text and its plain-language explanation.
- **Facts, at most 300:**
  - the problem's own fact;
  - the element's other years;
  - the elements its rule names;
  - its calculation parents and children;
  - the other facts of its statement.

  Each fact carries an opaque id (`f1` …), element, label, data type, year, period, dimensions, value (as in the XML, rupees), display value (in the filing's rounding level), decimals, origin, the Excel cell it was tagged from, and its statements.
- **Excel rows, at most 60:**
  - the row of every fact's cell, with its label;
  - the other number cells of that row, with the year of their column;
  - for an element with no tagged cell, the workbook rows whose label reads like the element (named by their current-year cell, never a "Note No." column).
- **Filing meta:** report type, periods, rounding level, first financial year.

**Never sent:**
- the CIN and company name (also scrubbed from free text);
- identity elements (`IDENTITY_ELEMENT` in `ui/shared/privacy.ts`: names, PAN, DIN, addresses, contacts, membership and registration numbers);
- text blocks other than the problem's own fact;
- text over 200 characters;
- typed members that aren't sequence numbers;
- fact keys;
- file paths.

### Agent loop (`src/services/fix_agent/`)
- `bundle.py`: the request schema.
- `privacy.py`: the second privacy check (422 `privacy`, nothing sent).
- `tools.py`: the tools below.
- `agent.py`: the loop.
- `patches.py`: the patch schema and structural check.
- `src/services/llm/groq.py`: the shared Groq client.

| Tool | Answers from | Returns |
|---|---|---|
| `get_concept(qname)` | knowledge base | labels, documentation, type, period type, balance, mandatory, statements, whether it is in a table |
| `get_rule(rule_id?, concept?)` | knowledge base | the executable rule (status, implementation, AST) and the raw MCA rule texts for an element |
| `get_calc_tree(concept, elr_code?)` | knowledge base + bundle | calculation parents and children with weights per statement, with the filing's values for them |
| `facts_in_elr(elr_code)` | bundle | the filing's facts of one statement |
| `search_taxonomy(text, limit)` | knowledge base | BM25 over element labels (the tagger's index), then a word search for text elements |
| `get_source_row(sheet, ref)` | bundle | the Excel row: label, value, number cells with their column's year |

**How the loop runs:**
- At most `maxSteps` (6) LLM calls. The last call forbids tools and asks for the final JSON.
- A per-request token budget: 24,000 by default.
- An unreadable answer is retried once with a repair prompt.
- Groq's 400 `tool_use_failed` (a malformed tool call) gets a nudge instead of failing.
- Responses: 409 `ai.disabled` without a key, 502 `ai.failed` when Groq fails after retries.

**Output (strict JSON):**
```jsonc
{
  "summary": "The current-year figure is in BS!C9, next to the previous-year figure.",
  "patches": [
    { "op": "setValue", "fact": {"concept": "in-gaap:ShareCapital", "scope": "CY"}, "value": "60000000",
      "source": {"kind": "cell", "cell": {"workbook": "workbook-1.xlsx", "sheet": "BS", "ref": "C9"}},
      "rationale": "C9 is the current-year column of the same row.", "confidence": 0.92 }
  ],
  "resolves": ["p1"],
  "needsHuman": false
}
```

**Patch ops:**

| Op | Means | Applied by |
|---|---|---|
| `setValue` + source `cell` | the amount is in that Excel cell (same year column) | `MappingService.tag` (origin `ai`, confidence) |
| `setValue` + source `identity` | Σ weight × facts; the engine recomputes it | engine `applyFactPatch` |
| `setValue` / `setText` + source `user` | the user types / confirms it in the card | engine `applyFactPatch` |
| `setNil` | xsi:nil (element must be nillable) | engine |
| `remap` | re-tag a cell to another element (same kind: amount / text) | `MappingService.tag` (teaches the memory when accepted) |
| `setScope` | the cell is the other year | `MappingService.setScope` (origin `ai`) |
| `removeFact` | remove a fact (and its Excel tag) | `MappingService.untag` or engine |

`setDims`, `addFootnote`, `editText` and `setMeta` are deferred: table values come with table tagging, and `setMeta` touches identity data. A `value` is "as presented", in the filing's rounding level, the way a user types it. The model's `confidence` may come back as a word ("high") or a percentage; it is read, not dropped.

## Guardrails (in order)
1. **Sidecar, structural:** an unknown op, an element that isn't in the taxonomy, a cell or identity fact that isn't in the bundle, or a `setValue` without a plain number → dropped with a reason. A made-up fact id on a set op is ignored, and the element + year identify the fact. A `removeFact` needs a real one.
2. **Engine (`checkPatch`):** reportable element, not table-only, applicable for the year, previous year not locked, the type fits (amount vs text, boolean / enum / date formats), nillable, identity arithmetic at the terms' accuracy.
3. **Excel (`PatchVerifier`):**
   - the cell shows exactly that amount, in a column of that year, and isn't tagged as something else;
   - a re-tag or year change needs a tagged cell;
   - a value that came from Excel is never typed over.
4. **Dry run:** the patch is applied to a copy of the filing and validated. The card says "clears the problem" or "does not clear it by itself".
5. **Accept** checks again (the filing may have changed), with what the user typed.
   - Removals and user-supplied values need the explicit confirmation checkbox.
   - Validation reruns at once.

## Review UI (AI Agent tab, `AiPanel.tsx`)
- **One diff card per patch:** title, before → after, source ("from Excel BS!C9", "= Share capital + Reserves and surplus", "you type it"), confidence, dry-run result, rationale, and a locate button that opens the statement row and the Excel cell. Actions: **Accept**, **Edit** (type or change the value of a user-supplied or text patch), **Reject**.
- Dropped proposals are listed with the reason (sidecar / engine / Excel).
- **History** shows `ai/history.jsonl`: every request with the exact payload, every response (patches, usage, tool calls), and every accept / reject / failure, with who and when.
- **When AI is off,** a banner says why: no consent, no key, AI engine not running, or "repository client data". Ask AI is disabled; the quick fixes stay.

## Fix all with AI
- Each round takes **at most 10 errors** (errors only, each problem once per run) and asks about each in turn. The user reviews the round's cards.
- When no card is left open, the filing is revalidated and the next round starts.
- It stops when:
  - the filing is clean;
  - after **5 rounds**;
  - nothing was accepted in a round;
  - the AI proposed nothing;
  - the run's **token budget** (250,000) or **time budget** (15 min) is used up;
  - the user stops it;
  - the AI service fails.
- The panel shows "Fix all · round n/5 · tokens used / budget · stopped: <reason>".

## Measured (2026-11-11)
- **Mock E2E** (`ui/e2e/phase10-ai-fix.mjs`, 22 checks): green.
- **Live Groq smoke test** (`ui/e2e/phase10-live-groq.mjs`, `openai/gpt-oss-120b`, synthetic sample only): 4 of 4 problems got a correct Excel-sourced card that clears its problem on the dry run (CY share capital from C9; CY / PY reserves from C10 / D10). 2–6 s and about 2,200 tokens per problem.
- The first live runs found three issues, all fixed:
  - `confidence: "high"` dropped every patch;
  - a made-up fact id for a new fact;
  - a "Note No." cell cited as the amount (caught by the Excel check).
