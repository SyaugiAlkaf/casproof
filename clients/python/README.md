# casproof (Python)

A zero-dependency Python client + CLI for **verify-before-act** on Casproof: before an agent
trusts an AI output, check on-chain that the output is attested (and quorum-attested) and get a
`PROCEED` / `BLOCK` decision. The output hash is computed identically to the on-chain registry, so
hashes resolve across the TypeScript agents, the contract, and Python.

## Install

```bash
pip install -e clients/python      # from the repo root
# or, once published: pip install casproof
```

Standard library only — no third-party dependencies.

## Library

```python
from casproof import Casproof, output_hash

# Fingerprint an AI output exactly as the registry does (no network):
h = output_hash({"asset": "PARK-NOTE-001", "fairValueUsd": 1278000, "confidence": 0.82})

# Verify before acting (reads on-chain state via the Casproof /verify API):
cp = Casproof(endpoint="http://localhost:3000/api/verify")
d = cp.verify_output(
    model_id="claude-opus-4-8",
    prompt="Value PARK-NOTE-001 ...",
    payload={"asset": "PARK-NOTE-001", "fairValueUsd": 1278000, "confidence": 0.82},
    request_id="rwa-001",
)
if d.proceed:
    release_payout()      # d.decision == "PROCEED", d.agreement == k
else:
    hold(d.error or d.decision)   # tampered / under-quorum / unattested
```

`Casproof` reads the endpoint from `$CASPROOF_ENDPOINT` if not passed. Point it at the Next.js
`/api/verify` route or any deployment of the Casproof verify API.

## CLI

```bash
# Compute hashes locally (no network):
casproof hash --model claude-opus-4-8 --prompt "Value ..." --payload '{"asset":"PARK-NOTE-001","fairValueUsd":1278000,"confidence":0.82}'

# Verify on-chain (exit code 0 = PROCEED, 1 = BLOCK):
casproof verify --endpoint http://localhost:3000/api/verify --request-id rwa-001 \
  --model claude-opus-4-8 --prompt "Value ..." --payload '{"asset":"PARK-NOTE-001","fairValueUsd":1278000,"confidence":0.82}'
```

## Tests

```bash
cd clients/python && python -m unittest discover -s tests -v
```

The hashing functions (`output_hash`, `prompt_hash`, `state_item_key`) are verified against the same
cross-language vectors used by the TypeScript suite, so a hash produced here matches one produced by
the agents or read from the contract.

> Direct node-RPC reads (no verify server) follow the same storage-key derivation as
> `agents/src/casper.ts` and are validated against the live testnet contract; the HTTP client above is
> the supported path today.
