# Runbook for AI agents

Every command prints one JSON object on stdout. Machine-readable contract; nothing else on stdout.

```
node launcher.mjs doctor [PROFILE]     environment + config + asset report   exit 0 ready / 3 blocked / 2 broken config
node launcher.mjs detect PATH...       candidate config from a found install exit 0 / 2 nothing to search
node launcher.mjs list                 [{id, quant, profile}]
node launcher.mjs check PROFILE        offline validation of one profile     exit 0 / 2 first error on stderr
node launcher.mjs prepare PROFILE      run dir written, nothing started
node launcher.mjs start PROFILE        foreground; blocks until the engine exits
node launcher.mjs status RUN_ID        snapshot of runtime/strata-launcher/runs/RUN_ID/status.json
node launcher.mjs stop RUN_ID          ownership-token stop request
```

`Strata-Launcher.cmd <same args>` is the same thing on Windows. Exit codes: `0` ok, `2` bad usage or config (message on stderr, no JSON), `3` doctor says not ready (JSON on stdout anyway).

## Deploy procedure

1. `node launcher.mjs doctor` — expected to fail with `config.exists: false`.
2. `node launcher.mjs detect <install-drive-or-folders>` — ask the human which folders hold the Strata install and the models if it is not obvious from the machine. `found` reports control/engine/model counts; `unreadable` lists folders that could not be read; `models_detail` lists every candidate model profile with its weights, context, modality and guessed quant.
3. Write `config` from that output to `conf/launcher.json`. Replace every `null`: `minimumFreeGiB` needs the human's number (free RAM to demand before admitting the engine), a missing `quant` needs the human's label. Keep the guessed `deployment` only if `candidateInstalls` is 1; if it is 0 the versions do not pair and you must ask the human for the Control and engine directories.
4. `node launcher.mjs doctor` again. For every entry in `report.problems[]`, act on its `error`:
   - `Missing runtime file: …python.exe` → the Control directory is wrong.
   - `cannot import psutil` → that Control install is incomplete; report it, do not pip-install into someone else's runtime.
   - `A Strata engine is already running` → ask the human; do not kill another process.
   - `Launcher-owned runs are still active` → `stop` them with their RUN_ID first.
   - `port … is busy` → change that profile's `settings.port`.
   - `Missing … .gguf` / model profile errors → the model JSON or the weights are wrong; report the exact missing path.
5. `node launcher.mjs check PROFILE` until exit 0.
6. `node launcher.mjs start PROFILE` as a long-lived job. It prints the run JSON: `id`, `directory`, `model`, `api`, `log`.
7. Poll `status <RUN_ID>` (never the log for state). `state` goes `loading` → `ready` when the engine reports loaded; `stopped`, `exited` or `error` are terminal. Ready means `http://127.0.0.1:<port>/v1` answers.
8. `stop <RUN_ID>` to shut down; the runner saves learned routing on the way out when learning is on.

## Rules

- One engine at a time on a machine; `doctor` refuses to claim readiness otherwise.
- Never edit a model profile JSON, never move weights, never write into the Strata install. The launcher reads those; all its writes go to `runtime/` and `logs/`.
- Never start a run outside this launcher: `stop` only accepts a run whose ownership record it wrote.
- `limits` is the only way to widen a numeric bound. Write the narrowest range that fits the model; a range the launcher does not recognise is rejected instead of ignored.
- A tuned drafter needs a `dflash2` block naming the pack, the model, the quant and the verified engine versions. If you do not know them, leave the block out and ship the stock drafter. Do not invent them from a model name.
- Report absolute paths and the RUN_ID to the human; `doctor` and `check` already give them.

## Tests

`npm test` and `npm run test:python` pass with no GPU, no model and no network. Run them before publishing any change here.
