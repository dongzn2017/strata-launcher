# Strata Launcher

Start, check and stop a local [Strata](https://github.com/Niko1221/Strata) inference service on Windows from one JSON config. One profile per model build: install paths, port, memory gate, quant label, sampling, drafting, routing learning.

Everything is plain JSON in and JSON out, so an AI agent can drive it without a human in the loop. See [AGENTS.md](AGENTS.md) for the machine-facing runbook; Chinese version in [README.zh-CN.md](README.zh-CN.md).

## Requirements

- Windows, Node.js 22 or newer.
- An installed Strata **Control** directory (`components/control/<version>`) whose `python/python.exe` can import `psutil`.
- An installed Strata **engine** directory holding `strata.exe` (and `strata-vision.exe` for multimodal profiles).
- One Strata model profile JSON per model: the file with the `args` array that names the GGUF shards, pack, expert route table, tokenizer and optional vision head. The launcher never copies or edits it; it reads it and launches against it.

Weights and models are yours. Keep the config and the model JSON wherever you like — this repository never needs them.

## Quick start

```powershell
.\Strata-Launcher.cmd doctor
```

`doctor` prints one JSON object and exits `3` if anything blocks a start. Every blocker is one entry in `problems[]` with a `section` and an `error`; the rest of the object describes what was found (Node version, resolved runtime paths, `psutil` probe, running engines, live runs, per-profile model/port). It never creates a run directory.

With no `conf/launcher.json` yet, point `detect` at the folders that hold the install and the models:

```powershell
.\Strata-Launcher.cmd detect C:/Strata D:/Models
```

It walks those folders (skipping `.git`, `node_modules`, `AppData`, `Windows`, …), keeps only real components — a Control version directory, an engine directory that contains `strata.exe`, a JSON with a Strata `args` array and resolvable weights — and prints a candidate config with a guessed quant per model and unique ports. Only the parts it cannot know are left `null` (usually `minimumFreeGiB`). Copy the `config` object to `conf/launcher.json`, fill in the nulls, run `doctor` again.

Then:

```powershell
node launcher.mjs list
node launcher.mjs check my-model
node launcher.mjs start my-model      # foreground; prints RUN_ID, log path, API URL
node launcher.mjs status <RUN_ID>     # in another terminal
node launcher.mjs stop <RUN_ID>
```

`check` is fully offline: config, runtime files, model assets and GGUF shard completeness. `prepare <id>` writes the run directory (config, hashes, log location) without starting anything, for review. `start` runs in the foreground and owns the process; `stop` writes an ownership-token stop request that the runner honours. The service answers at `http://127.0.0.1:<port>/v1`. Actual load state is whatever `status` reports.

Exit codes: `0` ok, `2` bad usage or config, `3` doctor says not ready, otherwise the engine's exit code.

## Configuration

Copy `conf/launcher.example.json` to `conf/launcher.json`. Paths are resolved relative to that file. `conf/launcher.schema.json` describes the shape for editors; the launcher validates every field itself and refuses anything unknown.

`deployment` names the installed Control directory, the engine directory and the engine version. `profiles` holds one entry per model:

| field | meaning |
|---|---|
| `id` | lowercase name you call the profile by |
| `quant` | label used in the advertised model name — free text, e.g. `q4_k_xl`, `iq4_xs_v31` |
| `slug` | optional model-name prefix; default comes from the model profile's `model_name` or file name |
| `profile` | the Strata model profile JSON |
| `minimumFreeGiB` | free system RAM required before the engine is admitted |

`settings` may override `port`, `context`, `output`, `thinking`, `effort`, `kv`, `kvResident`, `expertGiB`, `headroomGiB`, `vramMiB`, `workers`, `spec`, `specMinP`, `drafting`, `visionThreads` and `imageTokens`; everything else is inherited from the model profile. `limits` replaces the default accepted range for any of those numbers when your model build legitimately needs a different one — `{ "context": [8192, 262144] }` — and is rejected if it does not bound a setting the launcher knows.

`sampling`, `engineOptions`, `draftOptions` and `learning` are optional and documented by the schema. Routing learning is off by default; a learned profile is only reused when the model, modality, engine version, base profile and workload all match, and a stale or malformed one falls back to the base file.

### Tuned drafters

DFlash2 options (`draftOptions`) validate modes and keep MTP probability apart from drafter confidence. A **tuned** drafter pack is never inferred from a model name: declare it under `dflash2` — the pack file, the model it was built for, that model's quant, and the engine versions it was verified against. Anything else starts with the stock drafter. The gates in the example config are placeholders; replace them with what your drafter build actually is.

## Tests

```powershell
npm test
python -m pip install psutil==7.2.2
npm run test:python
```

Tests use temporary profile directories and fake processes; they need no GPU, no model and no network. They cover config validation, run isolation, ownership-token stop, shard/identity detection, learning-profile compatibility, sampling and option validation, and install detection.

Publishable state: the launcher starts, checks and stops Strata through these tests only. Before trusting it on a real installation, run `doctor` and `check` there and confirm the rights on the parts reused from the upstream panel implementation. Upstream Strata is licensed separately ([Strata v0.2.13 license](https://github.com/Niko1221/Strata/blob/v0.2.13/LICENSE)); the launcher itself is MIT — see `LICENSE`.
