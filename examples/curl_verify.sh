#!/usr/bin/env bash
# Verify an AI output hash against the Casproof registry via curl.
#
# Prerequisites:
#   - Casproof verify server running: cd agents && npm run x402:server
#   - Set CASPROOF_ENDPOINT if not using the default localhost address.
#
# Usage:
#   ./examples/curl_verify.sh <64-hex-hash> [request-id]
#
# Example (compute hash first with the Python CLI, then verify):
#   HASH=$(casproof hash --model claude-opus-4-8 \
#            --prompt "Value PARK-NOTE-001 as of 2026-Q2" \
#            --payload '{"asset":"PARK-NOTE-001","fairValueUsd":1278000,"confidence":0.82}')
#   ./examples/curl_verify.sh "$HASH" rwa-001

set -euo pipefail

ENDPOINT="${CASPROOF_ENDPOINT:-http://localhost:4021}"
HASH="${1:-}"
REQUEST_ID="${2:-}"

if [[ -z "$HASH" ]]; then
  echo "Usage: $0 <64-hex-hash> [request-id]" >&2
  exit 1
fi

if [[ ! "$HASH" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Error: hash must be 64 lowercase hex characters." >&2
  exit 1
fi

URL="${ENDPOINT}/verify?hash=${HASH}"
if [[ -n "$REQUEST_ID" ]]; then
  URL="${URL}&requestId=${REQUEST_ID}"
fi

echo "Verifying: ${URL}" >&2

RESPONSE=$(curl -sf \
  -H "x-payment: sim" \
  -H "accept: application/json" \
  "$URL")

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

ATTESTED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('attested','false'))" 2>/dev/null || echo "false")
TRUSTED=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('trusted','false'))" 2>/dev/null || echo "false")

if [[ "$ATTESTED" == "True" && "$TRUSTED" == "True" ]]; then
  echo "" >&2
  echo "Decision: PROCEED" >&2
  exit 0
else
  echo "" >&2
  echo "Decision: BLOCK" >&2
  exit 1
fi
