# Integrate Casproof in 5 minutes

Casproof is an on-chain action firewall for AI agents. Before an agent acts on an AI output, it calls `verify_output`; the Casper VM returns `PROCEED` or `BLOCK`. All verification paths converge on the same on-chain registry, so a hash attested by a TypeScript producer is verifiable by a Python consumer or any smart contract.

**Choose your access path:**

| Path | When to use |
|---|---|
| [HTTP /verify](#a-http-verify-curl--any-language) | Any language, quick integration |
| [Python SDK / CLI](#b-python-sdk--cli) | Python agents, scripting |
| [MCP tool](#c-mcp-tool-casproof_verify_output) | MCP-aware agents (Claude, etc.) |
| [On-chain cross-call](#d-on-chain-cross-call-composability) | Smart contracts that must gate payouts |
| [TypeScript casper.ts](#e-typescript-casproolts) | Full TypeScript agent stack |

---

## Prerequisites

1. Clone the repo and set up `.env` (see `.env.example`):

```bash
git clone https://github.com/saugialkaf/casproof
cd casproof
cp .env.example .env   # fill in REGISTRY_CONTRACT_HASH, VAULT_CONTRACT_HASH, CASPER_CHAIN_RPC
```

2. Start the verify server (defaults to sim x402 mode — no CSPR wallet needed):

```bash
cd agents
npm install
npm run x402:server
# Listening at http://localhost:4021/verify
```

Or with Docker:

```bash
docker compose up
```

---

## A. HTTP /verify (curl / any language)

The verify server exposes a single endpoint:

```
GET /verify?hash=<64-hex-output-hash>[&requestId=<request-id>]
```

With `X402_MODE=sim` (default), the server accepts any `x-payment` header value and performs the on-chain read.

### Minimal request

```bash
HASH="$(node -e "
  const b = require('blakejs');
  const payload = {modelId:'claude-opus-4-8',payload:{asset:'PARK-NOTE-001',fairValueUsd:1278000,confidence:0.82}};
  console.log(b.blake2bHex(JSON.stringify(payload,Object.keys(payload).sort()), undefined, 32));
")"

curl -s \
  -H "x-payment: sim" \
  "http://localhost:4021/verify?hash=${HASH}&requestId=rwa-001"
```

Or use the pre-built helper (see `examples/curl_verify.sh`).

### Response shape

```json
{
  "hash": "a3f...1c",
  "attested": true,
  "signer": "0202...aa",
  "trusted": true,
  "source": "claude-opus-4-8",
  "quorum": {
    "quorumReached": true,
    "winningHash": "a3f...1c",
    "agreement": 2
  }
}
```

`attested: false` or `trusted: false` → block the action.

### Full spec

See [`docs/openapi.yaml`](docs/openapi.yaml). Generate a typed client:

```bash
# Python
pip install openapi-python-client
openapi-python-client generate --path docs/openapi.yaml

# TypeScript
npx openapi-typescript docs/openapi.yaml -o types/casproof.d.ts
```

---

## B. Python SDK + CLI

### Install

```bash
pip install -e clients/python   # from repo root
# future: pip install casproof
```

### Library

```python
from casproof import Casproof, output_hash

cp = Casproof(endpoint="http://localhost:4021/verify")

decision = cp.verify_output(
    model_id="claude-opus-4-8",
    prompt="Value PARK-NOTE-001 as of 2026-Q2",
    payload={"asset": "PARK-NOTE-001", "fairValueUsd": 1278000, "confidence": 0.82},
    request_id="rwa-001",
)

if decision.proceed:
    release_payout()
else:
    hold(decision.error or decision.decision)
```

Set `CASPROOF_ENDPOINT` to skip passing `endpoint` every time.

### CLI

```bash
# Hash locally (no network):
casproof hash \
  --model claude-opus-4-8 \
  --prompt "Value PARK-NOTE-001 as of 2026-Q2" \
  --payload '{"asset":"PARK-NOTE-001","fairValueUsd":1278000,"confidence":0.82}'

# Verify on-chain (exit 0 = PROCEED, exit 1 = BLOCK):
casproof verify \
  --endpoint http://localhost:4021/verify \
  --request-id rwa-001 \
  --model claude-opus-4-8 \
  --prompt "Value PARK-NOTE-001 as of 2026-Q2" \
  --payload '{"asset":"PARK-NOTE-001","fairValueUsd":1278000,"confidence":0.82}'
```

See `examples/python_verify_before_pay.py` for a complete agent loop.

---

## C. MCP tool: `casproof_verify_output`

Any MCP-aware agent can call `casproof_verify_output` as a tool — Claude Desktop, Claude Code, or any agent framework with an MCP client.

### Add the server to your MCP config

```json
{
  "mcpServers": {
    "casproof": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/to/casproof/agents/src/mcp.ts"],
      "env": {
        "REGISTRY_CONTRACT_HASH": "hash-<your-registry-hash>",
        "CASPER_CHAIN_RPC": "https://node.testnet.casper.network/rpc",
        "TRUSTED_SIGNERS": "0202...aa,0202...bb"
      }
    }
  }
}
```

Save as `mcp.json` or merge into `~/.claude/mcp.json`. See `examples/mcp.example.json` for a ready file.

### Tool reference

| Tool | Description |
|---|---|
| `casproof_compute_hash` | BLAKE2b-256 fingerprint — no chain access |
| `casproof_verify_output` | On-chain verify; returns `PROCEED`/`BLOCK` |
| `casproof_attest` | Publish attestation (producer key required) |

Typical agent instruction:

> Before executing any action derived from a model output, call `casproof_verify_output` with the output hash or the full `{modelId, prompt, payload}`. If `decision` is `BLOCK`, halt and report tampered or unattested input.

---

## D. On-chain cross-call (composability)

A Casper smart contract can call `require_quorum` on the registry directly, so verify-and-act are atomic in the VM — no off-chain round trip.

### Odra / Rust (consumer contract pattern)

```rust
use odra::prelude::*;

#[odra::module]
pub struct PayoutVault {
    registry: odra::ExternalContractRef<AttestationRegistryRef>,
    threshold: odra::Var<u8>,
}

#[odra::module]
impl PayoutVault {
    pub fn release(&mut self, request_id: String, winning_hash: String) {
        // This call reverts the whole deploy if quorum is not met.
        self.registry.require_quorum(request_id, winning_hash, self.threshold.get_or_default());

        // Only reachable when quorum is satisfied.
        self.transfer_to_caller();
    }
}
```

`require_quorum` is an entry point on `AttestationRegistry` (see `contract/src/lib.rs`). The registry contract hash is passed as a constructor argument; the vault stores it and calls it cross-contract. The `PayoutVault` implementation in this repo is the canonical reference.

---

## E. TypeScript (casper.ts)

All chain calls are isolated in `agents/src/casper.ts`. Import directly in a TypeScript agent:

```typescript
import { findAttestation, readQuorum, readAgreement, isTrusted } from "./casper.js";

async function verifyBeforeAct(outputHash: string, requestId: string) {
  const record = await findAttestation(outputHash);
  if (!record || !isTrusted(record.signer)) return "BLOCK";

  const winner = await readQuorum(requestId);
  if (winner !== outputHash) return "BLOCK";

  const agreement = await readAgreement(requestId, outputHash);
  return agreement >= Number(process.env.QUORUM_THRESHOLD ?? 2) ? "PROCEED" : "BLOCK";
}
```

Required env vars: `CASPER_CHAIN_RPC`, `REGISTRY_CONTRACT_HASH`, `TRUSTED_SIGNERS`.

---

## Configure your models (including local models)

### casproof.models.json

Quorum models can be declared in a `casproof.models.json` file or via `QUORUM_MODELS` env:

```json
[
  {
    "id": "claude-opus-4-8",
    "type": "anthropic",
    "model": "claude-opus-4-8"
  },
  {
    "id": "llama3-local",
    "type": "ollama",
    "baseUrl": "http://localhost:11434",
    "model": "llama3"
  },
  {
    "id": "mistral-lmstudio",
    "type": "openai_compat",
    "baseUrl": "http://localhost:1234/v1",
    "model": "mistral-7b-instruct"
  }
]
```

See `examples/ollama_models.json` for a ready local-model panel.

### Env alternative

```
QUORUM_MODELS=claude-opus-4-8:./keys/producer1.pem,llama3-local:./keys/producer2.pem
```

Each entry is `modelId:keyPath`. The producer agent calls each model and attests independently; a consumer checks that `agreement >= QUORUM_THRESHOLD` before proceeding.

---

## Run it

### Docker

```bash
docker compose up          # starts verify server + UI
# verify server: http://localhost:4021/verify
# dashboard:     http://localhost:3000
```

### npm (agents only)

```bash
cd agents
npm install
npm run doctor             # checks env, connectivity, contract reachability
npm run x402:server        # verify endpoint
npm run producer           # run one quorum attestation cycle
npm run consumer           # trigger autonomous release
npm run demo               # tamper demo (producer poisons → consumer blocks)
```

### Full setup from scratch (testnet)

```bash
cd agents
npm run keygen             # ./keys/producer_secret_key.pem
npm run keygen:quorum      # ./keys/quorum_*.pem
npm run fund               # faucet — only works once per key
npm run deploy             # deploy registry contract → REGISTRY_CONTRACT_HASH
npm run deploy:vault       # deploy payout vault → VAULT_CONTRACT_HASH
npm run setup              # register trusted signers + set quorum threshold
```
