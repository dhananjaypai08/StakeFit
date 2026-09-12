#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

COORDINATOR="${VRF_COORDINATOR:-0x9DdfaCa8183c41ad55329BdeeD9F6A8d53168B1B}"
RPC="${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL missing}"
KEY="${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY missing}"

if [[ -n "${VRF_SUBSCRIPTION_ID:-}" ]]; then
  echo "VRF_SUBSCRIPTION_ID is already set: $VRF_SUBSCRIPTION_ID"
  exit 0
fi

echo "Creating VRF v2.5 subscription on Sepolia..."
cast send "$COORDINATOR" "createSubscription()" --rpc-url "$RPC" --private-key "$KEY"
echo
echo "Read SubscriptionCreated from the tx logs, then paste:"
echo "VRF_SUBSCRIPTION_ID=<id>"
echo "VRF_KEY_HASH=0x787d74caea10b2b357790d5b5247c2f63d1d91572a9846f780606e4d953677ae"
echo
echo "Fund the subscription with Sepolia ETH or LINK at https://vrf.chain.link"
