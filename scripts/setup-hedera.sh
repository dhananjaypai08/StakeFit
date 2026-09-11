#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${HEDERA_ACCOUNT_ID:-}" || -z "${HEDERA_PRIVATE_KEY:-}" ]]; then
  echo "HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set in the root .env" >&2
  exit 1
fi

cd "$ROOT/packages/hedera"
pnpm run create-token
pnpm run create-topic
if [[ -z "${SCAN_PAYTO_ACCOUNT:-}" || "${SCAN_PAYTO_ACCOUNT}" == "${HEDERA_ACCOUNT_ID}" ]]; then
  pnpm run create-merchant
fi
