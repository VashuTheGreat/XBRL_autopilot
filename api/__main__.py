"""Sidecar entry point: `uv run python -m api` (dev, spawned by Electron) and the PyInstaller exe."""
import uvicorn

from src.app_config import get_app_config


def main() -> None:
    cfg = get_app_config()
    # Loopback only — never expose the sidecar on the network.
    uvicorn.run("api.app:app", host="127.0.0.1", port=cfg.xap_port, log_level="info", access_log=False)


if __name__ == "__main__":
    main()
