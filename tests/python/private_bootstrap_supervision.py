"""Test-only supervision of the exact Node child, never process-name discovery."""
import ctypes
import json
import os
from pathlib import Path
import select
import signal
import sys
import time


def invalid():
    raise RuntimeError("TEST_NODE_OWNERSHIP_INVALID")


def atomic(filename, value):
    temporary = filename.with_name(filename.name + ".writing")
    temporary.write_text(json.dumps(value), encoding="utf-8")
    os.replace(temporary, filename)


def install_tracking(node, record_name, nonce, fault=""):
    """Dedicated test child only; forward original product Popen args unchanged."""
    import subprocess
    original = subprocess.Popen
    record = Path(record_name)
    probe = record.with_name(record.name + ".created")
    ack = record.with_name(record.name + ".ack")

    def track(process, arguments, keywords):
        # Preserve Popen's class interface: asyncio.windows_utils subclasses it.
        # The launcher's audit hook independently restricts the one static command.
        command = arguments[0] if arguments else keywords.get("args")
        if not isinstance(command, list) or command[0] != node:
            process.kill()
            process.wait(timeout=2)
            invalid()
        identity = {"nonce": nonce, "outerPid": os.getpid(), "nodePid": process.pid, "state": "created"}
        if os.name != "nt":
            identity.update({"pgid": os.getpgid(process.pid), "sid": os.getsid(process.pid)})
            if identity["pgid"] != process.pid or identity["sid"] != process.pid:
                process.kill(); process.wait(timeout=2); invalid()
        atomic(probe, identity)
        if fault == "before-register":
            # No caller receives Popen, so product cannot deliver any Node stdin.
            while True: time.sleep(0.01)
        atomic(record, identity)
        end = time.monotonic() + 8
        while not ack.is_file():
            if time.monotonic() >= end or process.poll() is not None:
                process.kill(); process.wait(timeout=2); invalid()
            time.sleep(0.01)
        if ack.read_text(encoding="utf-8") != nonce:
            process.kill(); process.wait(timeout=2); invalid()
        if fault == "after-register":
            while True: time.sleep(0.01)
        poll, wait = process.poll, process.wait
        def tracked_poll():
            result = poll()
            if result is not None:
                atomic(record, {**identity, "state": "exited", "exitCode": result})
            return result
        def tracked_wait(*args, **kwargs):
            result = wait(*args, **kwargs)
            atomic(record, {**identity, "state": "exited", "exitCode": result})
            return result
        process.poll, process.wait = tracked_poll, tracked_wait
        return process
    class TrackedPopen(original):
        def __init__(self, *arguments, **keywords):
            super().__init__(*arguments, **keywords)
            track(self, arguments, keywords)
    subprocess.Popen = TrackedPopen


class Witness:
    """Kernel exit observation is distinct from outer.poll(). No same-name scans."""
    def __init__(self, identity, nonce, outer_pid):
        if (not isinstance(identity, dict) or identity.get("nonce") != nonce
                or identity.get("outerPid") != outer_pid or type(identity.get("nodePid")) is not int
                or identity["nodePid"] <= 0):
            invalid()
        self.pid = identity["nodePid"]
        self.handle, self.queue, self.fd = None, None, None
        if os.name == "nt":
            from ctypes import wintypes as w
            self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            self.kernel.OpenProcess.argtypes = (w.DWORD, w.BOOL, w.DWORD)
            self.kernel.OpenProcess.restype = w.HANDLE
            self.kernel.WaitForSingleObject.argtypes = (w.HANDLE, w.DWORD)
            self.kernel.CloseHandle.argtypes = (w.HANDLE,)
            self.handle = self.kernel.OpenProcess(0x100000, False, self.pid)
            if not self.handle: invalid()
        else:
            if identity.get("pgid") != self.pid or identity.get("sid") != self.pid:
                invalid()
            if os.getpgid(self.pid) != self.pid or os.getsid(self.pid) != self.pid:
                invalid()
            if hasattr(os, "pidfd_open"):
                self.fd = os.pidfd_open(self.pid)
            elif hasattr(select, "kqueue"):
                self.queue = select.kqueue()
                event = select.kevent(self.pid, filter=select.KQ_FILTER_PROC,
                                      flags=select.KQ_EV_ADD | select.KQ_EV_ENABLE,
                                      fflags=select.KQ_NOTE_EXIT)
                self.queue.control([event], 0, 0)
            else:
                invalid()  # No unsafe PID-only wait fallback.
        self.dead = False

    def exited(self):
        if self.dead: return True
        if self.handle:
            self.dead = self.kernel.WaitForSingleObject(self.handle, 0) == 0
        elif self.fd is not None:
            self.dead = bool(select.select([self.fd], [], [], 0)[0])
        else:
            events = self.queue.control(None, 1, 0)
            self.dead = any(event.ident == self.pid and event.fflags & select.KQ_NOTE_EXIT for event in events)
        return self.dead

    def stop_and_wait(self, deadline, terminate=True):
        if not self.exited() and terminate and os.name != "nt":
            # The exact separate group was observed while gated and alive.
            # Kernel exit watcher avoids treating an already-exited PID as live.
            if os.getpgid(self.pid) != self.pid or os.getsid(self.pid) != self.pid: invalid()
            try: os.killpg(self.pid, signal.SIGKILL)
            except ProcessLookupError: pass
        while not self.exited():
            if time.monotonic() >= deadline: invalid()
            time.sleep(0.01)

    def close(self):
        if self.handle: self.kernel.CloseHandle(self.handle)
        if self.fd is not None: os.close(self.fd)
        if self.queue: self.queue.close()


class Registration:
    def __init__(self, filename, nonce, outer_pid):
        self.filename, self.nonce, self.outer_pid = Path(filename), nonce, outer_pid
        self.witness = None

    def poll(self):
        if self.witness is None and self.filename.is_file():
            if self.filename.stat().st_size > 4096: invalid()
            identity = json.loads(self.filename.read_text(encoding="utf-8"))
            self.witness = Witness(identity, self.nonce, self.outer_pid)
            # Return Popen to the product only after parent establishes observation.
            self.filename.with_name(self.filename.name + ".ack").write_text(self.nonce, encoding="utf-8")

    def cleanup(self, deadline):
        if self.witness is None: self.poll()
        if self.witness:
            try: self.witness.stop_and_wait(deadline)
            finally: self.witness.close()
