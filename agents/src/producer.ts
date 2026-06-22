import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { AgentOutput, outputHash, promptHash } from "./attest.js";
import { attest, loadKey, requestId } from "./casper.js";
import { generate, ProviderKind } from "./providers.js";

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
  provider: ProviderKind;
  baseUrl?: string;
  apiKeyEnv?: string;
  temperature?: number;
}

interface ModelsConfig {
  threshold?: number;
  agents: Array<Partial<ModelAgent> & { modelId: string; keyPath: string }>;
}

const DEFAULT_AGENTS: ModelAgent[] = [
  { modelId: "claude-opus-4-8", keyPath: "./keys/producer_secret_key.pem", provider: "anthropic" },
  { modelId: "claude-sonnet-4-6", keyPath: "./keys/producer2_secret_key.pem", provider: "anthropic" },
  { modelId: "claude-haiku-4-5-20251001", keyPath: "./keys/producer3_secret_key.pem", provider: "anthropic" },
];

function configPath(): string | null {
  const explicit = process.env.CASPROOF_MODELS;
  if (explicit) return existsSync(explicit) ? explicit : null;
  return existsSync("./casproof.models.json") ? "./casproof.models.json" : null;
}

export function loadModelsConfig(): ModelsConfig | null {
  const path = configPath();
  if (!path) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as ModelsConfig;
  if (!Array.isArray(parsed.agents) || parsed.agents.length === 0) {
    throw new Error(`${path}: "agents" must be a non-empty array`);
  }
  return parsed;
}

// Resolution order: (a) JSON config at $CASPROOF_MODELS or ./casproof.models.json,
// (b) env QUORUM_MODELS="modelId:keyPath,...", (c) the 3 built-in Anthropic defaults.
export function modelAgents(): ModelAgent[] {
  const config = loadModelsConfig();
  if (config) {
    return config.agents.map((a) => ({
      modelId: a.modelId.trim(),
      keyPath: a.keyPath.trim(),
      provider: a.provider ?? "anthropic",
      baseUrl: a.baseUrl,
      apiKeyEnv: a.apiKeyEnv,
      temperature: a.temperature,
    }));
  }
  const env = process.env.QUORUM_MODELS;
  if (env) {
    return env.split(",").map((entry) => {
      const [modelId, keyPath] = entry.split(":");
      return { modelId: modelId.trim(), keyPath: (keyPath ?? "").trim(), provider: "anthropic" as ProviderKind };
    });
  }
  return DEFAULT_AGENTS;
}

// Quorum threshold k. Config file wins, then QUORUM_THRESHOLD, else the agent count.
export function quorumThreshold(agents = modelAgents()): number {
  const config = loadModelsConfig();
  if (config?.threshold) return config.threshold;
  if (process.env.QUORUM_THRESHOLD) return Number(process.env.QUORUM_THRESHOLD);
  return agents.length;
}

// Runs one model agent over the request through its configured provider, then normalizes the
// answer onto the published spec so honest agents converge. Any provider failure (or an
// offline agent) degrades to the deterministic valuation so the whole flow runs for free.
// `tamper` simulates a compromised/substituted agent returning a bad output.
export async function produceFeed(agent: ModelAgent, opts: { tamper?: boolean } = {}): Promise<AgentOutput> {
  const inputs = opts.tamper ? { ...RWA_INPUTS, dailyGrossUsd: 99_999 } : RWA_INPUTS;
  const prompt = RWA_PROMPT + (opts.tamper ? " (use daily gross $99,999)" : "");
  const { payload: raw } = await generate(agent, prompt);
  const payload = raw ? normalizeToSpec(raw, inputs) : valuate(inputs);
  return { modelId: agent.modelId, prompt: RWA_PROMPT, payload };
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
    const feed = await produceFeed(agent, { tamper: tamperLast && i === agents.length - 1 });
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
