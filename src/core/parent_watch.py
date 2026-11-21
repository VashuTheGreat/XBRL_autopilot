"""Exit when the desktop app that launched the sidecar is gone.

Electron kills the sidecar's process tree on a normal quit, but a crash or a force-kill (Task Manager, `taskkill /F`)
skips that, and every orphaned sidecar kept ~130 MB until the machine ran short of memory. Electron passes its PID
in XAP_PARENT_PID; a daemon thread polls it and ends this process when it no longer runs.
"""
from __future__ import annotations

import os
import sys
import threading
import time


def _alive(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes

        SYNCHRONIZE = 0x00100000
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            WAIT_TIMEOUT = 0x102
            return kernel32.WaitForSingleObject(handle, 0) == WAIT_TIMEOUT
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def watch_parent(pid: int | None, interval: float = 2.0) -> threading.Thread | None:
    """Starts the watcher; does nothing without a PID (`make dev`)."""
    if not pid:
        return None

    def run() -> None:
        while _alive(pid):
            time.sleep(interval)
        os._exit(0)  # the app is gone: nothing to flush, nobody to answer

    thread = threading.Thread(target=run, name="parent-watch", daemon=True)
    thread.start()
    return thread
