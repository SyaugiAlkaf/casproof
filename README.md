# Casproof

Verifiable proof of AI agent outputs on the Casper Network.

An autonomous agent that produces a result — a price feed, a risk score, a valuation — can now publish a cryptographic attestation of that result on-chain: which model produced it, under which prompt, signed by which agent, at which time. Any other agent can check that attestation before trusting the result and acting on it.

## The problem

Casper's thesis is to be the trust layer for the agent economy. But on a chain that sells *verifiable AI*, there is currently no open, on-chain way to verify what an AI agent actually produced. Agents consume each other's outputs — feeds, scores, signals — with no way to know whether an output is the genuine model result or has been swapped, replayed, or tampered with. The first agent that acts on a poisoned feed loses real money.

## How it works

1. **Producer agent** generates an output (here: an RWA valuation for a tokenized parking-revenue note), hashes it deterministically, and calls `attest(output_hash, model_id, prompt_hash)` on the registry contract. The attestation is a real on-chain transaction emitting an `OutputAttested` event.
2. **Consumer agent** — a DeFi agent about to release a payout against that feed — recomputes the hash and calls `verify(output_hash)`. It releases funds only if the output is attested by a trusted signer. A tampered or unattested feed is refused and the refusal is logged.

The verification read can be metered with x402, so an oracle operator earns per verified read while agents pay only for what they consume.

## Components

- `contract/` — `AttestationRegistry`, an Odra (Rust → WASM) smart contract deployed to Casper Testnet.
- `agents/` — TypeScript producer and consumer agents (`casper-js-sdk`, Anthropic API).
- `ui/` — dashboard to verify an output and watch the live attestation / refusal flow.

## Quick start

```bash
# contract
cd contract && cargo odra test && cargo odra build -b casper

# agents
cd agents && npm install
cp ../.env.example ../.env   # fill in keys + deployed contract hash
npm run producer
npm run consumer
```

## Roadmap

- Portable agent reputation derived from attestation history
- x402-metered public verification endpoint
- Attestation of model reasoning traces, not just final outputs
- SDK package so any Casper agent can attest and verify in two calls

## License

Apache-2.0
