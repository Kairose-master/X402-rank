# Data contracts and provenance

Inspected on 2026-09-30. These are external contracts, not X402-rank-owned APIs.

## Coinbase Bazaar

- [Discovery guide](https://docs.cdp.coinbase.com/x402/buyer/discover-services)
- [List resources REST schema](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/list-x402-resources)
- Public GET `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?type=http&limit=500&offset=0`.
- Required envelope: `items[]`, `pagination: {limit, offset, total}`. Offset advances by returned item count. Repeated pages, wrong offsets and premature empty pages are errors. A page limit or changing total is incomplete, not a successful full scan.
- Payment metadata: `accepts[].scheme/network/asset/payTo`, `amount` in v2 or `maxAmountRequired` in v1. Conflicting values are rejected. Integer strings are compared using BigInt; a bounded integer ratio is used only for display scoring. `0` is a declared zero price, not a conversion bonus.
- HTTP method: `extensions.bazaar.info.input.method`, with the legacy `accepts[].outputSchema.input.method` fallback. Missing method stays UNKNOWN; no GET assumption.
- The catalog is mutable and offset pagination is not an atomic snapshot. Even unchanged totals cannot rule out concurrent insertion/removal; `complete` means the reported pagination was exhausted, not a certified market census.
- Bazaar currently offers native text/semantic search and quality ranking. This experiment must be compared against that baseline, not described as the first selection layer.

## Doctor

Contract source pinned at `84220fac8d714eead1ec016dec601f526b12449f`:

- [index reader and summary](https://github.com/Fizzl13/x402-doctor/blob/84220fac8d714eead1ec016dec601f526b12449f/lib/trust-index.js)
- [scan/history encoding](https://github.com/Fizzl13/x402-doctor/blob/84220fac8d714eead1ec016dec601f526b12449f/lib/trust-scan.js)
- [route identity](https://github.com/Fizzl13/x402-doctor/blob/84220fac8d714eead1ec016dec601f526b12449f/lib/bazaar-index.js)
- [single URL response envelope](https://github.com/Fizzl13/x402-doctor/blob/84220fac8d714eead1ec016dec601f526b12449f/server.js)

The parser was independently implemented against these schemas. Bulk endpoint history comes from `https://raw.githubusercontent.com/Fizzl13/x402-doctor/trust-data/index.json`. The optional API summary and raw branch `summary.json` are **different shapes**: API `updated/latest` versus raw summary `date/today`. Neither is an endpoint list. We do not silently guess across the two.

The public API may cache its index for six hours, so its summary can differ from the raw branch. Preserve both and report the mismatch; never enrich every endpoint using a global aggregate success fraction.

History: `g=go`, `c=caution`, `n=no_go`, `x=unreachable/error`, `-=not checked`. Date strings are validated, ordered and right-aligned to history. The most recent actual observation supplies freshness; downloading today's index cannot make an old endpoint observation fresh. A last verdict inconsistent with history is quarantined. These are read-only challenge checks, not executed/paid tasks.

Doctor joins by origin/path, ignores query and trailing slashes, and keeps one scanned method. X402-rank does not merge query variants or GET/POST catalog identities. It requires a matching scanned method/network and labels evidence `origin-path`. It cannot establish whether the same asset, price, parameters or output remain valid now; every returned row requires pre-payment validation.

## Security and reproducibility

Only the fixed catalog, Doctor API/index URLs can be requested. Redirects are refused, responses are bounded, and 429/502/503/504 retries are limited. A Retry-After beyond the local wait budget causes failure instead of an early retry. No candidate endpoint, skill URL, OpenAPI URL, payment URL, private key or LLM is invoked.

Mandatory catalog/index failures abort the run. Summary failure is an explicit warning. Incomplete pagination is marked and exits 2 unless the operator explicitly allows partial output. The report records input-source URLs, timestamps, policy, weights, counts, exclusions and the SHA-256 of local snapshot bytes. Replay is offline and evaluates the saved as-of time. Neither a local hash nor a seller signature proves task correctness.

Raw snapshots can be large and contain seller-declared data. They are not committed. Synthetic fixtures are tests only. Live job artifacts are the evidence for a live run; do not call the pipeline live-verified just because fixtures pass.
