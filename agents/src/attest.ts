import blakejs from "blakejs";

const { blake2bHex } = blakejs;

export interface AgentOutput {
  modelId: string;
  prompt: string;
  payload: unknown;
}

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export function outputHash(output: AgentOutput): string {
  return blake2bHex(canonical(output.payload), undefined, 32);
}

export function promptHash(prompt: string): string {
  return blake2bHex(prompt, undefined, 32);
}
