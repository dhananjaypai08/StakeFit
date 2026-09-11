#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${SUBGRAPH_STUDIO_DEPLOY_KEY:-}" ]]; then
  echo "SUBGRAPH_STUDIO_DEPLOY_KEY is missing in .env" >&2
  exit 1
fi

cd "$ROOT/subgraph"
pnpm exec graph codegen
pnpm exec graph build
exec pnpm exec graph deploy stakefit --deploy-key "$SUBGRAPH_STUDIO_DEPLOY_KEY"
