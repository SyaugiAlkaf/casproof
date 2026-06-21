import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { canonical, outputHash, promptHash, AgentOutput } from "./attest.js";
import { stateItemKey, isTrusted, findAttestation, explorerTxUrl, requestId } from "./casper.js";
import { valuate, normalizeToSpec, RWA_INPUTS } from "./producer.js";
import { challenge, encodePayment, decodePayment, paymentRequirements, X402_VERSION } from "./x402.js";

const HASH_VECTOR = "83784d8eadfb07e174eab9591ca4d4cd8a059053a5b564a196b3b2eae6003a08";

test("canonical is independent of key order", () => {
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
  assert.equal(canonical({ x: { p: 1, q: 2 } }), canonical({ x: { q: 2, p: 1 } }));
});

test("outputHash is a stable 32-byte hash of the payload", () => {
  const feed: AgentOutput = {
    modelId: "claude-opus-4-8",
    prompt: "p",
    payload: { asset: "PARK-NOTE-001", fairValueUsd: 1234567, confidence: 0.82 },
  };
  assert.equal(outputHash(feed), HASH_VECTOR);
});

test("promptHash matches the blake2b-256 vector", () => {
  assert.equal(promptHash("hello"), "324dcf027dd4a30a932c441f365a25e86b173defa4b8e58948253471b81b72cf");
});

test("requestId is deterministic for a prompt and salts with a suffix", () => {
  assert.equal(requestId("the prompt"), requestId("the prompt"));
  assert.notEqual(requestId("the prompt"), requestId("the prompt", "run2"));
  assert.match(requestId("x"), /^[0-9a-f]{16}$/);
});

test("the valuation is deterministic so honest agents agree byte-for-byte", () => {
  assert.deepEqual(valuate(RWA_INPUTS), valuate(RWA_INPUTS));
  assert.equal(outputHash({ modelId: "a", prompt: "p", payload: valuate(RWA_INPUTS) }), outputHash({ modelId: "b", prompt: "p", payload: valuate(RWA_INPUTS) }));
});

test("a tampered input produces a different hash (breaks quorum)", () => {
  const honest = outputHash({ modelId: "m", prompt: "p", payload: valuate(RWA_INPUTS) });
  const tampered = outputHash({ modelId: "m", prompt: "p", payload: valuate({ ...RWA_INPUTS, dailyGrossUsd: 99_999 }) });
  assert.notEqual(honest, tampered);
});

test("model answers snap onto the published spec so honest models converge", () => {
  const a = normalizeToSpec({ asset: "PARK-NOTE-001", fairValueUsd: 1278123, confidence: 0.7 }, RWA_INPUTS);
  const b = normalizeToSpec({ asset: "PARK-NOTE-001", fairValueUsd: 1277888, confidence: 0.95 }, RWA_INPUTS);
  assert.deepEqual(a, b);
});

test("stateItemKey matches the Odra storage-key derivation vector", () => {
  const k = stateItemKey(1, "abc123");
  assert.equal(k.length, 64);
  assert.equal(k, "9f2378c44002082211ef5af96b30c62e63952032a00db869e75e6cc95c9b0428");
});

test("agreement and quorum dictionary keys are distinct namespaces", () => {
  const req = "req1";
  const hash = "a".repeat(64);
  assert.notEqual(stateItemKey(5, `${req}#${hash}`), stateItemKey(6, req));
});

test("isTrusted trusts any signer when no allow-list is set", () => {
  assert.equal(isTrusted("account-hash-deadbeef"), true);
});

test("explorerTxUrl builds a testnet deploy link", () => {
  assert.match(explorerTxUrl("abc"), /cspr\.live\/deploy\/abc$/);
});

test("x402 challenge offers a casper exact payment requirement", () => {
  const c = challenge("http://x/verify?hash=ab");
  assert.equal(c.x402Version, X402_VERSION);
  assert.equal(c.accepts[0].scheme, "exact");
  assert.match(c.accepts[0].network, /^casper:/);
  assert.equal(c.accepts[0].resource, "http://x/verify?hash=ab");
});

test("x402 payment payload round-trips through the X-PAYMENT header", () => {
  const reqs = paymentRequirements("http://x/verify?hash=ab");
  const payload = { x402Version: X402_VERSION, scheme: reqs.scheme, network: reqs.network, payload: { nonce: "42" } };
  assert.deepEqual(decodePayment(encodePayment(payload)), payload);
});

test("x402 server returns 402 unpaid, opens the gate once paid (sim mode)", async () => {
  process.env.X402_MODE = "sim";
  const { server } = await import("./server.js");
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;
  const url = `http://localhost:${port}/verify?hash=${"a".repeat(64)}`;
  try {
    const unpaid = await fetch(url);
    assert.equal(unpaid.status, 402);
    const offer = (await unpaid.json()) as { accepts: Array<{ scheme: string }> };
    assert.equal(offer.accepts[0].scheme, "exact");

    const payment = { x402Version: X402_VERSION, scheme: "exact", network: "casper:casper-test", payload: { nonce: "1" } };
    const paid = await fetch(url, { headers: { "x-payment": encodePayment(payment) } });
    assert.notEqual(paid.status, 402); // payment accepted; past the paywall (chain read may 500 without a deployed contract)
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("mcp server exposes the casproof tools and computes a correct hash", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/mcp.ts"] });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.deepEqual(tools.sort(), ["casproof_attest", "casproof_compute_hash", "casproof_verify_output"]);
    const res = await client.callTool({
      name: "casproof_compute_hash",
      arguments: { modelId: "claude-opus-4-8", prompt: "p", payload: { asset: "PARK-NOTE-001", fairValueUsd: 1234567, confidence: 0.82 } },
    });
    const out = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    assert.equal(out.outputHash, HASH_VECTOR);
  } finally {
    await client.close();
  }
});

test("mcp verify_output always returns the computed hash before any chain read", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const transport = new StdioClientTransport({ command: "npx", args: ["tsx", "src/mcp.ts"] });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  try {
    const res = await client.callTool({
      name: "casproof_verify_output",
      arguments: { modelId: "claude-opus-4-8", prompt: "p", payload: { asset: "PARK-NOTE-001", fairValueUsd: 1234567, confidence: 0.82 } },
    });
    const out = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    assert.equal(out.hash, HASH_VECTOR);
  } finally {
    await client.close();
  }
});

test(
  "findAttestation reads the live registry and reports an unknown hash as unattested",
  { skip: !process.env.REGISTRY_CONTRACT_HASH ? "REGISTRY_CONTRACT_HASH not set (contract not deployed)" : false },
  async () => {
    const record = await findAttestation("0".repeat(64));
    assert.equal(record, null);
  }
);
