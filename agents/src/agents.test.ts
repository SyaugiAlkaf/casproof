import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, outputHash, promptHash, AgentOutput } from "./attest.js";
import { stateItemKey, isTrusted, findAttestation, explorerTxUrl } from "./casper.js";

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

test(
  "findAttestation reads the live registry and reports an unknown hash as unattested",
  { skip: !process.env.REGISTRY_CONTRACT_HASH ? "REGISTRY_CONTRACT_HASH not set (contract not deployed)" : false },
  async () => {
    const record = await findAttestation("0".repeat(64));
    assert.equal(record, null);
  }
);
