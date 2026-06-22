import blakejs from "blakejs";

const { blake2bHex, blake2b } = blakejs;

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

export function outputHash(payload: unknown): string {
  return blake2bHex(canonical(payload), undefined, 32);
}

export function promptHash(prompt: string): string {
  return blake2bHex(prompt, undefined, 32);
}

export function agreementKey(requestId: string, outHash: string): string {
  return `${requestId}#${outHash}`;
}

// Odra storage dictionary item key: blake2b256(u32_be(field) ++ u32_le(len) ++ utf8(key)).
// Mirrors agents/src/casper.ts so direct on-chain reads target the right item.
export function stateItemKey(fieldIndex: number, key: string): string {
  const idx = Buffer.alloc(4);
  idx.writeUInt32BE(fieldIndex, 0);
  const utf8 = Buffer.from(key, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(utf8.length, 0);
  const preimage = Buffer.concat([idx, len, utf8]);
  return Buffer.from(blake2b(preimage, undefined, 32)).toString("hex");
}
