# casproof (JS / TS)

A small JS/TS client + CLI for **verify-before-act** on Casproof: before an agent trusts an AI
output, check on-chain that the output is attested (and quorum-attested) and get a `PROCEED` /
`BLOCK` decision. The output hash is computed identically to the on-chain registry, so hashes
resolve across the TypeScript agents, the contract, and the Python client.

## Install

```bash
npm install casproof
```

One runtime dependency (`blakejs` — Node's stdlib cannot produce a 32-byte BLAKE2b). Network calls
use the global `fetch`, so Node 18+ is required.

## Library

```ts
import { Casproof, outputHash } from "casproof";

// Fingerprint an AI output exactly as the registry does (no network):
const h = outputHash({ asset: "PARK-NOTE-001", fairValueUsd: 1278000, confidence: 0.82 });

// Verify before acting (reads on-chain state via the Casproof /verify API):
const cp = new Casproof("http://localhost:3000/api/verify");
const d = await cp.verifyOutput(
  "claude-opus-4-8",
  "Value PARK-NOTE-001 ...",
  { asset: "PARK-NOTE-001", fairValueUsd: 1278000, confidence: 0.82 },
  "rwa-001"
);

if (d.proceed) {
  releasePayout();           // d.decision === "PROCEED", d.agreement === k
} else {
  hold(d.error ?? d.decision); // tampered / under-quorum / unattested
}
```

`new Casproof()` reads the endpoint from `$CASPROOF_ENDPOINT` if none is passed. Point it at the
Next.js `/api/verify` route or any deployment of the Casproof verify API. `verifyOutput` /
`verifyHash` are also available as `verify_output` / `verify_hash` to mirror the Python client.

## CLI

```bash
# Compute hashes locally (no network):
npx casproof hash --model claude-opus-4-8 --prompt "Value ..." \
  --payload '{"asset":"PARK-NOTE-001","fairValueUsd":1278000,"confidence":0.82}'

# Verify on-chain (exit code 0 = PROCEED, 1 = BLOCK):
npx casproof verify --endpoint http://localhost:3000/api/verify --request-id rwa-001 \
  --model claude-opus-4-8 --prompt "Value ..." \
  --payload '{"asset":"PARK-NOTE-001","fairValueUsd":1278000,"confidence":0.82}'
```

## Tests

```bash
cd clients/js && npm install && npm test
```

The hashing functions (`outputHash`, `promptHash`, `stateItemKey`) are verified against the same
cross-language vectors used by the Python suite, so a hash produced here matches one produced by the
agents, the Python client, or read from the contract.
