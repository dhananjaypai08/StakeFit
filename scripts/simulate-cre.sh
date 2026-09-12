#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "OPENROUTER_API_KEY is missing in .env" >&2
  exit 1
fi
if [[ -z "${SEPOLIA_RPC_URL:-}" ]]; then
  echo "SEPOLIA_RPC_URL is missing in .env" >&2
  exit 1
fi

if [[ -z "${CRE_ETH_PRIVATE_KEY:-}" && -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
  CRE_ETH_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY#0x}"
fi
if [[ -z "${STAKEFIT_RUBRIC:-}" ]]; then
  STAKEFIT_RUBRIC='[{"category":"Sensitive data exposure","weight":1.0,"denyThreshold":8}]'
fi

CRE_ENV="$(mktemp)"
trap 'rm -f "$CRE_ENV"' EXIT
{
  cat "$ROOT/.env"
  echo
  echo "CRE_ETH_PRIVATE_KEY=${CRE_ETH_PRIVATE_KEY}"
  echo "CRE_OPENROUTER_API_KEY=${OPENROUTER_API_KEY}"
  echo "CRE_STAKEFIT_RUBRIC=${STAKEFIT_RUBRIC}"
  echo "SEPOLIA_RPC_URL=${SEPOLIA_RPC_URL}"
} > "$CRE_ENV"

cd "$ROOT/packages/cre/audit-firewall"
if [[ ! -x node_modules/.bin/cre-compile ]]; then
  bun install
fi

cd "$ROOT/packages/cre"
cre workflow simulate workout-ingest \
  --target staging-settings \
  --non-interactive \
  --trigger-index 0 \
  --skip-type-checks \
  --env "$CRE_ENV"

cre workflow simulate audit-firewall \
  --target staging-settings \
  --non-interactive \
  --trigger-index 0 \
  --skip-type-checks \
  --env "$CRE_ENV"
