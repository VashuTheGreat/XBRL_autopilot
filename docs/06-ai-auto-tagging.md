# 06 · AI auto-tagging (Excel → taxonomy)

**Goal:** given an imported workbook, propose for every numeric/text cell *which taxonomy fact it is*: concept + period (CY/PY) + dimensions + sign + scale. Each proposal carries a confidence and a short rationale. The accountant approves; nothing is written to the filing until approved (bulk "accept all ≥ 0.9" allowed).

## Pipeline (sidecar `POST /api/v1/mapping/suggest`)
```
sheets (normalized rows) ─▶ 1 layout analysis ─▶ 2 candidate generation ─▶ 3 filtering ─▶ 4 LLM rerank ─▶ 5 assemble
```
1. **Layout analysis** (port of `lagacy_js/excel-import.js` heuristics, extended):
   - sheet kind: balance sheet / P&L / cash flow / note / schedule (sheet name + content cues)
   - header row, *Particulars* column, *Note No.* column, CY/PY value columns (year numbers, "current/previous", dates like `31.03.2026`)
   - scale ("₹ in lakhs", "Rs. '000"), negative notation (brackets, minus, "Dr/Cr")
   - row hierarchy (indentation, bold, "Total …" rows) → parent/child guesses
2. **Candidate generation** per row label, in priority order:
   1. **Mapping memory** (approved before; sent by Electron from SQLite) → confidence 0.97+
   2. **Exact label match** against standard/terse/total labels (normalized) → 0.95
   3. **Hybrid retrieval**: BM25 over labels + embedding similarity (Chroma) → top-k (k=10) — fills empty `src/services/retrieval/hybrid.py` & `reranking.py`
3. **Filtering** with taxonomy structure (from `knowledge_base/ci_knowledge_base.json`):
   - ELR consistent with sheet kind (BS → 100100, P&L → 100200, CF → 100300/100400, notes → 2xxxxx…)
   - `periodType` (BS rows instant; P&L duration), `balance` vs sign, monetary vs text type, not abstract
   - Calculation tree consistency: children of a mapped total should map to that total's calculation children
4. **LLM rerank (Groq)** — only when top candidate isn't decisive (memory/exact skip the LLM):
   - prompt = row label + neighbours (parent heading, siblings, total row) + sheet kind + top-k candidates (qname, label, ELR, periodType, balance, definition)
   - structured JSON output: `{concept, confidence, rationale}` or `{concept: null, reason}`
   - batch rows per request (≈30) to save latency; temperature 0
5. **Assemble**: produce mapping entries for each value cell (CY & PY columns share the concept; period from column). Confidence < 0.6 → `needs-review`.

## Request / response
```jsonc
// POST /api/v1/mapping/suggest
{
  "taxonomy": "ci_taxonomy",
  "sheets": [{ "name": "BS", "rows": [{ "r": 5, "cells": [{"ref":"A5","v":"Share capital","bold":false,"indent":1},
                                                           {"ref":"B5","v":"3"},{"ref":"C5","v":125000},{"ref":"D5","v":125000}]}]}],
  "memory": [{ "normLabel": "share capital", "concept": "in-gaap:ShareCapital", "approvals": 4 }],
  "options": { "useLlm": true, "maxCandidates": 10 }
}
// → 200
{
  "layout": [{ "sheet": "BS", "kind": "balance_sheet", "labelCol": "A", "noteCol": "B",
               "periodCols": {"cy": "C", "py": "D"}, "scale": "Actual" }],
  "suggestions": [{ "cell": {"sheet":"BS","ref":"C5"}, "label": "Share capital",
                    "concept": "in-gaap:ShareCapital", "period": "cy", "dims": [],
                    "sign": 1, "confidence": 0.95, "origin": "exact",
                    "rationale": "Exact standard label; instant; ELR 100100",
                    "alternatives": [{"concept":"…","score":0.71}] }]
}
```

## Learning loop (mapping memory)
- On approve/change, Electron upserts `mapping_memory(norm_label, sheet_kind, concept, …, approvals++)` in SQLite.
- Memory is per-installation (private). Sent with each suggest request; sidecar stays stateless.

## Tagging-quality review (differentiator)
After mapping, an optional AI pass flags suspicious tags the MCA validator can't see: lumping into residual "Other…" tags, sign/balance contradictions (e.g. DTA vs DTL), a note line tagged to a statement-level concept, untagged material rows. Output = INFO/WARNING issues with suggested remaps.

## Embeddings & packaging
Current: `sentence-transformers/all-mpnet-base-v2` via torch (~1 GB+ in a PyInstaller bundle). Plan: switch to an ONNX runtime (fastembed / onnxruntime, small model e.g. bge-small) and ship a **prebuilt Chroma index** in resources so first run needs no download.

## Groq
- OpenAI-compatible endpoint `https://api.groq.com/openai/v1`. Default model **`openai/gpt-oss-120b`** (tool calling + JSON); cheaper fallback `openai/gpt-oss-20b`. Configurable via `GROQ_MODEL` / Settings.
- Data minimization: send labels + candidate definitions; send amounts only when needed for disambiguation (never CIN/company name).
