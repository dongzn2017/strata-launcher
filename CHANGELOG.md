# Changelog

## 1.3.0

- Added `node launcher.mjs webpanel [PORT]`: a dependency-free loopback web console (default 8444) bridging the same CLI — doctor, profiles, check, start, stop, live runs. Dark animated single-page UI; no new capabilities, no external requests, nothing starts by itself.
- The WinForms `npm run panel`, `Strata-Panel.cmd` and every existing CLI command are unchanged.
- Validation: 44 offline Node tests plus web console checked in a real browser (render, doctor/list/check round-trips with a live config); Python suite unchanged.

## 1.2.0

- Portable Windows WinForms panel adapted from the author's daily launcher; the existing JSON CLI remains supported.
- Shared, validated model settings; per-profile tuning, sampling, thinking, KV, CPU, learning, MTP/DFlash2 and 42 advanced controls. Reference baseline updated to engine 0.1.60 (162 entries); explicit controls support 0.1.59/0.1.60. Added `auto:8192` prefill.
- NVML/WDDM VRAM scan; explicitly confirmed allowlisted app/background termination; separate Explorer desktop stop/restore with recovery journal. No automatic system-service/update-policy changes or generic WebView2/unknown-process kill.
- Fix: a foreign visual recovery journal now skips visual changes without blocking independently confirmed app termination. Per-process errors and new-process observations are visible; failed closes prevent automatic model loading.
- Local/remote terminal monitor and GUI LAN buttons, reusing exact-IP private HTTP forwarding. No firewall rules or scheduled tasks are installed; stopping/closing a monitor does not stop inference.
- Optional existing-Pi CLI/extension adapter; configurable external extensions/skills. No private Pi internals, package installs, credential/session migration or watchdog-budget changes. Real public-Pi end-to-end use is not validated by this release's mock tests.
- Included exact sanitized author preset: RTX 5070 12GB + 64GB, IQ4_XS-v31 vision, context 128K, GPU KV 28K k8v4, expert RAM 44 GiB, headroom 6 GiB, VRAM reserve 168 MiB, workers 5, tuned DFlash2 auto. Author describes it as their current best self-tuned setup; 100+ tokens/s is a user-reported favorable-workload observation, not a release benchmark or guarantee.
- Fixed tokenizer directory acceptance in the portable backend. Original Strata files and model weights remain unchanged.
- Validation: 44 offline Node tests, 22 Python tests, schema checks, local GUI snapshots and resource-page checks at 100/125/150/200%; no new throughput benchmark, destructive Explorer test or cross-machine firewall test.

## 1.1.0

### Added / 新增

- 42 curated engine controls and a 167-entry reference index: routing/quality, CPU/PCIe, expert cache adaptation, prefill/KV, session caches, PLE/SSD and lookup drafting.
- `options [PROFILE]` and validated, backed-up `set PROFILE section.field VALUE` edits, applied only on the next explicit model launch.
- Read-only local/remote terminal telemetry, stale-data handling, and q/Ctrl+C exit without model shutdown.
- Explicit private-LAN bridge with exact source-IP allowlist, SSE forwarding, live capabilities, model-identity checks, hash-verifiable terminal client and separately owned LAN lifecycle.
- Expanded English and Chinese README, parameter guides, generated advanced-option schema and packaging allowlist.

### Compatibility / 兼容性

- Config format remains version 1. New sections are optional; LAN and routing learning are opt-in.
- Extended engine choices are curated for component 0.1.59, paired with Terminal 0.2.13; explicit new overrides are rejected for other declared engine versions.
- Original model profiles, installed runtime and weights remain unchanged. No model downloads, Pi/plugin installs or firewall changes.
- This is a CLI release, not a port of the original WinForms interface, DeepSeek-specific launcher or Basalt backend.
- LAN HTTP has IP filtering but no encryption or API authentication: trusted private networks only.

### Verification / 验证

- Windows: 37 Node tests, 22 Python runner tests, generated-schema check.
- Tests cover every curated control reaching an isolated manifest, enum validation, edit rollback/backups, compatibility guards, bridge ownership/lifecycle, discovery consistency, route restrictions, streaming and monitor failure states.
- Tests use temporary fixtures and loopback mock HTTP, not a real GPU/model or cross-machine firewall. No performance or generation-quality claims are implied.

## 1.0.0

- Initial JSON-configured Windows launcher: detect, doctor, check, prepare, start, status, owned stop; sampling, drafting, routing learning and model identity.
