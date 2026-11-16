#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if [[ ${1-} == --launcher-dry-run ]]; then
  printf 'ARGV <node> <launcher.mjs> <monitor> <PROFILE>\n'; exit 0
fi
exec node "$ROOT/launcher.mjs" monitor "${1:?Missing profile ID}"
