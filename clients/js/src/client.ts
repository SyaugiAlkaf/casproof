import { outputHash, promptHash } from "./hashing.js";

export const DEFAULT_ENDPOINT = process.env.CASPROOF_ENDPOINT ?? "http://localhost:3000/api/verify";

export interface QuorumState {
  reached?: boolean;
  winningHash?: string;
  agreement?: number;
  threshold?: number;
  matchesWinner?: boolean;
}

export interface VerifyResponse {
  hash: string;
  attested?: boolean;
  signer?: string;
  trusted?: boolean;
  quorum?: QuorumState;
  error?: string;
  note?: string;
}

export interface Decision {
  hash: string;
  attested: boolean;
  decision: "PROCEED" | "BLOCK";
  proceed: boolean;
  quorumReached?: boolean;
  agreement?: number;
  signer?: string;
  error?: string;
  raw: VerifyResponse | Record<string, unknown>;
}

export class Casproof {
  readonly endpoint: string;
  readonly timeoutMs: number;

  constructor(endpoint: string = DEFAULT_ENDPOINT, timeoutMs = 15000) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
  }

  hash(payload: unknown): string {
    return outputHash(payload);
  }

  promptHash(prompt: string): string {
    return promptHash(prompt);
  }

  async verifyOutput(
    modelId: string,
    prompt: string,
    payload: unknown,
    requestId?: string
  ): Promise<Decision> {
    const body: Record<string, unknown> = { feed: { modelId, prompt, payload } };
    if (requestId) body.requestId = requestId;
    return decide(outputHash(payload), requestId, await this.post(body));
  }

  async verifyHash(outHash: string, requestId?: string): Promise<Decision> {
    const body: Record<string, unknown> = { hash: outHash };
    if (requestId) body.requestId = requestId;
    return decide(outHash, requestId, await this.post(body));
  }

  verify_output(modelId: string, prompt: string, payload: unknown, requestId?: string): Promise<Decision> {
    return this.verifyOutput(modelId, prompt, payload, requestId);
  }

  verify_hash(outHash: string, requestId?: string): Promise<Decision> {
    return this.verifyHash(outHash, requestId);
  }

  private async post(body: Record<string, unknown>): Promise<VerifyResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as VerifyResponse) : ({ hash: "" } as VerifyResponse);
      if (!res.ok && !data.error) {
        return { ...data, error: `verify endpoint ${res.status}` };
      }
      return data;
    } catch (e) {
      return { hash: "", error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function decide(
  outHash: string,
  requestId: string | undefined,
  data: VerifyResponse
): Decision {
  if (data.error) {
    return { hash: outHash, attested: false, decision: "BLOCK", proceed: false, error: data.error, raw: data };
  }
  const attested = Boolean(data.attested);
  const trusted = data.trusted ?? true;
  const quorum = data.quorum;
  if (requestId && quorum && typeof quorum === "object") {
    const proceed = attested && Boolean(trusted) && Boolean(quorum.matchesWinner);
    return {
      hash: outHash,
      attested,
      decision: proceed ? "PROCEED" : "BLOCK",
      proceed,
      quorumReached: quorum.reached,
      agreement: quorum.agreement,
      signer: data.signer,
      raw: data,
    };
  }
  const proceed = attested && Boolean(trusted);
  return {
    hash: outHash,
    attested,
    decision: proceed ? "PROCEED" : "BLOCK",
    proceed,
    signer: data.signer,
    raw: data,
  };
}
