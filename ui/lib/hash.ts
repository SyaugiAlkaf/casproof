import blakejs from "blakejs";

const { blake2bHex } = blakejs;

export interface AgentOutput {
  modelId: string;
  prompt: string;
  payload: unknown;
}

const MAX_DEPTH = 32;

export function canonical(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new Error("payload nesting too deep");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, depth + 1)).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k], depth + 1)}`)
    .join(",")}}`;
}

export function outputHash(output: AgentOutput): string {
  return blake2bHex(canonical(output.payload), undefined, 32);
}

export function promptHash(prompt: string): string {
  return blake2bHex(prompt, undefined, 32);
}
