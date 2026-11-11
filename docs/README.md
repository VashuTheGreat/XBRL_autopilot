# Docs index

Read the doc that matches the task. Keep docs short, factual and current. When code and docs disagree, fix the docs in the same change.

| # | Doc | Read it when… |
|---|---|---|
| — | [STATUS.md](STATUS.md) | Starting any session: what's done, in progress and next |
| 00 | [Product vision](00-product-vision.md) | You need the "why", the users, or the scope |
| 01 | [Research: webXBRL, competitors, MCA tool](01-research-webxbrl-and-mca-tool.md) | Deciding a feature, or checking how the original tool behaves |
| 02 | [Architecture](02-architecture.md) | Touching more than one layer (ui, engine, sidecar) |
| 03 | [Project file `.axbrl`](03-project-file-axbrl.md) | Save/open/autosave/recovery work |
| 04 | [XBRL engine](04-xbrl-engine.md) | Engine work, or porting from `lagacy_js/` |
| 05 | [Validation](05-validation.md) | Rules, calculation checks, MCA tool errors, the coverage diff |
| 06 | [AI auto-tagging](06-ai-auto-tagging.md) | Excel → taxonomy mapping and suggestions |
| 07 | [AI fix agent](07-ai-fix-agent.md) | LLM error-fix workflow (Groq) |
| 08 | [UI/UX](08-ui-ux.md) | Any screen, layout, shortcut or interaction |
| 09 | [IPC & sidecar API](09-ipc-and-sidecar-api.md) | Adding an IPC channel or sidecar endpoint |
| 10 | [Packaging & release](10-packaging-release.md) | Building the installer, PyInstaller, electron-builder |
| 11 | [Security & privacy](11-security-privacy.md) | Keys, financial data, Electron hardening |
| 12 | [Reference data](12-reference-data.md) | The real client files in `data/`, what they teach us, and the tests built on them |
| — | [decisions/](decisions/) | Why a big choice was made (ADRs) |

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
