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

const DEFAULT_REQUEST_ID = process.env.REQUEST_ID ?? process.env.NEXT_PUBLIC_REQUEST_ID ?? "";
// The on-chain threshold is the k that setup.ts wrote with set_quorum; surface it for the
// display denominator (the PAY/BLOCK decision uses quorum_output, not this number).
const QUORUM_THRESHOLD = Number(process.env.QUORUM_THRESHOLD ?? process.env.NEXT_PUBLIC_QUORUM_THRESHOLD ?? 0) || 0;

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
  signer?: string;
  trusted?: boolean;
  source?: "chain" | "cspr.cloud";
  explorer?: string;
  quorum?: QuorumInfo;
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
    const res: VerifyResponse = {
      hash,
      attested: false,
      error: e instanceof Error ? e.message : "verification read failed"
    };
    return NextResponse.json(res);
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
