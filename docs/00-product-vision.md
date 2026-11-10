# 00 · Product vision

## One-liner
**XBRL Autopilot** is a Windows desktop tool that turns a company's Excel financial statements into an MCA-valid XBRL instance. AI does the tagging, a deterministic engine validates, and AI-proposed fixes clear the errors. The accountant reviews and approves each step.

## Users
- **Primary:** practising CAs and their article assistants, who prepare AOC-4 XBRL for many client companies each filing season (Sept–Nov).
- **Secondary:** in-house accounts teams of companies that must file in XBRL.
- **Environment:** Windows 10/11 office PCs. The apps they already know are Excel, Tally and webXBRL. Internet is often unreliable, so the app must work offline. Only AI features need the network.

## The job today (webXBRL-style, manual)
1. Create the company master (CIN, directors, auditor).
2. Import the Excel balance sheet and P&L.
3. Hand-tag every line: select the Excel cell, then double-click a taxonomy element.
4. Tag notes, text blocks and dimensional tables (fixed assets, share capital, related parties, …).
5. Generate the XML.
6. Validate with the MCA tool → get dozens of errors → hunt down each one by hand → regenerate. This loops.
7. Pre-scrutiny, convert to PDF, attach to AOC-4 on the MCA V3 portal.

Steps 3 and 6 take most of the hours. **We automate those two.**

## What we do differently
| Pain | Our answer |
|---|---|
| Manual tagging of hundreds of lines | AI auto-tagging with confidence scores, plus **mapping memory** (approved mappings reused next year and across clients) |
| Can't see what is linked to what | Split editor: Excel on the left, XBRL/XML on the right, with **bidirectional highlighting** |
| Cryptic MCA validator errors | Errors explained in plain language, located down to the exact cell, and fixed with **one-click deterministic fixes** or **AI-proposed patches** |
| Tagging-quality mistakes the validator never catches (residual "Other" tags, wrong sign) | AI tagging-quality review |
| Losing work / starting over each year | `.axbrl` project files, autosave and recovery, carry-forward to next year |

## Scope
- **v1 (MVP):** C&I 2016 taxonomy, AOC-4 XBRL standalone (consolidated if cheap). The full loop: Excel → tag → validate → fix → XML → save/reopen. MCA Validation Tool v5.1 used as the external final check.
- **v2:** Ind AS 2017, consolidated; Costing 2019 (CRA-4); company/director masters; PDF preview parity.
- **Later:** licensed Groq proxy server, auto-update, CIN prefill from MCA, Tally import, multi-user office sharing.

## Non-goals (for now)
- macOS/Linux builds. Electron makes them possible later, but they're untested.
- Filing to the MCA portal on the user's behalf. The user still uploads on MCA V3.
- A hosted SaaS. Everything runs on the user's machine.

## Success criteria for v1
- `data/sample_financials.xlsx` → ≥ 80 % of lines auto-tagged correctly before review.
- The generated instance passes MCA Validation Tool v5.1 with zero errors after the AI-assisted fix loop.
- A filing can be closed and reopened with nothing lost.
- It installs on a clean Windows PC with no Python or Node.
