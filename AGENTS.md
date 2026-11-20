# Agent Runbook: Strata Launcher 1.3.0

This repository contains a portable CLI, a Windows WinForms panel and a loopback web console (`ui/`, `node launcher.mjs webpanel`). The author's 5070/64GB preset is a settings snapshot, not a universal optimum or verified performance benchmark. Never copy local credentials, real LAN addresses, runtime state, weights or Pi watchdog budgets into this repository.

## Command Contract

Normal commands emit one JSON value on stdout; errors use stderr and exit 2. `--help` is text. Interactive `monitor` is a TTY screen, not JSON. `start` and `lan` print an initial JSON result and then remain in the foreground; their later failures may produce a nonzero exit.

```text
node launcher.mjs --version
node launcher.mjs doctor [PROFILE]         exit 0 ready / 3 blocked / 2 broken config
node launcher.mjs detect PATH...          candidate config; no save/start
node launcher.mjs list
node launcher.mjs check PROFILE           read-only offline validation
node launcher.mjs prepare PROFILE         isolated run manifest, no engine
node launcher.mjs start PROFILE           foreground, returns RUN_ID
node launcher.mjs status RUN_ID
node launcher.mjs stop RUN_ID             ownership-token stop request
node launcher.mjs options [PROFILE]       catalogue; optional effective values
node launcher.mjs set PROFILE FIELD VALUE validated section.field config edit
node launcher.mjs monitor PROFILE [--once]
node launcher.mjs monitor --url URL [--once]
node launcher.mjs lan-plan PROFILE        no listener or run writes
node launcher.mjs lan PROFILE             foreground bridge, returns separate LAN_ID
node launcher.mjs lan-status LAN_ID
node launcher.mjs lan-stop LAN_ID
node launcher.mjs webpanel [PORT]         local web console, default 8444
```

`Strata-Launcher.cmd` forwards the same arguments on Windows. Monitor `--once` emits metrics JSON through the launcher. The standalone downloadable monitor's `--once` is a text snapshot.

## Deployment

1. Run `doctor`; missing private config is expected initially. Ask which folders contain the existing Strata install/models if unknown; do not scan entire unrelated disks.
2. Run bounded `detect PATH...`, inspect `candidateInstalls`, `unreadable`, `models_detail` and candidate `config`. Do not treat ambiguous pairing as established. Review paths and fill all nulls before writing `conf/launcher.json`.
3. `deployment.engineVersion` is the **component** version, not the Terminal release. Advanced overrides target 0.1.59/0.1.60/0.1.62; other versions need review.
4. Run `doctor PROFILE` and `check PROFILE`. Report exact blockers. Missing psutil/assets means an incomplete or wrong installation: do not install into a vendor runtime or fetch models without authorization. Busy ports, another engine or active run are not permission to stop anything.
5. Inspect `options PROFILE` and `prepare PROFILE`. Only run `start` when authorized. Record absolute run/log paths and the returned UUID.
6. `status` is a saved snapshot. Confirm live health/model before claiming readiness; a loaded model is not proof of successful generation or tool calling. Leave real inference testing to a separately authorized bounded workload.
7. `stop RUN_ID` is an explicit operation, not an automatic remediation step. It targets only the launcher-owned run. Do not clear unknown locks, adopt a PID or kill an unrelated engine.

## Parameters and Storage

- Original model profiles, model assets and installed Strata files are read-only. Generated manifests/state/logs go under `runtime/` and `logs/`.
- Explicit save in the local web or Windows panel, or CLI `set`, edits private `conf/launcher.json` after validation, with an original-config backup and an exclusive edit lock. Web saves also reject stale configuration revisions. No live model mutation or automatic restart follows. Never automatically clear an existing config lock.
- Supported mutable sections: `settings`, `sampling`, `engineOptions`, `draftOptions`, `learning`, `limits`. No arbitrary environment/command pass-through. Reference-only entries are not editable controls.
- `default` inherits model/process/engine behavior; it does not mean off. Preserve defaults unless the user asks for tuning. Risky route/approximation options may alter results, not just throughput.
- `limits` changes recognized validation ranges, not physical resource guarantees. Do not lower admission/headroom just to force an unsafe start. Explicit PLE RAM mode is guarded against an obviously excessive total budget, not proven safe for every workload.
- Routing learning is opt-in; reuse is bound to model assets, modality, engine, base routing, workload and explicit advanced overrides. Disabled adaptive caching conflicts with learning. Do not claim learning is model-weight training.
- Tuned DFlash2 needs explicit actual pack/model/quant/verified-engine metadata. Do not invent compatibility from a filename. See docs/PARAMETERS.md and the schema.

## LAN and Monitoring

- Keep the engine loopback-only. LAN is separately opt-in, explicitly bound to an owned private IPv4 and exact private/loopback client IPs. No wildcard/public binding.
- `lan-plan` is safe to inspect offline. `lan` starts only the bridge, not the model. A stopped monitor/bridge must not stop the engine.
- No automatic firewall rules, Windows tasks/services, TLS or API authentication are installed. Plain HTTP is trusted-private-LAN only. Do not widen network exposure to cure a timeout.
- Client discovery uses live `/capabilities`, cross-checked health/props/models and matching hash-bound local settings. Preserve unknown reasoning values as null; use returned model ID/context and fingerprint instead of stale hard-coded values. Check again on reconnect or model change.
- Capability advertisements are not generation/tool-call acceptance evidence. Do not start a Pi, reset watchdog state or migrate private sessions as a side effect.
- Management endpoints are denied. Logs contain access metadata, not request bodies. Avoid adding prompt/answer logging. Terminal monitor reads only metrics, rejects stale data and exits on q/Ctrl+C without controlling the model.
- Verify a downloaded monitor against a trusted server-side hash before execution; untrusted HTTP does not authenticate its own checksum.

## Tests and Packaging

Run `npm run schema:check`, `npm test`, and `npm run test:python`. Python tests require an existing test interpreter with psutil. Tests use temporary fixtures and bounded loopback mock HTTP; no GPU, real models, external APIs, downloads, GUI launches or remote tasks are needed.

Use the explicit package allowlist; inspect `npm pack --dry-run --json` before building. Exclude private `conf/launcher.json`, runtime, logs, credentials and weights. Do not commit, push, tag or publish a release automatically.

## Windows Panel

- `Strata-Panel.cmd` is a thin Git for Windows Bash bridge; `Strata-Panel.sh --launcher-dry-run` starts no GUI or inference. Existing `Strata-Launcher.cmd` remains the CLI entry. Read the selected config before launching anything.
- Shared model settings are saved in private `conf/launcher.json` with validation, locking, concurrency checks and backups. Private UI preferences go under runtime. Do not publish private Pi entry/extension/skill paths from `conf/pi.json`.
- Resource scan is read-only. Forced application termination requires explicit confirmation, a closed allowlist and PID/start-time/path/SID/session checks. Never auto-kill unknown processes, all WebView2 instances, DWM, models or Pi. Do not escalate privileges automatically.
- Explorer stop is a separately confirmed action, with an owned recovery journal and explicit recovery button. Never use it as a UI test. Do not disable system services, update policies or scheduled tasks to prevent respawn.
- Optional Pi uses the installed CLI and extension API, with actual live model/context/modality/alias checks. No package install, private internal hooks, credential migration or watchdog reset. External extensions remain responsible for their own behavior.
