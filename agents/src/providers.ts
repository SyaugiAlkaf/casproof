import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

export type ProviderKind = "anthropic" | "openai" | "offline";

export interface ProviderAgent {
  modelId: string;
  provider: ProviderKind;
  baseUrl?: string;
  apiKeyEnv?: string;
  temperature?: number;
}

export interface GenerateResult {
  text: string;
  source: ProviderKind;
}

const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";

function firstJsonObject(text: string): string | null {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : null;
}

async function anthropicGenerate(agent: ProviderAgent, prompt: string): Promise<string> {
  const apiKey = process.env[agent.apiKeyEnv ?? "ANTHROPIC_API_KEY"];
  if (!apiKey) throw new Error("anthropic api key unset");
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: agent.modelId,
    max_tokens: 256,
    temperature: agent.temperature ?? 0,
    messages: [{ role: "user", content: prompt }],
  });
  const block = res.content.find((b) => b.type === "text") as { text: string } | undefined;
  return block?.text ?? "";
}

// OpenAI-compatible Chat Completions. Covers OpenAI and local servers (Ollama, LM Studio,
// vLLM, llama.cpp, LocalAI). Local servers ignore the key, so a blank bearer is fine.
async function openaiGenerate(agent: ProviderAgent, prompt: string): Promise<string> {
  const baseUrl = (agent.baseUrl ?? DEFAULT_OPENAI_BASE).replace(/\/$/, "");
  const apiKey = (agent.apiKeyEnv ? process.env[agent.apiKeyEnv] : undefined) ?? "";
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: agent.modelId,
      temperature: agent.temperature ?? 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) throw new Error(`openai-compatible ${baseUrl} ${r.status}: ${await r.text()}`);
  const body = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? "";
}

// Returns the parsed JSON object the model emitted, or null to signal the caller should fall
// back to its deterministic valuation. Never throws: a failed/unconfigured provider degrades
// to offline so the demo always runs.
export async function generate(
  agent: ProviderAgent,
  prompt: string
): Promise<{ payload: Record<string, unknown> | null; source: ProviderKind }> {
  if (agent.provider === "offline") return { payload: null, source: "offline" };
  try {
    const text =
      agent.provider === "anthropic" ? await anthropicGenerate(agent, prompt) : await openaiGenerate(agent, prompt);
    const json = firstJsonObject(text);
    if (!json) return { payload: null, source: "offline" };
    return { payload: JSON.parse(json) as Record<string, unknown>, source: agent.provider };
  } catch {
    return { payload: null, source: "offline" };
  }
}

export interface ProviderPing {
  ok: boolean;
  detail: string;
}

// Read-only liveness check for the doctor. Offline always passes; anthropic checks the key is
// present; openai-compatible pings the models endpoint. Never throws.
export async function pingProvider(agent: ProviderAgent): Promise<ProviderPing> {
  if (agent.provider === "offline") return { ok: true, detail: "offline (deterministic, no network)" };
  if (agent.provider === "anthropic") {
    const key = process.env[agent.apiKeyEnv ?? "ANTHROPIC_API_KEY"];
    return key
      ? { ok: true, detail: `anthropic key set (${agent.apiKeyEnv ?? "ANTHROPIC_API_KEY"})` }
      : { ok: false, detail: `anthropic key unset (${agent.apiKeyEnv ?? "ANTHROPIC_API_KEY"}) — will fall back offline` };
  }
  const baseUrl = (agent.baseUrl ?? DEFAULT_OPENAI_BASE).replace(/\/$/, "");
  const apiKey = (agent.apiKeyEnv ? process.env[agent.apiKeyEnv] : undefined) ?? "";
  try {
    const r = await fetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
    return r.ok
      ? { ok: true, detail: `reachable at ${baseUrl}` }
      : { ok: false, detail: `${baseUrl} responded ${r.status} — will fall back offline` };
  } catch (e) {
    return { ok: false, detail: `${baseUrl} unreachable (${(e as Error).message}) — will fall back offline` };
  }
}
