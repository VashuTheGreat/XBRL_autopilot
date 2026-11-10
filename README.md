# XBRL Autopilot

An AI-powered Windows desktop tool for preparing MCA AOC-4 XBRL filings. Excel financials are shown next to XBRL, tagging is AI-assisted, and validation is deterministic, with AI-proposed fixes.

- What it is and where everything lives: [`CLAUDE.md`](CLAUDE.md)
- Documentation index: [`docs/README.md`](docs/README.md)
- Progress: [`docs/STATUS.md`](docs/STATUS.md)

```bash
uv sync && pnpm install
pnpm dev      # desktop app (starts the Python sidecar automatically)
```
