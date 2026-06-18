import "dotenv/config";
import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentOutput, outputHash, promptHash } from "./attest.js";
import { attest, findAttestation, isTrusted, loadKey, explorerTxUrl } from "./casper.js";

const PRODUCER_KEY_PATH = process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem";

const feedShape = {
  modelId: z.string().describe("the model that produced the output, e.g. claude-opus-4-8"),
  prompt: z.string().describe("the prompt the model answered"),
  payload: z.record(z.string(), z.any()).describe("the model's structured output (e.g. an RWA valuation)"),
};

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }], structuredContent: obj as Record<string, unknown> };
}

const server = new McpServer({ name: "casproof", version: "0.1.0" });

server.registerTool(
  "casproof_compute_hash",
  {
    title: "Compute attestation hash",
    description:
      "Deterministically fingerprint an AI agent output (BLAKE2b-256 over canonical JSON). Returns the output hash and prompt hash used by the Casproof registry. No chain access.",
    inputSchema: feedShape,
    annotations: { readOnlyHint: true },
  },
  async ({ modelId, prompt, payload }) => {
    const feed: AgentOutput = { modelId, prompt, payload };
    return text({ outputHash: outputHash(feed), promptHash: promptHash(prompt) });
  }
);

server.registerTool(
  "casproof_verify",
  {
    title: "Verify an AI output on-chain",
    description:
      "Check whether an AI agent output is attested on the Casper registry before acting on it. Pass either a precomputed `hash`, or the full {modelId, prompt, payload} to fingerprint and look up. Returns whether a payout-consuming agent should proceed.",
    inputSchema: {
      hash: z.string().optional().describe("a precomputed 64-hex output hash"),
      modelId: z.string().optional(),
      prompt: z.string().optional(),
      payload: z.record(z.string(), z.any()).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ hash, modelId, prompt, payload }) => {
    const resolved =
      hash ?? (modelId && prompt && payload ? outputHash({ modelId, prompt, payload }) : undefined);
    if (!resolved) {
      return text({ error: "provide either `hash` or all of {modelId, prompt, payload}" });
    }
    try {
      const record = await findAttestation(resolved);
      if (!record) {
        return text({ hash: resolved, attested: false, decision: "BLOCK", reason: "no attestation on-chain (tampered or unattested)" });
      }
      const trusted = isTrusted(record.signer);
      return text({
        hash: resolved,
        attested: true,
        signer: record.signer,
        trusted,
        source: record.source,
        decision: trusted ? "PROCEED" : "BLOCK",
      });
    } catch (e) {
      return text({ hash: resolved, error: e instanceof Error ? e.message : String(e) });
    }
  }
);

server.registerTool(
  "casproof_attest",
  {
    title: "Attest an AI output on-chain",
    description:
      "Publish a tamper-proof attestation of an AI agent output to the Casper registry as a real testnet transaction. Requires a funded, registry-trusted producer key. Returns the transaction hash and explorer link.",
    inputSchema: feedShape,
    annotations: { readOnlyHint: false },
  },
  async ({ modelId, prompt, payload }) => {
    if (!existsSync(PRODUCER_KEY_PATH)) {
      return text({ error: `no producer key at ${PRODUCER_KEY_PATH} — run \`npm run keygen\` and fund it first` });
    }
    const feed: AgentOutput = { modelId, prompt, payload };
    const oh = outputHash(feed);
    try {
      const key = loadKey(PRODUCER_KEY_PATH);
      const r = await attest(key, oh, modelId, promptHash(prompt));
      return text({ outputHash: oh, txHash: r.txHash, cost: r.cost, explorer: r.explorer });
    } catch (e) {
      return text({ outputHash: oh, error: e instanceof Error ? e.message : String(e) });
    }
  }
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("casproof MCP server ready (stdio) — tools: casproof_compute_hash, casproof_verify, casproof_attest");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
