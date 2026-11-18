# Docs index

Read the doc that matches the task. Keep docs short, factual and current. When code and docs disagree, fix the docs in the same change.

| # | Doc | Read it when… |
|---|---|---|
| — | [STATUS.md](STATUS.md) | Starting any session: what's done, in progress and next. Roadmap: 11 = complete end-to-end tagging ([ADR-0013](decisions/ADR-0013-table-tagging.md)), 11b = packaging, 12 = Costing; ADR-0014 = Qdrant & Chat |
| 00 | [Product vision](00-product-vision.md) | You need the "why", the users, or the scope |
| 01 | [Research: webXBRL, competitors, MCA tool](01-research-webxbrl-and-mca-tool.md) | Deciding a feature, or checking how the original tool behaves |
| 02 | [Architecture](02-architecture.md) | Touching more than one layer (ui, engine, sidecar) |
| 03 | [Project file `.axbrl`](03-project-file-axbrl.md) | Save/open/autosave/recovery work |
| 04 | [XBRL engine](04-xbrl-engine.md) | Engine work, or porting from `lagacy_js/` |
| 05 | [Validation](05-validation.md) | Rules, calculation checks, MCA tool errors, the coverage diff |
| 06 | [AI auto-tagging](06-ai-auto-tagging.md) | Excel → taxonomy mapping, hybrid search and suggestions |
| 07 | [AI fix agent](07-ai-fix-agent.md) | LLM error-fix workflow (Groq) |
| 08 | [UI/UX](08-ui-ux.md) | Any screen, layout, shortcut or interaction |
| 09 | [IPC & sidecar API](09-ipc-and-sidecar-api.md) | Adding an IPC channel or sidecar endpoint |
| 10 | [Packaging & release](10-packaging-release.md) | Building the installer, PyInstaller, electron-builder |
| 11 | [Security & privacy](11-security-privacy.md) | Keys, financial data, Electron hardening |
| 12 | [Reference data](12-reference-data.md) | The real client files in `data/`, what they teach us, and the tests built on them |
| 13 | [webXBRL parity](13-webxbrl-parity.md) | Picking the next feature: every webXBRL feature, our status, gaps and priority; manual-tagging fixes |
| 14 | [Parity build plan](14-parity-build-plan.md) | The 13 build steps toward webXBRL parity, one chat each, with the context a new chat needs and a prompt template |
| 16 | [XBRL pipeline architecture](16-target-architecture.md) | **Start here for the design**: the planned pipeline stage by stage (has / wrong / add), our pipeline (Ingest → Normalize → Tag → Assure → File), contracts, routes and build order ([ADR-0016](decisions/ADR-0016-canonical-financial-package.md)) |
| — | [decisions/](decisions/) | Why a big choice was made (ADRs; e.g. [ADR-0014](decisions/ADR-0014-qdrant-vector-db-and-inmemory-chat-integration.md) for Qdrant, in-memory chat, & hybrid reranking) |

**Discussion docs (2026-11-17).** Where they disagree with doc 16 or an ADR, the ADR wins.

| Doc | Read it when… |
|---|---|
| [Gap analysis & Ind AS blueprint](13-gap-analysis-and-indas-blueprint.md) | Webtel deconstruction (`[E]` / `[L]` / `[T]` indicators), schema-mapper idea, proposed FastAPI routes |
| [Canonical pipeline & tagging](14-canonical-pipeline-and-tagging-architecture.md) | Canonical-files design: file schemas, partitioned retrieval, table and notes tagging |
| [Master architecture & KB blueprint](15-master-architecture-and-knowledge-base-blueprint.md) | Tour of `ind_as_knowledge_base.json`, the face-vs-notes scoping question, the normalizer prompt |
| [Sidecar workflow](workflow.md) | Proposed sidecar route specs and payloads |
| [Phased roadmap](roadmap.md) | Phase order from the discussion |
| [ui/](ui/) | Webtel webXBRL reference screenshots |

## Glossary
- **MCA:** Ministry of Corporate Affairs (India). **AOC-4 XBRL** is the e-form for filing financial statements in XBRL. **CRA-4** is the cost audit report.
- **Taxonomy:** the dictionary of reportable concepts (elements), plus linkbases. v1 covers **C&I 2016** (Commercial & Industrial, non-Ind AS) and **Ind AS 2017**; **Costing 2019** comes later.
- **ELR:** Extended Link Role, i.e. one statement/note/table (e.g. `[100100] Balance sheet`).
- **Fact:** a value reported for a concept, in a context (entity CIN + period + dimensions), with a unit and decimals.
- **Dimension / axis / member:** qualifies a fact in a table (e.g. Classes of share capital axis → Equity shares member).
- **Instance document:** the XBRL XML file we generate and the MCA tool validates.
- **Authority:** our executable view of one taxonomy plus its business rules (`knowledge_base/<kb>_engine_authority.json` + `<kb>_engine_rules.json`, joined by the engine).
- **Sidecar:** the bundled local Python process (FastAPI) that does the AI work.
- **CY / PY:** current year / previous year.
