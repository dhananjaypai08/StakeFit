#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

if [[ -z "${SEPOLIA_RPC_URL:-}" ]]; then
  echo "SEPOLIA_RPC_URL is missing in .env" >&2
  exit 1
fi
if [[ -z "${DEPLOYER_PRIVATE_KEY:-}" || "${DEPLOYER_PRIVATE_KEY}" == "0x" ]]; then
  echo "DEPLOYER_PRIVATE_KEY is missing in .env" >&2
  exit 1
fi

cd "$ROOT/contracts"
# --slow: one tx at a time. Required for EIP-7702 delegated wallets on Infura.
exec forge script script/Deploy.s.sol --rpc-url "$SEPOLIA_RPC_URL" --broadcast --slow
