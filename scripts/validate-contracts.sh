#!/usr/bin/env bash
set -euo pipefail
for spec in decision manifest economy content; do
  npx @redocly/cli lint "contracts/api/$spec.yaml"
done
echo "contracts validated."
