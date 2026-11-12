"""Sidecar entry point: `uv run python -m api` (dev, spawned by Electron) and the PyInstaller exe."""
import os
import sys

# In frozen PyInstaller mode, source code is not available on disk; disable logfire's pydantic plugin AST inspect
if getattr(sys, "frozen", False):
    os.environ["PYDANTIC_DISABLE_PLUGINS"] = "1"

import uvicorn

from api.app import app
from src.app_config import get_app_config
from src.core.parent_watch import watch_parent


def main() -> None:
    cfg = get_app_config()
    # exit with the desktop app even when it crashes or is force-killed (no orphaned sidecars)
    parent = os.environ.get("XAP_PARENT_PID", "")
    watch_parent(int(parent) if parent.isdigit() else None)
    # Loopback only — never expose the sidecar on the network.
    uvicorn.run(app, host="127.0.0.1", port=cfg.xap_port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
