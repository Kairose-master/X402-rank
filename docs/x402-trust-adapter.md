# x402 Trust adapter

This adapter is intentionally **optional** and evidence-oriented.

## Why

The current live X402-rank pipeline uses the CDP Bazaar catalog as its candidate universe and joins x402 Doctor route-level history onto those candidates. Therefore, an endpoint outside Bazaar is not an "unknown-quality Bazaar candidate"; it is outside that run's candidate set.

x402 Trust may provide a complementary source with broader endpoint coverage, repeated observations, on-chain settlement evidence, and signed machine-readable responses. This adapter verifies the free preview only; it does not add those reports to the Bazaar candidate set or current score.

## Evidence semantics

Keep these claims separate:

- **payability / operational observation**: evidence that an endpoint presented a usable payment flow at observation time;
- **on-chain settlement**: evidence that a payment settled on the referenced chain;
- **independent buyer demand**: NOT established by settlement count alone;
- **successful service delivery**: NOT established by settlement alone;
- **task quality / correctness**: NOT established by payment or a provider signature.

Raw settlement volume must not become a reputation shortcut. Self-purchases and correlated wallets remain possible.

## Signed snapshots

X402-rank's existing snapshot SHA-256 binds a report to captured bytes, but does not authenticate who produced those bytes. A valid upstream Ed25519 signature can add source provenance.

The live contract is implemented in `src/x402-trust.ts`:

1. Parse the complete response envelope and remove the top-level `signature` object.
2. Canonicalize the remaining JSON with RFC 8785 JCS and compare its SHA-256 hex digest with `signature.digest`.
3. Decode the unpadded base64url `signature.value` and verify pure Ed25519 over the canonical UTF-8 bytes.
4. Resolve `signature.keyId` only through `PINNED_X402_TRUST_KEYS`; the map contains current `x402trust-2026-09-20` and the published retired keys. The response's `signature.publicKeys` is never followed.

The public signature vector and a captured free preview live in `test/fixtures/x402-trust/`. The preview is a signed response. Its outer `x402-trust-preview` envelope is schema 1.0.0, and each embedded `x402-trust` report is schema 2.0.0. Tests cover payload/digest tampering, unknown and wrong keys, missing or malformed signatures, contract mismatch, JCS-vs-raw-byte behavior, and offline replay.

`fetchX402TrustPreview` is a fixed-URL GET with redirects disabled. The paid `POST /v1/x402-trust` route is not implemented. Verified snapshots retain the exact raw response bytes (base64), raw-byte SHA-256, signed envelope, source URL, capture time, pinned-key document URL, key ID and schema metadata. `rankSnapshot` reverifies this artifact during replay and passes it through to the report without turning Doctor operational trust into settlement evidence, buyer demand, or task outcome.

## Intended architecture

```text
candidate sources
  Bazaar ----------------------┐
  future non-Bazaar discovery -┤
                               v
evidence providers
  Doctor operational history --┐
  x402 Trust signed evidence ---┤
                                v
                     policy / eligibility
                                v
                         task ranking
                                v
                    future verified outcome
```

Doctor and x402 Trust are not interchangeable scores. Preserve source-specific fields and semantics in snapshots, then derive explicit policy features.

For contract updates, refresh the pinned key map through the pinned key-document URL using a reviewed source change. Never bootstrap a key from an unverified response. Normal tests and replay are offline and never spend funds.
