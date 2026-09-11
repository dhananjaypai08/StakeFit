#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

TARGET="${1:-https://example.com}"
cd "$ROOT/apps/orchestrator"
exec pnpm exec tsx src/scripts/pay-and-scan.ts "$TARGET" "${2:-}"
