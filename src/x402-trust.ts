import { createHash, createPublicKey, verify } from "node:crypto";

export const X402_TRUST_PREVIEW = "https://x402-trust.com/v1/x402-trust-preview";
export const X402_TRUST_DOCS = "https://x402-trust.com/llms.txt";
export const X402_TRUST_KEYS_URL = "https://x402-trust.com/.well-known/x402-trust-keys.json";

// Pinned from the provider's public key document on 2026-10-01. Never resolve
// keys from signature.publicKeys; that field is only a discovery hint.
export const PINNED_X402_TRUST_KEYS: Readonly<Record<string, string>> = Object.freeze({
  "x402trust-2026-09-20": "FbiZ6B-erkpIVdE50Kx2AKxdVqVhLtjHPrC3WPa98FA",
  "x402trust-2026-09": "ykdtI-8Qvs137NGUY82ioTl2TRkgW8nNxxTt9ITp4TI",
  "x402trust-2026-08": "i4jrHKvmZ98-IGgseDfMTjMV4lAaLAgk-EnBeRIJQ5Y",
});

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export interface X402TrustSignature {
  alg: "Ed25519";
  canon: "RFC8785";
  hash: "SHA-256";
  keyId: string;
  digest: string;
  value: string;
  publicKeys?: string;
}

export interface X402TrustEnvelope extends Record<string, unknown> {
  $schema: string;
  schemaVersion: string;
  schemaType: string;
  signature: X402TrustSignature;
}

export interface VerifiedTrustEvidence {
  source: "x402-trust";
  envelope: X402TrustEnvelope;
  signature: X402TrustSignature;
  keyId: string;
  digest: string;
  rawResponseBase64: string;
  rawResponseSha256: string;
  provenance: {
    sourceUrl: typeof X402_TRUST_PREVIEW;
    capturedAt: string;
    keyDocumentUrl: typeof X402_TRUST_KEYS_URL;
    keyId: string;
    schemaType: string;
    schemaVersion: string;
    verified: true;
  };
}

export type PinnedKeyMap = Readonly<Record<string, string>>;

/** RFC 8785 JSON Canonicalization Scheme for JSON.parse-compatible values. */
export function canonicalizeJcs(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JCS does not allow non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalizeJcs).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort(); // JS sort uses UTF-16 code unit ordering.
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalizeJcs(object[key])}`).join(",")}}`;
  }
  throw new Error("Value is not representable in JCS JSON");
}

function decodeBase64Url(value: unknown, name: string): Buffer {
  if (typeof value !== "string" || !BASE64URL.test(value) || value.includes("=")) {
    throw new Error(`Invalid ${name} base64url encoding`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error(`Non-canonical ${name} base64url encoding`);
  return decoded;
}

function signatureFrom(envelope: Record<string, unknown>): X402TrustSignature {
  const sig = envelope.signature;
  if (!sig || typeof sig !== "object" || Array.isArray(sig)) throw new Error("Missing x402 Trust signature object");
  const s = sig as Record<string, unknown>;
  if (s.alg !== "Ed25519" || s.canon !== "RFC8785" || s.hash !== "SHA-256") throw new Error("Unsupported x402 Trust signature contract");
  if (typeof s.keyId !== "string" || !s.keyId || typeof s.digest !== "string" || !SHA256_HEX.test(s.digest)) throw new Error("Invalid x402 Trust signature metadata");
  if (typeof s.value !== "string") throw new Error("Missing x402 Trust signature value");
  decodeBase64Url(s.value, "signature");
  return s as unknown as X402TrustSignature;
}

/** Verify a complete signed response using a caller-pinned map (production defaults to hard-coded keys). */
export function verifyX402TrustResponse(
  rawResponse: string | Uint8Array,
  options: { pinnedKeys?: PinnedKeyMap; sourceUrl?: string; capturedAt?: string } = {},
): VerifiedTrustEvidence {
  const rawBytes = typeof rawResponse === "string" ? Buffer.from(rawResponse, "utf8") : Buffer.from(rawResponse);
  let parsed: unknown;
  try { parsed = JSON.parse(rawBytes.toString("utf8")); }
  catch { throw new Error("Invalid x402 Trust JSON response"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("x402 Trust response must be a JSON object");
  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.$schema !== "string" || typeof envelope.schemaType !== "string" || typeof envelope.schemaVersion !== "string") {
    throw new Error("Missing x402 Trust schema envelope");
  }
  const signature = signatureFrom(envelope);
  const keys = options.pinnedKeys ?? PINNED_X402_TRUST_KEYS;
  const encodedKey = keys[signature.keyId];
  if (!encodedKey) throw new Error(`Unknown pinned x402 Trust keyId: ${signature.keyId}`);
  const publicKey = decodeBase64Url(encodedKey, "pinned public key");
  if (publicKey.length !== 32) throw new Error("Invalid pinned Ed25519 public key length");

  const { signature: _excluded, ...unsigned } = envelope;
  const canonicalBytes = Buffer.from(canonicalizeJcs(unsigned), "utf8");
  const digest = createHash("sha256").update(canonicalBytes).digest("hex");
  if (digest !== signature.digest) throw new Error("x402 Trust signature digest mismatch");

  const signatureBytes = decodeBase64Url(signature.value, "signature");
  if (signatureBytes.length !== 64) throw new Error("Invalid Ed25519 signature length");
  const keyObject = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]), format: "der", type: "spki" });
  if (!verify(null, canonicalBytes, keyObject, signatureBytes)) throw new Error("Invalid x402 Trust Ed25519 signature");

  const capturedAt = options.capturedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error("Invalid x402 Trust capture timestamp");
  const sourceUrl = options.sourceUrl ?? X402_TRUST_PREVIEW;
  if (sourceUrl !== X402_TRUST_PREVIEW) throw new Error("Only the free x402 Trust preview is enabled");
  return {
    source: "x402-trust", envelope: envelope as X402TrustEnvelope, signature,
    keyId: signature.keyId, digest,
    rawResponseBase64: rawBytes.toString("base64"),
    rawResponseSha256: createHash("sha256").update(rawBytes).digest("hex"),
    provenance: {
      sourceUrl: X402_TRUST_PREVIEW, capturedAt, keyDocumentUrl: X402_TRUST_KEYS_URL,
      keyId: signature.keyId, schemaType: envelope.schemaType, schemaVersion: envelope.schemaVersion, verified: true,
    },
  };
}

/** GET-only free preview capture. Paid /v1/x402-trust routes are intentionally unreachable here. */
export async function fetchX402TrustPreview(options: { fetchImpl?: typeof fetch; capturedAt?: string } = {}): Promise<VerifiedTrustEvidence> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(X402_TRUST_PREVIEW, { method: "GET", redirect: "error" });
  if (!response.ok) throw new Error(`x402 Trust preview returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  return verifyX402TrustResponse(bytes, { sourceUrl: X402_TRUST_PREVIEW, capturedAt: options.capturedAt });
}

/** Reverify preserved snapshot bytes during offline replay; provenance cannot override signature checks. */
export function reverifyX402TrustEvidence(evidence: VerifiedTrustEvidence): VerifiedTrustEvidence {
  if (!evidence || evidence.source !== "x402-trust" || evidence.provenance?.verified !== true || evidence.provenance.sourceUrl !== X402_TRUST_PREVIEW) {
    throw new Error("Invalid x402 Trust evidence provenance");
  }
  const verified = verifyX402TrustResponse(Buffer.from(evidence.rawResponseBase64, "base64"), {
    sourceUrl: evidence.provenance.sourceUrl, capturedAt: evidence.provenance.capturedAt,
  });
  if (verified.rawResponseSha256 !== evidence.rawResponseSha256 || verified.digest !== evidence.digest || verified.keyId !== evidence.keyId) {
    throw new Error("x402 Trust snapshot provenance mismatch");
  }
  return verified;
}
