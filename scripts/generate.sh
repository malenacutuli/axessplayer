#!/usr/bin/env bash
# Generate typed clients from the OpenAPI specs into contracts/types/generated.
set -euo pipefail
out=contracts/types/generated
mkdir -p "$out"
for spec in decision manifest economy content; do
  npx openapi-typescript "contracts/api/$spec.yaml" -o "$out/$spec.ts"
done
# Event types: contracts/events/events.md is a markdown event schema, not OpenAPI.
# W0 task 5: hand-maintain contracts/types/events.ts to mirror events.md until a generator exists.
echo "generated OpenAPI types into $out. Remember event types (events.ts) per W0 task 5."
