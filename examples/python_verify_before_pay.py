"""
Agent loop: verify an AI output before releasing a payout.

Requires:
  pip install -e clients/python    (from casproof repo root)
  Casproof verify server running:  cd agents && npm run x402:server
  CASPROOF_ENDPOINT env var or pass endpoint= to Casproof().

Run:
  python examples/python_verify_before_pay.py
"""

import os
import sys

from casproof import Casproof, Decision

ENDPOINT = os.environ.get("CASPROOF_ENDPOINT", "http://localhost:4021/verify")
REQUEST_ID = os.environ.get("CASPROOF_REQUEST_ID", "rwa-001")

PROMPT = "Value PARK-NOTE-001 as of 2026-Q2"
PAYLOAD = {"asset": "PARK-NOTE-001", "fairValueUsd": 1_278_000, "confidence": 0.82}
MODEL_ID = "claude-opus-4-8"


def release_payout(decision: Decision) -> None:
    print(f"Payout released. Agreement: {decision.agreement} signers.")


def hold_payout(reason: str) -> None:
    print(f"Payout held. Reason: {reason}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    cp = Casproof(endpoint=ENDPOINT)

    print(f"Verifying output for request '{REQUEST_ID}' ...")
    decision = cp.verify_output(
        model_id=MODEL_ID,
        prompt=PROMPT,
        payload=PAYLOAD,
        request_id=REQUEST_ID,
    )

    print(f"Decision: {decision.decision}")
    print(f"  attested:  {decision.attested}")
    print(f"  agreement: {decision.agreement}")
    if decision.error:
        print(f"  error:     {decision.error}")

    if decision.proceed:
        release_payout(decision)
    else:
        hold_payout(decision.error or decision.decision)


if __name__ == "__main__":
    main()
