import { createPublicKey, verify } from "node:crypto";

export const X402_TRUST_PREVIEW = "https://x402-trust.com/v1/x402-trust-preview";
export const X402_TRUST_DOCS = "https://x402-trust.com/llms.txt";

export interface SignedTrustEnvelope {
  payload: unknown;
  signature: string;
  publicKey: string;
  algorithm: "Ed25519";
  canonicalization?: string;
}

export interface VerifiedTrustEvidence {
  source: "x402-trust";
  payload: unknown;
  signature: string;
  publicKey: string;
  verified: true;
}

/**
 * Provider-neutral verification primitive for x402 Trust snapshots.
 *
 * The live response field names/canonicalization are intentionally NOT guessed.
 * Callers must extract the exact signed payload bytes according to the provider's
 * published machine-readable contract, then pass those bytes here.
 */
export function verifyEd25519Evidence(
  canonicalPayload: Uint8Array,
  signature: Uint8Array,
  publicKey: string | Buffer,
): boolean {
  const key = typeof publicKey === "string"
    ? createPublicKey(publicKey)
    : createPublicKey({ key: publicKey, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Expected Ed25519 public key");
  return verify(null, canonicalPayload, key, signature);
}

export function acceptVerifiedTrustEvidence(
  envelope: SignedTrustEnvelope,
  canonicalPayload: Uint8Array,
  signatureBytes: Uint8Array,
): VerifiedTrustEvidence {
  if (envelope.algorithm !== "Ed25519") throw new Error("Unsupported trust signature algorithm");
  if (!verifyEd25519Evidence(canonicalPayload, signatureBytes, envelope.publicKey)) {
    throw new Error("Invalid x402 Trust signature");
  }
  return {
    source: "x402-trust",
    payload: envelope.payload,
    signature: envelope.signature,
    publicKey: envelope.publicKey,
    verified: true,
  };
}
