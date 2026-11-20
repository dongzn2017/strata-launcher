# Parameter Guide

[English](PARAMETERS.md) | [简体中文](PARAMETERS.zh-CN.md) | [Home](../README.md)

Run `node launcher.mjs options PROFILE` for the exact allowed choices and effective/inherited values. The [schema](../conf/launcher.schema.json) is editor assistance; runtime validation also applies. Examples below use a placeholder profile ID `my-model`.

## Saving and Inheritance

`set PROFILE section.field VALUE` accepts a bare enum string or JSON scalar/array, validates the selected profile before writing, and returns the original-config backup path. It does not change a running model. Existing config locks are not automatically cleared. The original installed model profile is never rewritten.

`engineOptions` defaults to `default`: inherit profile/process/engine behavior, **not force off**. Extended controls target declared engines 0.1.59, 0.1.60 and 0.1.62. The reference index has 162 entries (0.1.60 baseline); entries outside curated controls are reference-only, not arbitrary flag/environment passthrough. Compatibility and performance still need real-workload validation.

## Core Settings

These are `settings.FIELD`. Numbers are launcher default validation ranges, not measured hardware capacity. Defaults are read from the original model profile.

| Field | Range / choices | Meaning |
|---|---|---|
| `context` | 32768-262144 tokens | Total maximum context; not all GPU-resident |
| `output` | 1024-32768 tokens | Total output cap, including thinking |
| `thinking` | 0-24576 tokens | Thinking budget; must be below output |
| `effort` | off / low / medium / high | Reasoning setting, separate from temperature |
| `kv` | int8 / k8v4 | KV format; k8v4 uses INT8 keys and INT4 values |
| `kvResident` | 4096-262144 tokens | Requested GPU KV residency, at most context; actual allocation can be rounded by the engine |
| `expertGiB` | 8-50 GiB | Expert RAM budget, not whole-process RAM |
| `headroomGiB` | 6-24 GiB | RAM headroom used by engine budgeting; not a target to fill |
| `vramMiB` | 0-4096 MiB | User VRAM reserve; 0 does not remove WDDM/driver or engine allocations |
| `workers` | 1-12 | CPU expert worker count; more is not always faster |
| `spec` | 0-8 | MTP speculative window control; 0 removes the MTP asset requirement |
| `specMinP` | 0-1 | MTP probability threshold, not DFlash2 confidence |
| `drafting` | mtp / dflash2 | Drafter family; actual compatible assets required |
| `port` | 1024-65535 | Loopback engine API port |
| `visionThreads` | 1-12 | Vision-head CPU threads when the profile has vision |
| `imageTokens` | 64-1024 | Vision token setting, not text context |

Output + 4096 must be strictly below context. A vision setting does not create a missing vision head. `minimumFreeGiB` is a separate, explicit start-admission gate in the profile; it is not expert RAM budget or a live memory ceiling.

To widen a known numeric validation range, edit `limits.FIELD` deliberately:

```powershell
node launcher.mjs set my-model limits.expertGiB '[8,54]'
node launcher.mjs set my-model settings.expertGiB 52
```

This does not prove the machine has enough memory or guarantee the engine will use that amount. Budgets compete with KV, native weights, session caches, the OS and other applications. Do not widen limits solely to fill a usage graph.

## Sampling, DFlash2 and Learning

Sampling overrides require `sampling.mode=custom`; `model` leaves the model's settings alone. Set custom mode before editing its values.

| Sampling field | Allowed range |
|---|---|
| `temperature` | 0-2 |
| `top_p` | 0.01-1 |
| `top_k` | integer 1-64 |
| `min_p` | 0-1; 0 disables this filter |
| `repetition_penalty` | 0.1-2; 1 is neutral |
| `presence_penalty`, `frequency_penalty` | 0-2; 0 is neutral |
| `penalty_last_n` | integer 1-131072 |
| `seed` | null for random, or integer 1-2147483647 |

Higher temperature is not more thinking. Sampling controls token choice; thinking budget/effort controls a different part of the request. API clients may override generation defaults, so verify actual requests before attributing behavior to a saved profile.

`draftOptions`: `mode=auto|manual`, `pack=stock|tuned`, `window=2..6`, `confidence=0.05..1`. Auto leaves window/confidence to the engine; manual supplies them. A tuned pack needs explicit `dflash2.pack`, `model`, and verified quant/engine compatibility metadata, plus the matching file. It is not safe to reuse an unrelated model's drafter. Auto is not a promise of better throughput; compare TTFT, PP, TG and acceptance on the same workload.

`learning`: `enabled=false` by default, `reuse=true`, `scope=general|video|coding`, `saveEveryMinutes=1..60` (default 5). This saves/reuses expert routing placement, **not model training or conversational memory**. Identity gates prevent incompatible reuse. Learning requires active cache adaptation, so `adaptEvery=0` or `adaptSwaps=0` is rejected. Save success must be checked in logs; explicit stop gives the owned engine a bounded flush opportunity.

## All 42 Curated Engine Controls

Use `engineOptions.KEY`. Values, units, Chinese hints and risk labels are in `options.engineOptions` and [the generated schema](../conf/engine-options.schema.json). Below are their targets and main implications; leave `default` unless an override is intentional.

| Key | Engine flag / environment | Purpose / caution |
|---|---|---|
| `routePrior` | `STRATA_ROUTE_PRIOR` | off=0, on=1.5; biases routing toward cached experts, may change quality |
| `kva` | `STRATA_KVA` | Attention approximation, not KV precision; may affect long-context detail |
| `vramFree` | `STRATA_VRAM_FREE` | device requests device/NVML budgeting; check actual fallback/allocation logs |
| `tailSkip` | `STRATA_ROUTE_TAIL_SKIP` | 0 off, 1-9 rank thresholds; skips contributions, not lossless acceleration |
| `tailSkipMaxCached` | `STRATA_TAIL_SKIP_MAX_CACHED` | Default skip gate by cached expert fraction, not hit rate |
| `prefillCpuShare` | `STRATA_PREFILL_CPU_SHARE` | 0 / auto / 1 CPU sharing for short prompts |
| `pcieFrac` | `--pcie-frac` | Explicit fraction of cache misses copied for GPU computation |
| `pcieDefault` | `STRATA_PCIE_FRAC_DEFAULT` | old / auto distribution rule; explicit fraction wins |
| `pcieKRule` | `STRATA_PCIE_K_RULE` | Adaptive K rule in automatic allocation |
| `pcieShareMax` | `STRATA_PCIE_SHARE_MAX` | Upper bound on automatic PCIe share |
| `hostCore` | `--host-core` | Main thread placement; last is unsuitable for hybrid P/E CPUs |
| `poolAffinity` | `--pool-affinity` | all / auto / p-cores / measure worker affinity |
| `poolTasks` | `--pool-tasks` | Task batching; too much adds scheduling overhead |
| `auxCpus` | `--aux-cpus` | Auxiliary thread placement, not extra cores |
| `noHostWorker` | `--no-host-worker` | Exclude main thread from expert work |
| `adaptEvery` | `--adapt-every` | Cache update interval; 0 conflicts with learning |
| `adaptSwaps` | `--adapt-swaps` | Swaps per adaptation round; 0 conflicts with learning |
| `adaptDecay` | `--adapt-decay` | Expert heat decay; not repetition penalty |
| `adaptMinGain` | `--adapt-min-gain` | Minimum candidate/replaced heat ratio |
| `adaptAsync` | `--adapt-async` | Nonblocking adaptation; not bitwise repeatable across runs |
| `adaptOverlap` | `STRATA_ADAPT_OVERLAP` | Copy/window overlap for supported single-GPU full-RAM mode; incompatible with async/pipeline/lag/nowait/DMA combinations |
| `prefillChunk` | `--prefill` | auto or curated chunk sizes; larger needs buffers and may be slower |
| `kvGrow` | `--kv-grow` | Grow GPU KV with reached positions; not a larger context |
| `shortRead` | `--short-read` | Threshold routing small increments through decode windows |
| `prefillHeadAlias` | `--prefill-head-alias` | Temporarily unload/reload native output head during prefill |
| `promptCache` | `--prompt-cache` | Number of RAM checkpoints; 0 disables |
| `promptCacheEvery` | `--prompt-cache-every` | Checkpoint token interval; 0 disables intermediate checkpoints |
| `promptCacheTail` | `--prompt-cache-tail` | Extra near-tail checkpoint; needs enabled checkpoints and interval |
| `promptCacheSpread` | `--prompt-cache-spread` | Spread historical checkpoints instead of only recent ones |
| `conversationMiB` | `--conversation-cache-mib` | Parked conversation RAM budget; competes with experts/KV |
| `conversationSlots` | `--conversation-cache-slots` | Parked states, **not concurrent decoding slots** |
| `conversationFloor` | `--conversation-cache-min-free-mib` | Free RAM floor for conversation cache operations |
| `conversationMinTokens` | `--conversation-cache-min-tokens` | Minimum size eligible for parking |
| `conversationParkGain` | `--conversation-cache-park-gain` | Growth required before replacing parked snapshot |
| `pleIo` | `--ple-io` | direct / mmap / ram; model-specific full table can be about 29 GB |
| `pleRowCache` | `--ple-row-cache` | Cached table rows, with index/metadata RAM cost |
| `pleInflight` | `--ple-inflight` | Outstanding SSD reads; more is not always faster |
| `pleAutoMmap` | `STRATA_PLE_AUTO_MMAP` | Allow/disable startup fallback from slow direct reads to mmap |
| `suffixDraft` | `--suffix-draft` | Repeated-prompt lookup minimum match; 0 does not disable all drafting |
| `lookupMaxT` | `--lookup-max-t` | Extended lookup window; additional graph VRAM may be needed |
| `lookupChain` | `--lookup-chain` | Experimental lookup appended after MTP |
| `lookupChainMin` | `--lookup-chain-min` | Minimum match length for chained lookup |

The PLE RAM guard uses a conservative ~29 GiB table allowance plus expert budget/headroom against total physical RAM; it is an obvious-overcommit guard, **not** complete peak-memory accounting. Overlap, KV growth and several flags have upstream single-GPU/profile-specific prerequisites; passing syntax checks does not prove that workload supports them.

## Monitor and Discovery Semantics

- TG is decode speed; PP is prefill, not interchangeable. Previous-request figures are labeled separately from current activity.
- Disk throughput is **system-wide**, not attributed exclusively to the model. VRAM used is not the expert-cache size. Unknown cache units remain unknown rather than estimated from expert count.
- `/capabilities` model identity, context and vision are checked across live endpoints; reasoning defaults additionally require matching generated-config hashes. Pi hints are not an installed Pi configuration.
- LAN changes are made deliberately in the optional top-level `lan` block, not through model `set`. The bridge must be explicitly restarted to use a new listener/allowlist. No firewall or Windows service is installed.
