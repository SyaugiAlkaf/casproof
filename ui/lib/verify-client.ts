import type { FeedInput, VerifyResult } from "./types";

export async function verifyFeed(input: { feed?: FeedInput; hash?: string; requestId?: string }): Promise<VerifyResult> {
  const res = await fetch("/api/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  const data = (await res.json()) as VerifyResult & { error?: string };
  if (!res.ok && !data.hash) {
    throw new Error(data.error ?? `verify failed (${res.status})`);
  }
  return data;
}
