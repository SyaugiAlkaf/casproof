import { NextResponse } from "next/server";
import { outputHash, type AgentOutput } from "@/lib/hash";
import {
  contractConfigured,
  findAttestation,
  isTrusted,
  explorerContractUrl,
  readQuorum,
  readAgreement
} from "@/lib/casper";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_REQUEST_ID = process.env.REQUEST_ID ?? process.env.NEXT_PUBLIC_REQUEST_ID ?? "823d1427b2bdfbae-mqsyp55n";
// The on-chain threshold is the k that setup.ts wrote with set_quorum; surface it for the
// display denominator (the PAY/BLOCK decision uses quorum_output, not this number).
const QUORUM_THRESHOLD = Number(process.env.QUORUM_THRESHOLD ?? process.env.NEXT_PUBLIC_QUORUM_THRESHOLD ?? 2) || 2;

const MAX_BODY_BYTES = 32 * 1024;

// Best-effort fixed-window rate limit. In-memory, single-instance only — resets on redeploy and
// does not coordinate across serverless instances. A real deployment fronts this with an edge limiter.
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 20;
const rateBuckets = new Map<string, { count: number; reset: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now > b.reset) {
    rateBuckets.set(ip, { count: 1, reset: now + RATE_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > RATE_MAX;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

interface VerifyBody {
  feed?: { modelId: string; prompt: string; payload: unknown };
  hash?: string;
  requestId?: string;
}

interface QuorumInfo {
  reached: boolean;
  winningHash: string | null;
  agreement: number;
  threshold: number;
  matchesWinner: boolean;
}

interface VerifyResponse {
  hash: string;
  attested: boolean;
  chainError?: boolean;
  signer?: string;
  trusted?: boolean;
  source?: "chain" | "cspr.cloud";
  explorer?: string;
  quorum?: QuorumInfo;
  note?: string;
  error?: string;
}

export async function POST(req: Request) {
  if (rateLimited(clientIp(req))) {
    return NextResponse.json({ error: "rate limit exceeded" }, { status: 429 });
  }

  const declaredLen = Number(req.headers.get("content-length") ?? 0);
  if (declaredLen > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "request body too large" }, { status: 413 });
  }

  let body: VerifyBody;
  try {
    body = JSON.parse(raw) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  let hash: string | null;
  try {
    hash = resolveHash(body);
  } catch {
    return NextResponse.json({ error: "payload could not be hashed" }, { status: 400 });
  }
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

  const reqId = (body.requestId ?? DEFAULT_REQUEST_ID).trim();

  try {
    const [record, quorum] = await Promise.all([findAttestation(hash), readQuorumInfo(reqId, hash)]);
    const res: VerifyResponse = {
      hash,
      attested: Boolean(record),
      explorer: explorerContractUrl(),
      ...(quorum ? { quorum } : {})
    };
    if (record) {
      res.signer = record.signer;
      res.trusted = isTrusted(record.signer);
      res.source = record.source;
    }
    return NextResponse.json(res);
  } catch (e) {
    // Keep node URL + contract hash server-side; the client gets a generic message.
    console.error("[verify] chain read failed:", e);
    const res: VerifyResponse = {
      hash,
      attested: false,
      chainError: true,
      error: "verification read failed"
    };
    return NextResponse.json(res, { status: 502 });
  }
}

async function readQuorumInfo(reqId: string, hash: string): Promise<QuorumInfo | undefined> {
  if (!reqId) return undefined;
  const [winningHash, agreement] = await Promise.all([readQuorum(reqId), readAgreement(reqId, hash)]);
  return {
    reached: winningHash !== null,
    winningHash,
    agreement,
    threshold: QUORUM_THRESHOLD,
    matchesWinner: winningHash !== null && winningHash === hash
  };
}

function resolveHash(body: VerifyBody): string | null {
  if (body.hash) return body.hash.trim().toLowerCase();
  if (body.feed) {
    const feed = body.feed as AgentOutput;
    return outputHash(feed);
  }
  return null;
}
