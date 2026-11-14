#!/usr/bin/env bash
set -euo pipefail

mode="${1:?Use acceptance or checker}"
case "$mode" in acceptance|checker) ;; *) exit 2 ;; esac
: "${RUNTIME_IMAGE:?Build and set RUNTIME_IMAGE}"
: "${MIGRATION_IMAGE:?Build and set MIGRATION_IMAGE}"

# A fresh project name guarantees a fresh project-owned test volume.
project="t19-ci-${mode}-$(date +%s)-$$"
file="infra/compose.acceptance.yaml"
out="artifacts/${mode}"
mkdir -p "$out"
dc=(docker compose -p "$project" -f "$file")

cleanup() {
  result=$?
  trap - EXIT
  "${dc[@]}" logs --no-color > "$out/containers.log" 2>&1 || true
  # Destructive only to this newly created disposable CI project.
  if ! "${dc[@]}" down --volumes --remove-orphans; then
    result=1
  fi
  exit "$result"
}
trap cleanup EXIT

"${dc[@]}" up -d --wait --wait-timeout 180 api-a api-b worker-a worker-b

if [ "$mode" = acceptance ]; then
  export ISOLATED_TEST=true
  export API_URLS="http://127.0.0.1:18080,http://127.0.0.1:18081"
  PSQL_COMMAND_JSON="$(python3 - "$project" "$file" <<'PY'
import json, sys
print(json.dumps(['docker','compose','-p',sys.argv[1],'-f',sys.argv[2],
 'exec','-T','db','psql','-U','fulfillops','-d','fulfillops_test',
 '-X','-At','-v','ON_ERROR_STOP=1','-f','-']))
PY
)"
  export PSQL_COMMAND_JSON
  python3 tests/acceptance/order-flow.py | tee "$out/result.json"
else
  python3 assessment/fulfillops_public_checker.py \
    --base-url http://127.0.0.1:18080 --concurrency --stress \
    | tee "$out/checker.txt"
  # The supplied checker can exit zero even with skips. Enforce no skips.
  grep -Fq 'RESULT: 15 passed / 0 failed / 0 skipped' "$out/checker.txt"
fi
