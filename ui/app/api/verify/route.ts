import { NextResponse } from "next/server";
import { outputHash, type AgentOutput } from "@/lib/hash";
import { contractConfigured, findAttestation, isTrusted, explorerContractUrl } from "@/lib/casper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface VerifyBody {
  feed?: { modelId: string; prompt: string; payload: unknown };
  hash?: string;
}

interface VerifyResponse {
  hash: string;
  attested: boolean;
  signer?: string;
  trusted?: boolean;
  source?: "chain" | "cspr.cloud";
  explorer?: string;
  note?: string;
  error?: string;
}

export async function POST(req: Request) {
  let body: VerifyBody;
  try {
    body = (await req.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  const hash = resolveHash(body);
  if (!hash) {
    return NextResponse.json(
      { error: "provide either { feed: {modelId, prompt, payload} } or { hash: '<64hex>' }" },
      { status: 400 }
    );
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return NextResponse.json({ error: "hash must be 64 lowercase hex chars" }, { status: 400 });
  }

  if (!contractConfigured()) {
    const res: VerifyResponse = { hash, attested: false, note: "registry contract not configured" };
    return NextResponse.json(res);
  }

  try {
    const record = await findAttestation(hash);
    if (!record) {
      const res: VerifyResponse = { hash, attested: false };
      return NextResponse.json(res);
    }
    const res: VerifyResponse = {
      hash,
      attested: true,
      signer: record.signer,
      trusted: isTrusted(record.signer),
      source: record.source,
      explorer: explorerContractUrl()
    };
    return NextResponse.json(res);
  } catch (e) {
    const res: VerifyResponse = {
      hash,
      attested: false,
      error: e instanceof Error ? e.message : "verification read failed"
    };
    return NextResponse.json(res);
  }
}

function resolveHash(body: VerifyBody): string | null {
  if (body.hash) return body.hash.trim().toLowerCase();
  if (body.feed) {
    const feed = body.feed as AgentOutput;
    return outputHash(feed);
  }
  return null;
}
