"""Offline guard tests; no Strata/Pi process or inference is started."""
import importlib.util
import io
import ctypes
from ctypes import wintypes
from pathlib import Path
from types import ModuleType, SimpleNamespace
import tempfile
import sys
import unittest
from unittest.mock import Mock, patch
import uuid

spec = importlib.util.spec_from_file_location("panel_runner", Path(__file__).with_name("runner.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Guards(unittest.TestCase):
    def scratch(self):
        temp = tempfile.TemporaryDirectory(prefix="strata-launcher-test-")
        self.addCleanup(temp.cleanup)
        return Path(temp.name).resolve()

    @staticmethod
    def denied():
        error = PermissionError("injected Windows sharing conflict")
        error.winerror = 5
        return error

    def open_windows_reader(self, file, share_delete):
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                      wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = (wintypes.HANDLE,)
        handle = kernel.CreateFileW(str(file), 0x80000000, 3 | (4 if share_delete else 0), None, 3, 0, None)
        self.assertNotEqual(handle, ctypes.c_void_p(-1).value, ctypes.get_last_error())
        return kernel, handle

    def test_foreign_engine_is_never_adopted(self):
        for name in ("strata.exe", "strata-vision.exe", "strata-dsv41.exe"):
            with patch.object(runner.psutil, "virtual_memory", return_value=SimpleNamespace(available=60 * 2**30)), \
                 patch.object(runner.psutil, "process_iter", return_value=[SimpleNamespace(info={"name": name})]):
                with self.assertRaisesRegex(RuntimeError, "not owned"):
                    runner.preflight({"minimumFreeGiB": 45})

    def test_ram_admission_is_not_silently_reduced(self):
        with patch.object(runner.psutil, "virtual_memory", return_value=SimpleNamespace(available=44 * 2**30)):
            with self.assertRaisesRegex(RuntimeError, "45 GiB"):
                runner.preflight({"minimumFreeGiB": 45})

    def test_port_occupied_is_not_cleared(self):
        with patch.object(runner.psutil, "virtual_memory", return_value=SimpleNamespace(available=60 * 2**30)), \
             patch.object(runner.psutil, "process_iter", return_value=[]), \
             patch.object(runner.socket, "socket") as sock:
            sock.return_value.__enter__.return_value.bind.side_effect = OSError("occupied")
            with self.assertRaisesRegex(OSError, "occupied"):
                runner.preflight({"minimumFreeGiB": 45, "settings": {"port": 8080}})

    def test_canonical_profile_cannot_be_used_as_an_owned_run(self):
        with self.assertRaisesRegex(ValueError, "Not a panel run"):
            runner.checked_run(Path(__file__).resolve().parents[2] / "conf/launcher.example.json")

    def test_monitor_only_requests_local_json(self):
        with patch.object(runner.urllib.request, "build_opener") as build:
            build.return_value.open.return_value = io.StringIO('{"live":{"state":"idle"}}')
            self.assertEqual(runner.get(8080, "metrics")["live"]["state"], "idle")
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, "http://127.0.0.1:8080/metrics")
            self.assertEqual(request.get_header("Accept"), "application/json")
            self.assertEqual(request.get_method(), "GET")

    def test_startup_memory_uses_actual_log_not_requested_kv(self):
        directory = self.scratch()
        self.assertEqual(runner.startup_memory(directory), {})
        (directory / "engine.log").write_text(
            "strata generate: KV streaming: 20480 of 131072 cells per QSA layer in VRAM\n"
            "strata generate: expert cache 1552 slots, 3.27 GiB of VRAM; policy is\n", encoding="utf-8")
        self.assertEqual(runner.startup_memory(directory), {
            "kvResidentTokens": 20480, "kvContextTokens": 131072, "expertSlots": 1552, "expertCacheGiB": 3.27})

    def test_startup_memory_separates_device_cuda_and_zero_user_reserve(self):
        directory = self.scratch()
        (directory / "engine.log").write_text(
            "STRATA_VRAM_FREE=device: free VRAM (NVML: 5131 MiB now; CUDA's figure for this process alone: 4370 MiB)\n"
            "expert cache auto: 4.27 GiB free, 0 MiB reserved (+218 MiB for the draft head, +256 MiB for what is allocated after the cache)\n"
            "strata serve: 0 MiB of VRAM free with everything loaded - LOW\n", encoding="utf-8")
        self.assertEqual(runner.startup_memory(directory), {
            "nvmlFreeMiB": 5131, "cudaFreeMiB": 4370, "userReserveMiB": 0,
            "draftReserveMiB": 218, "laterReserveMiB": 256, "loadedFreeMiB": 0})

    def test_startup_explanation_reports_selected_values_and_risks_without_mutating_settings(self):
        text = runner.read(Path(runner.__file__).with_name("ui.zh-CN.json"))["startupExplanation"]
        env = {"STRATA_ROUTE_PRIOR": "1.5", "STRATA_KVA": "0", "STRATA_VRAM_FREE": "other", "API_KEY": "never-log-me"}
        config = {"env": {"STRATA_ROUTE_PRIOR": "0", "STRATA_KVA": "1", "STRATA_VRAM_FREE": "device"}}
        options = {"routePrior": "off", "kva": "on", "vramFree": "device"}
        before = runner.json.dumps([config, env, options], sort_keys=True)
        output = runner.startup_explanation(config, env, options)
        for variable, value in config["env"].items():
            self.assertIn(f'{variable}="{value}" [{text["panel"]}]', output)
        for key in ("heading", "routeOff", "kvaOn", "vramDevice", "footer"):
            self.assertIn(text[key], output)
        self.assertNotIn("never-log-me", output)
        self.assertEqual(runner.json.dumps([config, env, options], sort_keys=True), before)

    def test_startup_explanation_distinguishes_profile_environment_default_and_legacy_manifests(self):
        text = runner.read(Path(runner.__file__).with_name("ui.zh-CN.json"))["startupExplanation"]
        output = runner.startup_explanation({"env": {"STRATA_ROUTE_PRIOR": "1.5"}}, {"STRATA_KVA": "0"})
        self.assertIn(f'STRATA_ROUTE_PRIOR="1.5" [{text["profile"]}]', output)
        self.assertIn(f'STRATA_KVA="0" [{text["environment"]}]', output)
        self.assertIn(f'STRATA_VRAM_FREE={text["unset"]} [{text["default"]}]', output)
        for key in ("routeOn", "kvaOff", "vramDefault"):
            self.assertIn(text[key], output)
        automatic = runner.startup_explanation({}, {})
        self.assertIn(text["routeDefault"], automatic)
        self.assertIn(text["kvaDefault"], automatic)
        self.assertNotIn(text["panel"], automatic)

    def test_startup_explanation_escapes_unknown_values_and_never_dumps_the_environment(self):
        text = runner.read(Path(runner.__file__).with_name("ui.zh-CN.json"))["startupExplanation"]
        output = runner.startup_explanation({}, {
            "STRATA_ROUTE_PRIOR": "bad\nforged-entry", "STRATA_KVA": "x" * 200,
            "STRATA_VRAM_FREE": "cuda", "PRIVATE_TOKEN": "do-not-print-this",
        })
        self.assertIn("bad\\nforged-entry", output)
        self.assertNotIn("bad\nforged-entry", output)
        self.assertNotIn("x" * 81, output)
        self.assertNotIn("PRIVATE_TOKEN", output)
        self.assertNotIn("do-not-print-this", output)
        for key in ("routeOther", "kvaOther", "vramOther"):
            self.assertIn(text[key], output)

    def test_startup_explanation_is_utf8_nonfatal_and_does_not_send_requests_or_start_processes(self):
        directory = self.scratch()
        config, log = directory / "model.json", directory / "console.log"
        runner.write(config, {"env": {"STRATA_KVA": "1"}})
        run = {"config": str(config), "log": str(log)}
        with patch.object(runner.subprocess, "Popen") as start, patch.object(runner, "get") as get:
            runner.log_startup_explanation(run, {})
            start.assert_not_called(); get.assert_not_called()
        output = log.read_text(encoding="utf-8")
        text = runner.read(Path(runner.__file__).with_name("ui.zh-CN.json"))["startupExplanation"]
        self.assertIn(text["kvaOn"], output)
        with patch.object(runner, "startup_explanation", side_effect=ValueError("bad explanation data")):
            runner.log_startup_explanation(run, {})
        self.assertIn("launch continues unchanged", log.read_text(encoding="utf-8"))
        with patch.object(runner, "startup_explanation", side_effect=OSError("unreadable locale")):
            runner.log_startup_explanation(run, {})
        with patch.object(runner, "startup_explanation", side_effect=AttributeError("unsupported explanation data")):
            runner.log_startup_explanation(run, {})

    def test_learning_flush_never_posts_for_disabled_foreign_or_mismatched_service(self):
        run = {"learning": {"enabled": True}, "settings": {"port": 8080}, "model": "owned-run"}
        with patch.object(runner, "owns_listener", return_value=False), \
             patch.object(runner.urllib.request, "build_opener") as build:
            self.assertIn("listener not owned", runner.flush_learning(run, Mock()))
            build.assert_not_called()
        with patch.object(runner, "owns_listener") as owns, \
             patch.object(runner.urllib.request, "build_opener") as build:
            self.assertEqual(runner.flush_learning({}, Mock()), "disabled")
            owns.assert_not_called(); build.assert_not_called()
        for health in [{"service": "strata", "loaded": True, "model": "foreign"},
                       {"service": "strata", "loaded": False, "model": "owned-run"},
                       {"service": "strata", "loaded": True, "model": "owned-run", "api_key": True}]:
            with patch.object(runner, "owns_listener", return_value=True), \
                 patch.object(runner, "get", return_value=health), \
                 patch.object(runner.urllib.request, "build_opener") as build:
                self.assertIn("identity not confirmed", runner.flush_learning(run, Mock()))
                build.assert_not_called()

    def test_learning_flush_is_one_bounded_owned_unload_not_an_inference_or_retry(self):
        run = {"learning": {"enabled": True}, "settings": {"port": 8080}, "model": "owned-run"}
        health = {"service": "strata", "loaded": True, "model": "owned-run", "api_key": False}
        for fail in (False, True):
            with patch.object(runner, "owns_listener", return_value=True), \
                 patch.object(runner, "get", return_value=health), \
                 patch.object(runner.urllib.request, "build_opener") as build:
                if fail:
                    build.return_value.open.side_effect = OSError("busy/timeout fixture")
                else:
                    build.return_value.open.return_value = io.BytesIO(b'{"status":"unloaded"}')
                result = runner.flush_learning(run, Mock())
                build.return_value.open.assert_called_once()
                request = build.return_value.open.call_args.args[0]
                self.assertEqual(request.full_url, "http://127.0.0.1:8080/v1/unload")
                self.assertEqual(request.get_method(), "POST")
                self.assertEqual(request.data, b"{}")
                self.assertEqual(build.return_value.open.call_args.kwargs["timeout"], 30)
                self.assertIn("not completed" if fail else "unload completed", result)

    def test_owned_listener_requires_loopback_port_on_the_actual_process_tree(self):
        owner, child = Mock(), SimpleNamespace(pid=1234)
        owner.children.return_value = []
        owner.is_running.return_value = True
        with patch.object(runner.psutil, "Process", return_value=owner):
            for ip, port, expected in [("127.0.0.1", 8080, True), ("0.0.0.0", 8080, False), ("127.0.0.1", 8081, False)]:
                owner.net_connections.return_value = [SimpleNamespace(status=runner.psutil.CONN_LISTEN,
                                                                      laddr=SimpleNamespace(ip=ip, port=port))]
                self.assertEqual(runner.owns_listener(child, 8080), expected)
            owner.net_connections.side_effect = runner.psutil.AccessDenied()
            self.assertFalse(runner.owns_listener(child, 8080))

    def test_atomic_replace_retries_only_the_same_temporary_file(self):
        directory = self.scratch()
        target = directory / "status.json"
        original_replace = runner.atomic_replace
        attempts = []

        def busy_once(source, dest):
            attempts.append((source, dest))
            if len(attempts) == 1:
                raise self.denied()
            original_replace(source, dest)

        with patch.object(runner, "atomic_replace", side_effect=busy_once), patch.object(runner.time, "sleep") as sleep:
            runner.write(target, {"state": "idle"})
        self.assertEqual(runner.read(target), {"state": "idle"})
        self.assertEqual(len(attempts), 2)
        self.assertEqual(attempts[0], attempts[1])
        sleep.assert_called_once_with(0.02)
        self.assertEqual(list(directory.glob("*.tmp")), [])

    def test_failed_atomic_replace_is_bounded_and_cleans_its_own_temp(self):
        directory = self.scratch()
        target = directory / "status.json"
        runner.write(target, {"state": "old"})
        with patch.object(runner, "atomic_replace", side_effect=self.denied()) as replace, \
             patch.object(runner.time, "sleep") as sleep:
            with self.assertRaises(PermissionError):
                runner.write(target, {"state": "new"})
        self.assertEqual(replace.call_count, 5)
        self.assertEqual(sleep.call_count, 4)
        self.assertEqual(runner.read(target), {"state": "old"})
        self.assertEqual(list(directory.glob("*.tmp")), [])

    def test_unrelated_io_error_is_not_retried(self):
        directory = self.scratch()
        with patch.object(runner, "atomic_replace", side_effect=OSError("unrelated disk failure")) as replace, \
             patch.object(runner.time, "sleep") as sleep:
            with self.assertRaises(OSError):
                runner.write(directory / "status.json", {})
        replace.assert_called_once()
        sleep.assert_not_called()
        self.assertEqual(list(directory.glob("*.tmp")), [])

    def test_real_windows_reader_without_share_delete_reproduces_failure_but_status_is_nonfatal(self):
        directory = self.scratch()
        target, log = directory / "status.json", directory / "console.log"
        runner.write(target, {"state": "old"})
        kernel, handle = self.open_windows_reader(target, share_delete=False)
        publisher = runner.StatusPublisher(target, log)
        try:
            self.assertFalse(publisher.publish({"state": "generating"}))
            self.assertEqual(runner.read(target), {"state": "old"})
            self.assertEqual(publisher.failures, 1)
        finally:
            kernel.CloseHandle(handle)
        self.assertTrue(publisher.publish({"state": "idle"}))
        self.assertEqual(runner.read(target)["state"], "idle")
        self.assertEqual(publisher.failures, 0)
        self.assertIn("model kept running", log.read_text(encoding="utf-8"))
        self.assertIn("recovered after 1", log.read_text(encoding="utf-8"))
        self.assertEqual(list(directory.glob("*.tmp")), [])

    def test_real_windows_reader_with_share_delete_allows_atomic_replace(self):
        directory = self.scratch()
        target = directory / "status.json"
        runner.write(target, {"state": "old"})
        kernel, handle = self.open_windows_reader(target, share_delete=True)
        try:
            runner.write(target, {"state": "new"})
            self.assertEqual(runner.read(target), {"state": "new"})
        finally:
            kernel.CloseHandle(handle)

    def test_monitor_warning_is_rate_limited_and_logging_failure_is_also_nonfatal(self):
        writer = Mock(side_effect=OSError("disk full"))
        publisher = runner.StatusPublisher("unused", "unused", writer=writer, clock=lambda: 0)
        with patch.object(runner, "append_log") as log:
            for _ in range(20):
                self.assertFalse(publisher.publish({"state": "idle"}))
            log.assert_called_once()
        directory = self.scratch()
        publisher = runner.StatusPublisher(directory / "status.json", directory / "missing" / "console.log", writer=writer)
        self.assertFalse(publisher.publish({"state": "idle"}))

    def exercise_lifecycle(self, fail_owner=False):
        directory = self.scratch() / "runs" / uuid.uuid4().hex
        directory.mkdir(parents=True)
        run = {"id": directory.name, "dir": str(directory), "source": str(directory / "source"),
               "python": "never-executed.exe", "config": str(directory / "model.json"), "model": "fixture-model",
               "log": str(directory / "console.log"), "settings": {"port": 8080}}
        runner.write(run["config"], {"env": {"STRATA_ROUTE_PRIOR": "0", "STRATA_KVA": "1", "STRATA_VRAM_FREE": "device"}})
        child = Mock(pid=456, returncode=0)
        child.poll.side_effect = [None] if fail_owner else [None, None, 0, 0]
        child.wait.return_value = 0
        winjob = SimpleNamespace(contain=Mock(return_value=True), terminate=Mock())
        serve = ModuleType("serve")
        serve.winjob = winjob
        original_write = runner.write
        failed = []

        def writer(file, data):
            wanted = "owner.json" if fail_owner else "status.json"
            if Path(file).name == wanted and not failed:
                failed.append(True)
                raise self.denied()
            original_write(file, data)

        def metrics(_port, endpoint):
            return {"loaded": True, "model": run["model"]} if endpoint == "health" else {"live": {"state": "idle"}}

        with patch.object(sys, "argv", ["runner.py", "--run", "fixture", "--parent", "123"]), \
             patch.object(runner, "checked_run", return_value=run), \
             patch.object(runner, "preflight"), \
             patch.object(runner.psutil, "Process", return_value=SimpleNamespace(is_running=lambda: True)), \
             patch.object(runner.subprocess, "Popen", return_value=child) as start, \
             patch.object(runner, "write", side_effect=writer), \
             patch.object(runner, "get", side_effect=metrics), \
             patch.object(runner.time, "sleep"), patch.dict(sys.modules, {"serve": serve}):
            try:
                result = runner.main()
            finally:
                sys.path.remove(run["source"])
        start.assert_called_once()
        self.assertEqual(start.call_args.kwargs["env"]["STRATA_KEEP_LEFTOVERS"], "1")
        self.assertEqual(len(failed), 1)
        return result, directory, winjob

    def test_status_failure_does_not_kill_or_restart_the_owned_model(self):
        result, directory, winjob = self.exercise_lifecycle()
        self.assertEqual(result, 0, (directory / "console.log").read_text(encoding="utf-8"))
        winjob.terminate.assert_not_called()
        self.assertEqual(runner.read(directory / "status.json")["state"], "exited")
        log = (directory / "console.log").read_text(encoding="utf-8")
        self.assertIn("model kept running", log)
        self.assertEqual(log.count('STRATA_ROUTE_PRIOR="0"'), 1)
        self.assertEqual(log.count('STRATA_KVA="1"'), 1)
        self.assertEqual(log.count('STRATA_VRAM_FREE="device"'), 1)

    def test_owner_guard_failure_still_stops_its_own_tree(self):
        result, directory, winjob = self.exercise_lifecycle(fail_owner=True)
        self.assertEqual(result, 2)
        winjob.terminate.assert_called_once()
        self.assertEqual(runner.read(directory / "status.json")["state"], "error")


if __name__ == "__main__":
    unittest.main()
