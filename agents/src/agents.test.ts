import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { canonical, outputHash, promptHash, AgentOutput } from "./attest.js";
import { stateItemKey, isTrusted, findAttestation, explorerTxUrl } from "./casper.js";
import { challenge, encodePayment, decodePayment, paymentRequirements, X402_VERSION } from "./x402.js";

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
  assert.equal(outputHash(feed), "83784d8eadfb07e174eab9591ca4d4cd8a059053a5b564a196b3b2eae6003a08");
});

test("promptHash matches the blake2b-256 vector", () => {
  assert.equal(promptHash("hello"), "324dcf027dd4a30a932c441f365a25e86b173defa4b8e58948253471b81b72cf");
});

test("stateItemKey matches the Odra storage-key derivation vector", () => {
  const k = stateItemKey(1, "abc123");
  assert.equal(k.length, 64);
  assert.equal(k, "9f2378c44002082211ef5af96b30c62e63952032a00db869e75e6cc95c9b0428");
});

test("distinct output hashes derive distinct dictionary keys", () => {
  assert.notEqual(stateItemKey(1, "aaa"), stateItemKey(1, "bbb"));
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
    assert.deepEqual(tools.sort(), ["casproof_attest", "casproof_compute_hash", "casproof_verify"]);
    const res = await client.callTool({
      name: "casproof_compute_hash",
      arguments: { modelId: "claude-opus-4-8", prompt: "p", payload: { asset: "PARK-NOTE-001", fairValueUsd: 1234567, confidence: 0.82 } },
    });
    const out = JSON.parse((res.content as Array<{ text: string }>)[0].text);
    assert.equal(out.outputHash, "83784d8eadfb07e174eab9591ca4d4cd8a059053a5b564a196b3b2eae6003a08");
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
