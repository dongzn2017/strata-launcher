"""Own one Strata tree. File IPC never targets an existing service or a guessed PID."""
import argparse
import ctypes
from ctypes import wintypes
import hashlib
import json
import msvcrt
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time
import urllib.request
import uuid

import psutil

_kernel = ctypes.WinDLL("kernel32", use_last_error=True)
_kernel.ReplaceFileW.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.LPCWSTR,
                                wintypes.DWORD, wintypes.LPVOID, wintypes.LPVOID)
_kernel.ReplaceFileW.restype = wintypes.BOOL


def read(file):
    return json.loads(Path(file).read_text(encoding="utf-8-sig"))


def atomic_replace(source, target):
    # MoveFileEx (os.replace) can deny an open destination even with share-delete.
    if Path(target).exists():
        if _kernel.ReplaceFileW(str(target), str(source), None, 0, None, None):
            return
        error = ctypes.get_last_error()
        if error not in (2, 3):
            raise ctypes.WinError(error)
    os.replace(source, target)


def write(file, data):
    temp = Path(str(file) + "." + uuid.uuid4().hex + ".tmp")
    try:
        temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        delays = (0.02, 0.05, 0.1, 0.2)
        for attempt in range(len(delays) + 1):
            try:
                atomic_replace(temp, file)
                return
            except OSError as error:
                # Only retry the same atomic file replace, never a model or API request.
                if getattr(error, "winerror", None) not in (5, 32, 33) or attempt == len(delays):
                    raise
                time.sleep(delays[attempt])
    finally:
        try:
            temp.unlink(missing_ok=True)
        except OSError:
            pass


def append_log(file, message):
    try:
        with open(file, "a", encoding="utf-8") as log:
            log.write(message + "\n")
    except OSError:
        pass


def startup_explanation(config, inherited, options=None):
    text = read(Path(__file__).with_name("ui.zh-CN.json"))["startupExplanation"]
    options = options or {}
    configured = config.get("env") or {}
    specs = (
        ("STRATA_ROUTE_PRIOR", "routePrior", {"0": "routeOff", "1.5": "routeOn"}, "routeDefault", "routeOther"),
        ("STRATA_KVA", "kva", {"0": "kvaOff", "1": "kvaOn"}, "kvaDefault", "kvaOther"),
        ("STRATA_VRAM_FREE", "vramFree", {"device": "vramDevice"}, "vramDefault", "vramOther"),
    )
    lines = ["[launcher settings] " + text["heading"]]
    for key, option, meanings, default, other in specs:
        if key in configured:
            value = str(configured[key])
            origin = "panel" if options.get(option, "default") != "default" else "profile"
        elif key in inherited:
            value, origin = str(inherited[key]), "environment"
        else:
            value, origin = None, "default"
        meaning = default if value is None else meanings.get(value, other)
        # Only these three settings are logged; bound and escape inherited values.
        shown = text["unset"] if value is None else json.dumps(value[:80], ensure_ascii=True)
        lines.append(f"[launcher settings] {key}={shown} [{text[origin]}]")
        lines.append("  " + text[meaning])
    lines.append("[launcher settings] " + text["footer"])
    return "\n".join(lines)


def log_startup_explanation(run, inherited):
    try:
        explanation = startup_explanation(read(run["config"]), inherited, run.get("engineOptions"))
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        append_log(run["log"], "[launcher settings] Startup explanation unavailable; launch continues unchanged.")
    else:
        append_log(run["log"], explanation)


class StatusPublisher:
    """Telemetry failure must not unwind the model's ownership guard."""

    def __init__(self, file, log, writer=None, clock=None):
        self.file, self.log = file, log
        self.writer, self.clock = writer or write, clock or time.monotonic
        self.last_warning = float("-inf")
        self.failures = 0

    def publish(self, data):
        try:
            self.writer(self.file, {**data, "updatedAtUnix": time.time()})
        except OSError as error:
            self.failures += 1
            now = self.clock()
            if now - self.last_warning >= 60:
                self.last_warning = now
                append_log(self.log, "[launcher monitor] status save failed; model kept running: " + str(error))
            return False
        if self.failures:
            append_log(self.log, f"[launcher monitor] status publishing recovered after {self.failures} failed update(s)")
            self.failures = 0
        return True


def checked_run(file):
    file = Path(file).resolve()
    runs = Path(__file__).resolve().parents[2] / "runtime" / "strata-launcher" / "runs"
    if not file.is_relative_to(runs) or file.name != "run.json":
        raise ValueError("Not a panel run")
    run = read(file)
    if Path(run["dir"]).resolve() != file.parent or run["id"] != file.parent.name:
        raise ValueError("Run identity mismatch")
    if Path(run["config"]).resolve() != file.parent / "model.json":
        raise ValueError("Run model configuration is outside its expected path")
    for name, key in [("model.json", "configHash"), ("model.shared-settings.json", "sharedHash")]:
        if hashlib.sha256((file.parent / name).read_bytes()).hexdigest() != run[key]:
            raise ValueError("Run configuration changed: " + name)
    if not 1024 <= run["settings"]["port"] <= 65535:
        raise ValueError("Invalid local port")
    return run


def preflight(run):
    if psutil.virtual_memory().available < run["minimumFreeGiB"] * 2**30:
        raise RuntimeError(f"Admission requires {run['minimumFreeGiB']:g} GiB free system RAM; no service was stopped")
    for proc in psutil.process_iter(["name"]):
        if (proc.info["name"] or "").lower() in ("strata.exe", "strata-vision.exe", "strata-dsv41.exe"):
            raise RuntimeError("An existing Strata engine is running and is not owned by this launcher")
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", run["settings"]["port"]))


def get(port, endpoint):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(f"http://127.0.0.1:{port}/{endpoint}", headers={"Accept": "application/json"})
    with opener.open(request, timeout=0.7) as response:
        return json.load(response)


def startup_memory(directory):
    try:
        with open(Path(directory) / "engine.log", "rb") as log:
            text = log.read(128 * 1024).decode("utf-8", errors="replace")
    except OSError:
        return {}
    result = {}
    kv = re.search(r"KV streaming: (\d+) of (\d+) cells per QSA layer in VRAM", text)
    if kv:
        result.update(kvResidentTokens=int(kv[1]), kvContextTokens=int(kv[2]))
    cache = re.search(r"expert cache (\d+) slots, ([\d.]+) GiB of VRAM", text)
    if cache:
        result.update(expertSlots=int(cache[1]), expertCacheGiB=float(cache[2]))
    free = re.search(r"NVML: (\d+) MiB now; CUDA's figure for this process alone: (\d+) MiB", text)
    if free:
        result.update(nvmlFreeMiB=int(free[1]), cudaFreeMiB=int(free[2]))
    loaded = re.search(r"(\d+) MiB of VRAM free with everything loaded", text)
    if loaded:
        result["loadedFreeMiB"] = int(loaded[1])
    reserve = re.search(r"(\d+) MiB reserved \(\+(\d+) MiB for the draft head, \+(\d+) MiB", text)
    if reserve:
        result.update(userReserveMiB=int(reserve[1]), draftReserveMiB=int(reserve[2]), laterReserveMiB=int(reserve[3]))
    drafter = re.search(r"DFlash2 drafter on \((.+?), graphs captured.*?windows up to (\d+) tokens", text)
    if drafter:
        confidence = re.search(r"--draft-conf(?:=|\s+)([\d.]+)", text)
        result["drafting"] = {"mode": "dflash2", "file": drafter[1], "window": int(drafter[2]),
                              "confidence": float(confidence[1]) if confidence else None}
    return result


def owns_listener(child, port):
    try:
        owner = psutil.Process(child.pid)
        if not owner.is_running():
            return False
        for proc in [owner, *owner.children(recursive=True)]:
            for conn in proc.net_connections(kind="tcp"):
                if conn.status == psutil.CONN_LISTEN and conn.laddr.ip == "127.0.0.1" and conn.laddr.port == port:
                    return True
    except (psutil.Error, OSError):
        return False
    return False


def flush_learning(run, child):
    """One bounded QUIT/save opportunity, only on an explicit stop of our own listener."""
    if not run.get("learning", {}).get("enabled"):
        return "disabled"
    port = run["settings"]["port"]
    if not owns_listener(child, port):
        return "listener not owned; no unload sent"
    try:
        health = get(port, "health")
        if (health.get("service") != "strata" or health.get("model") != run["model"] or
                not health.get("loaded") or health.get("api_key")):
            return "identity not confirmed; no unload sent"
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/unload", data=b"{}",
                                         headers={"Content-Type": "application/json"}, method="POST")
        # Control refuses busy/queued requests and sends QUIT only between requests.
        with opener.open(request, timeout=30) as response:
            response.read(4096)
        return "unload completed; check engine log for profile save confirmation"
    except (OSError, ValueError) as error:
        return "unload not completed; unsaved learning may be lost: " + str(error)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True)
    parser.add_argument("--parent", type=int, required=True)
    args = parser.parse_args()
    run = checked_run(args.run)
    directory = Path(run["dir"])
    status = directory / "status.json"
    publisher = StatusPublisher(status, run["log"])
    parent = psutil.Process(args.parent)
    child = None
    token = uuid.uuid4().hex
    lock = open(directory.parents[1] / "model.lock", "a+b")
    lock.seek(0)
    lock.write(b"1")
    lock.flush()
    lock.seek(0)
    try:
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        preflight(run)
        sys.path.insert(0, run["source"])
        from serve import winjob
        env = {**os.environ, "PYTHONUTF8": "1", "PYTHONNOUSERSITE": "1",
               "STRATA_COMPONENTS_DIR": str(Path(run["source"]).parents[1]),
               "STRATA_INSTALL_DIR": str(Path(run["source"]).parents[2]),
               "STRATA_NO_ACQUIRE": "1", "STRATA_PYTHON": run["python"],
               "STRATA_PROFILE_DIR": str(directory / "operator-profiles"),
               "STRATA_RUNTIME_DIR": str(directory / "control-runtime"), "STRATA_KEEP_LEFTOVERS": "1"}
        env.pop("PYTHONHOME", None)
        env.pop("PYTHONPATH", None)
        log_startup_explanation(run, env)
        with open(run["log"], "ab", buffering=0) as log:
            child = subprocess.Popen([run["python"], "-u", str(Path(run["source"]) / "strata.py"),
                                      "serve", "--profile", run["config"], "--host", "127.0.0.1",
                                      "--port", str(run["settings"]["port"])], cwd=run["source"],
                                     env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            if not winjob.contain(child):
                child.terminate()
                child.wait(timeout=10)
                raise RuntimeError("Cannot establish Windows ownership guard")
            write(directory / "owner.json", {"runId": run["id"], "token": token, "runnerPid": os.getpid(), "childPid": child.pid})
            memory = {}
            while child.poll() is None:
                stop = directory / "stop.json"
                explicit_stop = stop.exists() and read(stop) == {"runId": run["id"], "token": token}
                if not parent.is_running() or explicit_stop:
                    flush = flush_learning(run, child) if explicit_stop else "parent exited; no unload sent"
                    append_log(run["log"], "[launcher learning] " + flush)
                    winjob.terminate()
                    child.wait(timeout=15)
                    publisher.publish({"runId": run["id"], "state": "stopped", "exitCode": child.returncode,
                                       "learningFlush": flush, "startupMemory": memory})
                    return 0
                data = {"runId": run["id"], "state": "loading", "model": run["model"]}
                try:
                    health = get(run["settings"]["port"], "health")
                    if health.get("model") != run["model"]:
                        raise RuntimeError("Endpoint identity mismatch")
                    data["health"] = health
                    data["metrics"] = get(run["settings"]["port"], "metrics")
                    data["state"] = data["metrics"].get("live", {}).get("state", "ready") if health.get("loaded") else "loading"
                    if health.get("loaded") and not memory:
                        memory = startup_memory(directory)
                    data["startupMemory"] = memory
                except (OSError, ValueError):
                    pass
                publisher.publish(data)
                time.sleep(2)
            publisher.publish({"runId": run["id"], "state": "exited", "exitCode": child.returncode})
            return child.returncode
    except Exception as error:
        append_log(run["log"], "[launcher] " + str(error))
        publisher.publish({"runId": run["id"], "state": "error", "error": str(error)})
        return 2
    finally:
        if child and child.poll() is None:
            winjob.terminate()
            child.wait(timeout=15)
        lock.close()


if __name__ == "__main__":
    raise SystemExit(main())
