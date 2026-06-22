import argparse
import json
import sys

from .client import DEFAULT_ENDPOINT, Casproof
from .hashing import output_hash, prompt_hash


def _payload(raw: str):
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        sys.exit(f"--payload must be valid JSON: {e}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="casproof", description="Verify-before-act for AI agent outputs on Casper.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    h = sub.add_parser("hash", help="compute the output hash + prompt hash (no network)")
    h.add_argument("--model", required=True)
    h.add_argument("--prompt", required=True)
    h.add_argument("--payload", required=True, help="the model output as a JSON string")

    v = sub.add_parser("verify", help="check an output on-chain and print a PROCEED/BLOCK decision")
    v.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    v.add_argument("--request-id", default=None)
    v.add_argument("--hash", default=None, help="a precomputed 64-hex output hash")
    v.add_argument("--model")
    v.add_argument("--prompt")
    v.add_argument("--payload", help="the model output as a JSON string")

    args = parser.parse_args(argv)

    if args.cmd == "hash":
        payload = _payload(args.payload)
        print(json.dumps({"outputHash": output_hash(payload), "promptHash": prompt_hash(args.prompt)}, indent=2))
        return 0

    client = Casproof(endpoint=args.endpoint)
    if args.hash:
        d = client.verify_hash(args.hash, request_id=args.request_id)
    elif args.model and args.prompt and args.payload is not None:
        d = client.verify_output(args.model, args.prompt, _payload(args.payload), request_id=args.request_id)
    else:
        sys.exit("verify needs either --hash or all of --model/--prompt/--payload")
    print(json.dumps({"hash": d.hash, "attested": d.attested, "decision": d.decision,
                      "quorumReached": d.quorum_reached, "agreement": d.agreement,
                      "signer": d.signer, "error": d.error}, indent=2))
    return 0 if d.proceed else 1


if __name__ == "__main__":
    raise SystemExit(main())
