# Changelog

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
