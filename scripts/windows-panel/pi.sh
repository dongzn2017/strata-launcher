#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
if [[ ${1-} == --launcher-dry-run ]]; then
  printf 'ARGV <node> <portable Pi bootstrap> <validated manifest>\n'
  exit 0
fi
exec node "$ROOT/scripts/windows-panel/pi-run.mjs" "${1:?Missing Pi manifest}"
