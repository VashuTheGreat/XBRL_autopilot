# ADR-0008 · Taxonomy data for the UI comes only from the FastAPI routes
- **Status:** accepted (2026-11-10). Requested by the team lead: "use only these routes; legacy_js is for understanding; don't hardcode anything; loosely coupled".
- **Decision:**
  - The knowledge base (`knowledge_base/*.json`, built by `src/ingestion`) is the single source of taxonomy data for the UI, served by the FastAPI routes under `/api/v1/taxonomies/{id}`. The `id` selects the taxonomy: `ci_taxonomy`, `ind_as_taxonomy` or `costing_taxonomy`.
  - Electron reaches it only through the `TaxonomyCatalog` port (`ui/electron/main/services/ports.ts`). The adapter is `SidecarTaxonomyCatalog`, which maps app ids to knowledge-base ids.

| UI need | Route |
|---|---|
| Statement / notes / disclosures list | `GET /{id}/elrs` (grouped by title: "Notes - …" → Notes, "Disclosure(s) …" → Disclosures, otherwise Statements; same rule for every taxonomy) |
| XBRL Form structure (rows, order, depth, labels) | `GET /{id}/elrs/{code}/tree` |
| Element search | `GET /{id}/concepts/search?summary=true` (ranked) |
| Element details + MCA rule text | `GET /{id}/concepts/{qname}?include_rules=true` |

- **What still comes from the engine authority** (`engine/authority/*.json`, compiled from the official MCA files in `data/`, not hardcoded):
  - facts and values (CY/PY)
  - instance XML generation
  - validation
  - whether an element is reported only inside a dimensional table

  The knowledge base has no tables, hypercubes, dimension defaults or executable rules yet.
- **Next step (scheduled):**
  - Phase 6 moves the dimensional model into `knowledge_base` and serves it by a route; the engine loads its authority from that route, and the TS compiler is retired.
  - Phase 9 does the same for the executable rule ASTs.
- **Consequences:**
  - The statement tree and Form need the sidecar to be running; the catalog waits for `/health`.
  - The editor tests run against the real sidecar, so the contract is tested end to end.
