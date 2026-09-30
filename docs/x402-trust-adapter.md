# x402 Trust adapter

This adapter is intentionally **optional** and evidence-oriented.

## Why

The current live X402-rank pipeline uses the CDP Bazaar catalog as its candidate universe and joins x402 Doctor route-level history onto those candidates. Therefore, an endpoint outside Bazaar is not an "unknown-quality Bazaar candidate"; it is outside that run's candidate set.

x402 Trust may provide a complementary source with broader endpoint coverage, repeated observations, on-chain settlement evidence, and signed machine-readable responses.

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

The implementation therefore exposes a fail-closed Ed25519 verification primitive in `src/x402-trust.ts`.

It deliberately does **not** guess the live API envelope, public-key encoding, signature encoding, or canonicalization. Before wiring live ingestion, verify those details against the provider's published machine-readable contract:

- https://x402-trust.com/llms.txt
- https://x402-trust.com/v1/x402-trust-preview

If the contract cannot be retrieved or verified, do not silently ingest unsigned data.

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

## Next integration step

Once the live response contract is independently inspected:

1. add the preview/bulk endpoint to the read-only allowlist;
2. capture exact response bytes plus signature metadata;
3. canonicalize exactly as documented by the provider;
4. verify Ed25519 before parsing evidence into ranking features;
5. store the signed source artifact in the snapshot;
6. replay offline without network access;
7. add fixtures derived from the documented schema, clearly labelled as fixtures;
8. only then decide which signed observations are eligibility gates versus ranking features.

The paid bulk endpoint must remain opt-in. Normal tests and replay must never spend funds.
