#!/usr/bin/env bash
# ==============================================================================
# XBRL Autopilot - Master Taxonomy & Knowledge Base Rebuild Script
# Scans data/, refreshes Knowlege_base/MCA_AUTHORITY.json, wipes chroma_langchain_db/,
# and re-ingests C&I, IND-AS, and Costing taxonomies into Chroma.
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "=================================================================="
echo "⚡ XBRL Autopilot - Rebuilding Knowledge Base & Taxonomies"
echo "Project Directory: $PROJECT_ROOT"
echo "=================================================================="

PYTHON_BIN="$PROJECT_ROOT/.venv/bin/python3"

if [ ! -f "$PYTHON_BIN" ]; then
    echo "Virtual environment not found at $PYTHON_BIN. Using system python3."
    PYTHON_BIN="python3"
fi

"$PYTHON_BIN" -m src.ingestion.rebuild_knowledge_base "$@"
