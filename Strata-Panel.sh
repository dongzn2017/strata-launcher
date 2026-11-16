#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
args=(powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "$ROOT/scripts/windows-panel/StrataLauncher.ps1")
if [[ ${1-} == --launcher-dry-run ]]; then
  printf 'ARGV'; printf ' <%s>' "${args[@]}"; printf '\n'; exit 0
fi
exec "${args[@]}" "$@"
