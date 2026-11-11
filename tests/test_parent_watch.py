"""The sidecar must not outlive the desktop app (orphaned sidecars exhausted memory during E2E runs)."""
import subprocess
import sys
import textwrap
import time

from src.core.parent_watch import _alive, watch_parent


def test_alive_reports_running_and_finished_processes():
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        assert _alive(proc.pid)
    finally:
        proc.kill()
        proc.wait()
    assert not _alive(proc.pid)


def test_watcher_ends_the_process_when_the_parent_is_gone():
    parent = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    child = subprocess.Popen(
        [sys.executable, "-c", textwrap.dedent(f"""
            import time
            from src.core.parent_watch import watch_parent
            watch_parent({parent.pid}, interval=0.1)
            time.sleep(30)
        """)],
    )
    try:
        time.sleep(1.0)
        assert child.poll() is None  # parent still running: child keeps serving
        parent.kill()
        parent.wait()
        child.wait(timeout=10)
        assert child.returncode == 0
    finally:
        for p in (parent, child):
            if p.poll() is None:
                p.kill()


def test_no_pid_means_no_watcher():
    assert watch_parent(None) is None
