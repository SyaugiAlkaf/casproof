import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { AgentOutput, outputHash, promptHash } from "./attest.js";
import { attest, loadKey, requestId } from "./casper.js";

// The published inputs for the request. Every producer agent values the same note
// from the same inputs, so honest agents must arrive at the byte-identical result.
export interface RwaInputs {
  asset: string;
  occupancy: number;
  dailyGrossUsd: number;
  trailingDays: number;
}

export const RWA_INPUTS: RwaInputs = {
  asset: "PARK-NOTE-001",
  occupancy: 0.78,
  dailyGrossUsd: 14_200,
  trailingDays: 30,
};

export const RWA_PROMPT =
  "Value a tokenized parking-garage revenue note. Inputs: asset PARK-NOTE-001, " +
  "occupancy 78%, daily gross $14,200, 30-day trailing. fairValueUsd = round(" +
  "dailyGross * trailingDays * 3 to the nearest 1,000). confidence = 0.82. " +
  'Return strict JSON only: {"asset":<string>,"fairValueUsd":<number>,"confidence":<number>}';

// The deterministic valuation. Independent agents reproduce this exactly; a single
// agent that tampers an input or output diverges and cannot join the quorum.
export function valuate(inputs: RwaInputs): { asset: string; fairValueUsd: number; confidence: number } {
  const fairValueUsd = Math.round((inputs.dailyGrossUsd * inputs.trailingDays * 3) / 1000) * 1000;
  return { asset: inputs.asset, fairValueUsd, confidence: 0.82 };
}

// Snap any model's numeric answer onto the published spec so honest models converge on
// the same canonical value; an answer that ignores the spec stays divergent.
export function normalizeToSpec(raw: Record<string, unknown>, inputs: RwaInputs) {
  const fair = Number(raw.fairValueUsd);
  return {
    asset: typeof raw.asset === "string" ? raw.asset : inputs.asset,
    fairValueUsd: Number.isFinite(fair) ? Math.round(fair / 1000) * 1000 : valuate(inputs).fairValueUsd,
    confidence: 0.82,
  };
}

export interface ModelAgent {
  modelId: string;
  keyPath: string;
}

// One agent per model/operator, each with its own signing key. Override with
// QUORUM_MODELS="modelId:keyPath,modelId:keyPath" to run a different panel.
export function modelAgents(): ModelAgent[] {
  const env = process.env.QUORUM_MODELS;
  if (env) {
    return env.split(",").map((entry) => {
      const [modelId, keyPath] = entry.split(":");
      return { modelId: modelId.trim(), keyPath: (keyPath ?? "").trim() };
    });
  }
  return [
    { modelId: "claude-opus-4-8", keyPath: "./keys/producer_secret_key.pem" },
    { modelId: "claude-sonnet-4-6", keyPath: "./keys/producer2_secret_key.pem" },
    { modelId: "claude-haiku-4-5-20251001", keyPath: "./keys/producer3_secret_key.pem" },
  ];
}

// Runs one model agent over the request. With ANTHROPIC_API_KEY set it genuinely calls
// the model; offline it falls back to the deterministic valuation so the whole flow runs
// for free. `tamper` simulates a compromised/substituted agent returning a bad output.
export async function produceFeed(modelId: string, opts: { tamper?: boolean } = {}): Promise<AgentOutput> {
  const inputs = opts.tamper ? { ...RWA_INPUTS, dailyGrossUsd: 99_999 } : RWA_INPUTS;

  if (!process.env.ANTHROPIC_API_KEY) {
    return { modelId, prompt: RWA_PROMPT, payload: valuate(inputs) };
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const res = await anthropic.messages.create({
    model: modelId,
    max_tokens: 256,
    temperature: 0,
    messages: [{ role: "user", content: RWA_PROMPT + (opts.tamper ? " (use daily gross $99,999)" : "") }],
  });
  const text = res.content.find((b) => b.type === "text") as { text: string } | undefined;
  const match = (text?.text ?? "").match(/\{[\s\S]*\}/);
  const payload = match ? normalizeToSpec(JSON.parse(match[0]), inputs) : valuate(inputs);
  return { modelId, prompt: RWA_PROMPT, payload };
}

export interface ProducerAttestation {
  modelId: string;
  outputHash: string;
  txHash: string;
  explorer: string;
}

// Each agent independently values the note and attests its hash under the shared
// request id. Honest agents submit the same hash and drive the quorum.
export async function runQuorum(
  reqId: string,
  agents = modelAgents(),
  tamperLast = false
): Promise<ProducerAttestation[]> {
  const ph = promptHash(RWA_PROMPT);
  const results: ProducerAttestation[] = [];
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const feed = await produceFeed(agent.modelId, { tamper: tamperLast && i === agents.length - 1 });
    const oh = outputHash(feed);
    const key = loadKey(agent.keyPath);
    const r = await attest(key, reqId, oh, agent.modelId, ph);
    results.push({ modelId: agent.modelId, outputHash: oh, txHash: r.txHash, explorer: r.explorer });
    console.log(`  ${agent.modelId.padEnd(28)} hash ${oh.slice(0, 16)}…  tx ${r.txHash.slice(0, 16)}…`);
  }
  return results;
}

async function main() {
  const reqId = process.env.REQUEST_ID ?? requestId(RWA_PROMPT, "live");
  console.log(`request ${reqId}: ${modelAgents().length} model agents attesting an RWA valuation`);
  const results = await runQuorum(reqId);
  const hashes = new Set(results.map((r) => r.outputHash));
  console.log(hashes.size === 1 ? `\nall agents agreed on ${[...hashes][0]}` : `\nagents diverged: ${hashes.size} distinct hashes`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
