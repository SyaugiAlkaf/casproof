import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { AgentOutput, outputHash, promptHash } from "./attest.js";
import { attest, loadKey } from "./casper.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const RWA_PROMPT =
  "You price a tokenized parking-garage revenue note. Given occupancy 78%, " +
  "daily gross $14,200, 30-day trailing. Return strict JSON only: " +
  '{"asset":"PARK-NOTE-001","fairValueUsd":<number>,"confidence":<0..1>}';

export async function produceFeed(): Promise<AgentOutput> {
  const res = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 256,
    messages: [{ role: "user", content: RWA_PROMPT }],
  });
  const text = res.content.find((b) => b.type === "text");
  const raw = (text as { text: string } | undefined)?.text ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`model did not return JSON: ${raw.slice(0, 120)}`);
  const json = JSON.parse(match[0]);
  return { modelId: "claude-opus-4-8", prompt: RWA_PROMPT, payload: json };
}

async function main() {
  const output = await produceFeed();
  const oh = outputHash(output);
  const ph = promptHash(output.prompt);
  console.log("feed payload:", JSON.stringify(output.payload));
  console.log("output hash :", oh);

  const key = loadKey(process.env.PRODUCER_KEY_PATH ?? "./keys/producer_secret_key.pem");
  console.log("attesting on-chain ...");
  const r = await attest(key, oh, output.modelId, ph);
  console.log("attested. tx:", r.txHash);
  console.log("explorer  :", r.explorer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
