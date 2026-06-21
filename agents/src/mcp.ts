import "dotenv/config";
import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AgentOutput, outputHash, promptHash } from "./attest.js";
import { attest, findAttestation, isTrusted, loadKey, readQuorum, readAgreement, requestId } from "./casper.js";

const PRODUCER_KEY_PATH = process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem";

const feedShape = {
  modelId: z.string().describe("the model that produced the output, e.g. claude-opus-4-8"),
  prompt: z.string().describe("the prompt the model answered"),
  payload: z.record(z.string(), z.any()).describe("the model's structured output (e.g. an RWA valuation)"),
};

function text(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }], structuredContent: obj as Record<string, unknown> };
}

const server = new McpServer({ name: "casproof", version: "0.2.0" });

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
  "casproof_verify_output",
  {
    title: "Verify an AI output's integrity on-chain",
    description:
      "The integrity primitive any Casper agent can call before acting: is this the genuine, quorum-attested output of a model on a prompt? Pass a precomputed `hash`, or the full {modelId, prompt, payload} to fingerprint. Add `requestId` to also check k-of-n quorum. Returns the attestation + quorum proof and a PROCEED/BLOCK decision.",
    inputSchema: {
      hash: z.string().optional().describe("a precomputed 64-hex output hash"),
      modelId: z.string().optional(),
      prompt: z.string().optional(),
      payload: z.record(z.string(), z.any()).optional(),
      requestId: z.string().optional().describe("the quorum request id; enables k-of-n quorum lookup"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ hash, modelId, prompt, payload, requestId: reqIdArg }) => {
    const resolved = hash ?? (modelId && prompt && payload ? outputHash({ modelId, prompt, payload }) : undefined);
    if (!resolved) {
      return text({ error: "provide either `hash` or all of {modelId, prompt, payload}" });
    }
    try {
      const record = await findAttestation(resolved);
      const quorum = reqIdArg
        ? await (async () => {
            const winner = await readQuorum(reqIdArg);
            return { reached: winner === resolved, outputHash: winner, agreement: winner ? await readAgreement(reqIdArg, resolved) : 0 };
          })()
        : undefined;
      if (!record) {
        return text({ hash: resolved, attested: false, quorum, decision: "BLOCK", reason: "no attestation on-chain (tampered or unattested)" });
      }
      const trusted = isTrusted(record.signer);
      const proceed = trusted && (!reqIdArg || quorum?.reached === true);
      return text({
        hash: resolved,
        attested: true,
        signer: record.signer,
        trusted,
        source: record.source,
        quorum,
        decision: proceed ? "PROCEED" : "BLOCK",
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
      "Publish a tamper-proof attestation of an AI agent output to the Casper registry as a real testnet transaction. Requires a funded, registry-trusted producer key. `requestId` groups votes for a k-of-n quorum (defaults to the prompt's request id). Returns the transaction hash and explorer link.",
    inputSchema: { ...feedShape, requestId: z.string().optional().describe("quorum request id (defaults to a hash of the prompt)") },
    annotations: { readOnlyHint: false },
  },
  async ({ modelId, prompt, payload, requestId: reqIdArg }) => {
    if (!existsSync(PRODUCER_KEY_PATH)) {
      return text({ error: `no producer key at ${PRODUCER_KEY_PATH} — run \`npm run keygen\` and fund it first` });
    }
    const feed: AgentOutput = { modelId, prompt, payload };
    const oh = outputHash(feed);
    const reqId = reqIdArg ?? requestId(prompt);
    try {
      const key = loadKey(PRODUCER_KEY_PATH);
      const r = await attest(key, reqId, oh, modelId, promptHash(prompt));
      return text({ requestId: reqId, outputHash: oh, txHash: r.txHash, cost: r.cost, explorer: r.explorer });
    } catch (e) {
      return text({ requestId: reqId, outputHash: oh, error: e instanceof Error ? e.message : String(e) });
    }
  }
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error("casproof MCP server ready (stdio) — tools: casproof_compute_hash, casproof_verify_output, casproof_attest");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
