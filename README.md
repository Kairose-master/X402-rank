# X402-rank

**An auditable, policy-aware ranking experiment for x402 services.**

Bazaar already supports discovery, semantic search and quality-ranked results. This project experiments with an additional buyer-side layer: **which candidate matches this task, budget and payment network, with a recent operational track record?** It does not claim to have solved demand, Sybil resistance or task-quality verification.

```text
CDP Bazaar (paginated catalog) ───┐
                                ├─ normalize → eligibility gates → explainable ranking
Doctor trust-data/index.json ────┘                                   ↓
Doctor /api/trust/summary ────────────── aggregate metadata     snapshot + JSON report
```

## Run

Node.js 20.18+ and npm. There are no runtime dependencies, wallets, paid API keys or LLM requirements.

```bash
npm install
npm test
npm run typecheck

npm run rank -- --query "weather forecast" \
  --network eip155:8453 \
  --asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  --max-amount 50000
```

The last argument is **atomic units of the selected asset**, not dollars. The example requests Base USDC, whose 50,000 atomic units correspond to 0.05 USDC. Nothing is purchased. Choose an explicit network, asset and budget for every experiment; prices in unrelated tokens are never compared.

The command writes `data/snapshot.json` (source responses) and `data/ranking.json` (policy, score components, exclusions, coverage, source times and snapshot SHA-256). A short summary is printed to stdout. These files are git-ignored; inspect the raw data before sharing it.

Replay the same inputs without network access:

```bash
npm run rank -- --input data/snapshot.json --out data/replay.json \
  --query "weather forecast" --network eip155:8453 \
  --asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --max-amount 50000
```

Replay evaluates freshness **as of the snapshot's capture time** and is labelled `snapshot-replay`, not live. The file hash binds the report to its input bytes; it is not a signed service receipt.

`--page-size 500` and `--max-pages 200` bound catalog reads. Server-capped page sizes are respected. A page cap or changing reported total marks `complete: false`; by default the CLI saves the partial report and exits **2**. `--allow-partial` explicitly permits a partial experiment without relabelling it complete. Other failures exit **1**. Invalid/repeated pagination and malformed mandatory upstream data fail closed; no fixture fallback is used.

## Doctor integration: important contract details

Thanks to [Fizzl13 / x402 Doctor](https://github.com/Fizzl13/x402-doctor) for offering its public track record as an experiment input.

- `/api/trust/summary` contains **aggregate counts**, not per-endpoint records. It is optional metadata; a failure or different timestamp is reported as a warning.
- Endpoint data comes from [`trust-data/index.json`](https://raw.githubusercontent.com/Fizzl13/x402-doctor/trust-data/index.json), read once per collection. We do not hammer the rate-limited single-URL endpoint.
- The v1 index contains `version`, `updated`, `days` and `resources`. Each resource has `url`, `m`, `h` and `last`. The history uses `g/c/n/x/-`, right-aligned to the dates. `-` is unscanned, not a successful or failed call.
- `fetchDoctorTrust()` also supports the **actual** individual-lookup shape: `history`, `days`, `last_scan` and `updated`. The previous guessed `verdict/status/uptime30d` aliases were incorrect for this API.

Doctor's key is origin + path, without query parameters or trailing slashes. Catalog identity, however, preserves the full URL and method. The join is labelled **route-level evidence**, not proof that a particular query, response, asset or task will succeed. The scanned method and payable network must match the request.

## Eligibility before scoring

Default exclusions: malformed/conflicting duplicate records, no matching payment option, over-budget price, no lexical match, Doctor `no_go`/unreachable/unknown/caution, unconfirmed method/network, and observations or index snapshots older than 48 hours. `--allow-caution` and `--max-trust-age-hours` are explicit experiment overrides; neither overrides `no_go`, unknown data, the network or budget.

Unknown/new sellers are excluded from this conservative **catalog-only** run, not declared bad. Safe cold-start trials need a separate authorized budget, current payment preflight and recorded outcomes; adding a score bonus alone would not constitute real exploration.

## Score and missing evidence

The catalog adapter uses only signals present in these sources:

```text
0.65 × lexical task relevance
+ 0.25 × Doctor operational score
+ 0.10 × remaining fraction of per-call budget
```

Weights are uncalibrated baselines. Relevance is token overlap over declared name, description and tags, not semantic inference or schema verification. Operational score combines the latest verdict with the fraction of scanned days marked go/caution; the legacy field name `doctorUptime30d` is **not** continuous uptime. Returned scores are not probabilities.

Verified task outcomes, independent payers, service latency and live exploration have zero weight in this adapter because those measurements have not been collected. Doctor's scan duration is not API execution latency; scan days are not purchase observations. Bazaar call counts and unique wallet counts are retained in raw snapshots but are not treated as independent customers or Sybil-proof evidence.

The existing `rankEndpoints()` primitive and general feature interface remain available for experiments with separately collected outcomes. It is an **unconstrained scorer**; use `rankCatalog()` / `rankSnapshot()` for the gates above. The bounded exploration helper is only a heuristic, not a trained bandit with regret guarantees.

## Tests and CI

```bash
npm test                 # original Vitest tests + offline ingestion/CLI regressions
npm run test:ingestion   # build + built-in Node test runner
npm run typecheck
```

The integration fixtures are synthetic and explicitly labelled, not captured production results. Coverage includes pagination, 429/retries, timeout and body limits, malformed JSON, v1/v2 amount handling, BigInt budgets, actual Doctor field names, stale/unknown/no-go gates, method/network scope, duplicates, missing evidence and offline CLI replay.

GitHub Actions runs deterministic tests, then a separate **non-blocking live catalog smoke** for same-repository PRs or manual dispatch. The live job makes public read-only requests and attaches source snapshots/report as a 7-day artifact. Its success must be checked separately: a green unit-test job does not establish that live collection passed.

## Boundaries and next experiments

This release does **not** pay, probe sellers, validate live 402 challenges, verify signed task results, train an ML model or import xAI's recommender. A real buyer must revalidate the current challenge, destination, amount, network and output requirements before authorizing any payment. A signature proves origin/integrity, not truthful or useful content.

Next: compare this baseline against Bazaar's own ranking on an independently labelled task set, then add consented outcome collection and budgeted exploration. See [data contracts](docs/data-contracts.md) for upstream sources and freshness/coverage limitations.
