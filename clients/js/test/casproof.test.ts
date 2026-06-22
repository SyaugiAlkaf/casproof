import { test } from "node:test";
import assert from "node:assert/strict";

import { agreementKey, canonical, outputHash, promptHash, stateItemKey } from "../src/hashing.js";
import { decide } from "../src/client.js";

test("outputHash matches the cross-language vector", () => {
  const payload = { asset: "PARK-NOTE-001", fairValueUsd: 1234567, confidence: 0.82 };
  assert.equal(outputHash(payload), "83784d8eadfb07e174eab9591ca4d4cd8a059053a5b564a196b3b2eae6003a08");
});

test("promptHash matches the blake2b vector", () => {
  assert.equal(promptHash("hello"), "324dcf027dd4a30a932c441f365a25e86b173defa4b8e58948253471b81b72cf");
});

test("stateItemKey matches the Odra derivation vector", () => {
  assert.equal(stateItemKey(1, "abc123"), "9f2378c44002082211ef5af96b30c62e63952032a00db869e75e6cc95c9b0428");
});

test("canonical is independent of key order", () => {
  assert.equal(canonical({ a: 1, b: 2 }), canonical({ b: 2, a: 1 }));
  assert.equal(canonical({ x: { p: 1, q: 2 } }), canonical({ x: { q: 2, p: 1 } }));
});

test("outputHash is independent of input key order", () => {
  const a = { asset: "PARK-NOTE-001", fairValueUsd: 1234567, confidence: 0.82 };
  const b = { confidence: 0.82, fairValueUsd: 1234567, asset: "PARK-NOTE-001" };
  assert.equal(outputHash(a), outputHash(b));
});

test("agreement and quorum keys are distinct namespaces", () => {
  const out = "a".repeat(64);
  assert.notEqual(stateItemKey(5, agreementKey("r", out)), stateItemKey(6, "r"));
});

test("block when unattested", () => {
  const d = decide("h", undefined, { hash: "h", attested: false });
  assert.equal(d.decision, "BLOCK");
  assert.equal(d.proceed, false);
});

test("proceed on quorum match", () => {
  const data = {
    hash: "h",
    attested: true,
    trusted: true,
    quorum: { reached: true, matchesWinner: true, agreement: 2, winningHash: "h" },
  };
  const d = decide("h", "req1", data);
  assert.equal(d.decision, "PROCEED");
  assert.equal(d.agreement, 2);
  assert.equal(d.quorumReached, true);
});

test("block when hash is not the quorum winner", () => {
  const data = {
    hash: "h",
    attested: true,
    trusted: true,
    quorum: { reached: true, matchesWinner: false, agreement: 2, winningHash: "other" },
  };
  const d = decide("h", "req1", data);
  assert.equal(d.decision, "BLOCK");
});

test("error response blocks", () => {
  const d = decide("h", undefined, { hash: "h", error: "registry not configured" });
  assert.equal(d.decision, "BLOCK");
  assert.equal(d.error, "registry not configured");
});

test("untrusted signer blocks even when attested", () => {
  const d = decide("h", undefined, { hash: "h", attested: true, trusted: false });
  assert.equal(d.decision, "BLOCK");
});

test("attested and trusted with no request id proceeds", () => {
  const d = decide("h", undefined, { hash: "h", attested: true, trusted: true, signer: "account-hash-x" });
  assert.equal(d.decision, "PROCEED");
  assert.equal(d.signer, "account-hash-x");
});
