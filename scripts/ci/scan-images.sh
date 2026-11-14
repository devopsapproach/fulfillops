#!/usr/bin/env bash
set -euo pipefail
: "${TRIVY_IMAGE:?Set reviewed scanner image digest}"
: "${RUNTIME_IMAGE:?}"
: "${MIGRATION_IMAGE:?}"
[[ "$TRIVY_IMAGE" == *@sha256:* ]] || { echo 'Scanner must be digest-pinned'; exit 1; }
mkdir -p artifacts/security
output_dir="$(cd artifacts/security && pwd)"
docker pull "$TRIVY_IMAGE"

scan() {
  docker run --rm --user "$(id -u):$(id -g)" \
    -e TRIVY_CACHE_DIR=/tmp/trivy-cache \
    -v "$output_dir:/reports" "$TRIVY_IMAGE" "$@"
}

blocked=0
for kind in runtime migrate; do
  if [ "$kind" = runtime ]; then ref="$RUNTIME_IMAGE"; else ref="$MIGRATION_IMAGE"; fi
  # Scan an archive: the scanner does not need the Docker socket.
  docker save "$ref" -o "$output_dir/$kind.tar"
  scan image --input "/reports/$kind.tar" --format cyclonedx \
    --output "/reports/$kind.cdx.json"
  scan image --input "/reports/$kind.tar" --scanners vuln --format json \
    --output "/reports/$kind.vulnerabilities.json"
  if ! scan image --input "/reports/$kind.tar" --scanners vuln \
      --severity HIGH,CRITICAL --exit-code 1 \
      --output "/reports/$kind.gate.txt"; then
    blocked=1
  fi
done
exit "$blocked"
