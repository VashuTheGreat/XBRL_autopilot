# 07 · AI fix agent (post-tagging errors)

**Goal:** after tagging, validation errors appear, both from our engine and from the MCA tool. The agent proposes concrete, reviewable **patches** that resolve them. **The agent never edits the filing.** It returns proposals, the user accepts or rejects each one, and the deterministic engine applies them and revalidates.

## Escalation ladder
1. **Deterministic quick fixes** (`engine/src/fixes.ts`). These are instant, need no AI, and have a "Fix" button:
   - GR-1: set the total to the sum of its parts, or fill the missing child.
   - Missing mandatory → nil/0 where allowed.
   - GR-6: missing CY → 0.
   - Statement ≠ note → take the note's value.
   - Confirm share capital to the exact rupee.
   - Move a column off a disallowed default member.
2. **AI fix** ("Ask AI" on one issue, or "Fix all with AI" on a group) for anything without a deterministic fix, or where several fixes are plausible (which child is wrong? is it a mis-tag?).

## Agent loop (sidecar `POST /api/v1/fix/propose`)
```
issue(s) + context bundle ─▶ Groq (tool calling, ≤ 6 steps) ─▶ patch list + rationale
```
**Context bundle** (built by Electron main from the engine):
- the issues: code, message, rule id + rule AST, location
- the facts involved, plus the other facts in the same ELR/calculation network, with their source cells and mapping provenance
- the MCA error text, if the issue came from the MCA tool
- filing meta: report type, periods, rounding level. CIN and company name are left out.

**Tools available to the model** (executed in the sidecar against the knowledge base and the bundle):
| Tool | Returns |
|---|---|
| `get_concept(qname)` | labels, type, periodType, balance, references, mandatory flags |
| `get_rule(elr, concept)` | raw MCA rule text from `knowledge_base` |
| `get_calc_tree(elr, concept)` | parent/children with weights |
| `facts_in_elr(elr)` | facts from the bundle |
| `search_taxonomy(text, filters)` | hybrid retrieval candidates (for remaps) |
| `get_source_row(cell)` | Excel row label, neighbours, raw value |

**Output (strict JSON):**
```jsonc
{
  "summary": "Trade payables total does not equal its children because MSME payables were tagged as Other current liabilities.",
  "patches": [
    { "op": "remap", "cell": {"sheet":"BS Sch","ref":"C14"},
      "from": "in-gaap:OtherCurrentLiabilitiesOthers", "to": "in-gaap:TradePayablesDueToMicroAndSmallEnterprises",
      "rationale": "Row label 'Due to MSME' …", "confidence": 0.86 },
    { "op": "setValue", "fact": {"concept":"…","period":"cy","dims":[]}, "value": "0", "rationale": "…" }
  ],
  "resolves": ["rule.GR-1@…"],
  "needsHuman": false
}
```
**Patch ops:** `setValue`, `setNil`, `remap` (cell → other concept), `setPeriod`, `setDims`, `addFootnote`, `editText` (text block HTML), `setMeta`.

## Review UI
- The AI panel shows a **diff card** for each patch: before → after, rationale, confidence, and links to the cell and fact.
- **Accept** applies the patch through the `Session` API, then revalidates. **Reject** records the decision. **Edit** lets the user tweak a patch before applying it.
- **"Fix all with AI"** loops: propose → user accepts all or some → revalidate → repeat. It stops when clean, after 5 rounds, or when nothing is accepted.
- Everything is appended to `ai/history.jsonl` in the project (audit trail: who accepted what, and when).

## Guardrails
- Each patch is validated by the engine **before** it's shown: unknown concepts, invalid dimensions and type mismatches are dropped.
- Amounts are never invented. `setValue` must come from the source Excel, an arithmetic identity, or explicit user input, and the rationale must say which.
- If the sidecar is unreachable or there's no key, AI features are disabled with a clear message, and deterministic fixes still work.
- Timeouts are 60 s per call; Groq 429/5xx responses are retried with backoff.
