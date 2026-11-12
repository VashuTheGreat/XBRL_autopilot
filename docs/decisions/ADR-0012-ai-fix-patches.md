# ADR-0012 · AI fix proposals: a patch model the engine checks, split tools, privacy checked twice
- **Status:** accepted (2026-11-11). Phase 10. Details: [07-ai-fix-agent](../07-ai-fix-agent.md).
- **Context:**
  - Validation (Phase 9) leaves problems that have no deterministic quick fix, or that have several plausible fixes (which child is wrong? is it a mis-tag?). An LLM can propose a fix, but CLAUDE.md non-negotiable 2 says AI only proposes.
  - The sidecar is stateless (non-negotiable 5). The filing, the Excel linkage and the rules live in Electron and the engine.
  - The filings are unpublished company financials. Real client files sit in `data/`, and they must never reach an AI service.
- **Decision:**
  1. **The engine owns patches.** The agent answers with a strict JSON patch list. The v1 ops are `setValue`, `setNil`, `remap`, `setScope`, `removeFact` and `setText`. `engine/src/patches.ts` (pure, deterministic) does three things:
     - `checkPatch` decides whether a patch may be shown at all: element, type, applicability, locked year, and whether an arithmetic identity really holds. It also gives the before → after for the card and says whether the user must type a value or confirm.
     - `applyFactPatch` applies fact-level ops through the Session.
     - `dryRun` applies ops to a copy of the filing and validates the copy, so the card can say whether the problem clears.

     Excel-linked ops are applied by `MappingService`, so the cell ↔ fact linkage stays. These are a re-tag, a change of year, and a value read from a cell. The tag records origin `ai` with the patch's confidence.
  2. **Amounts are never invented.** A `setValue` names its source:
     - `cell`: the Excel cell showing the amount, in a column of that year. The app checks the cell's amount against the patch's value.
     - `identity`: Σ weight × facts. The engine recomputes it.
     - `user`: the card asks the user for the value.

     A typed value never overwrites a value that came from Excel (ADR-0009).
  3. **The tools are split between the sidecar and the bundle.**
     - The sidecar answers `get_concept`, `get_rule`, `get_calc_tree` and `search_taxonomy` from `knowledge_base/`.
     - `facts_in_elr` and `get_source_row` are answered from the bundle Electron sends with the request.
     - The loop is capped at 6 LLM calls and a per-request token budget.
  4. **Privacy is checked twice.**
     - Electron's `ContextBundleBuilder` leaves out the CIN, the company name, identity elements (names, PAN, DIN, addresses, contacts), and text blocks other than the problem's own fact. It cuts text to 200 characters and redacts typed members that aren't sequence numbers.
     - Fact keys never leave the machine: the bundle uses opaque ids (`f1`, `f2`, …).
     - The sidecar checks the bundle again before any LLM call (`privacy.py`, with the same element pattern as `ui/shared/privacy.ts`; a pytest compares the two). A violation returns 422, and nothing is sent.
     - The exact payload sent is appended to `ai/history.jsonl`, so the user can see what left the machine.
  5. **Fixture guard.** At startup, when `data/` exists (development), the app hashes the client files in `data/`: every top-level `.xml`/`.xls(x|m)`/`.pdf` except the synthetic `sample_financials.xlsx`. A project whose workbook or imported instance matches one of them gets no AI. Matching is by content (XML normalised for BOM and line ends) or by original file name. **The packaged app has no `data/`, so there the guard is empty and never blocks anything.** Tests and the E2E use a scripted LLM (a fake proposer, a fake chat model, or a local mock server through `GROQ_URL`).
  6. **One Groq client.** `src/services/llm/groq.py` is shared by the tagging rerank and the fix agent:
     - 60 s timeout per call;
     - backoff on 429/5xx (honours `Retry-After`) and on connection errors;
     - `GROQ_URL` accepted only as https or loopback http.
- **Consequences:**
  - Accepting a patch goes through the same paths as typing or tagging. Validation reruns at once.
  - An accepted re-tag teaches the mapping memory like any tag. A rejected one never does.
  - Removals, and any value the user must supply, need an explicit confirmation in the card.
  - Fix all runs rounds of at most 10 errors. Each problem is tried once per run. It stops when the filing is clean, after 5 rounds, when nothing was accepted in a round, when the AI proposes nothing, or when the run's token or time budget is used up. The panel shows the round and the stop reason.
  - AI needs the user's consent, a Groq key and a running sidecar. Deterministic quick fixes never depend on any of them.
  - Table (dimensional) values can't be changed by a patch yet (`setDims` comes with table tagging). `addFootnote`, `editText` and `setMeta` are deferred.
