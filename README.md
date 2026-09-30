# X402-rank

**Outcome-based ranking for the x402 service economy.**

x402 discovery is increasingly good at answering *what services exist?* X402-rank experiments with the next question: **which service should an autonomous agent actually buy for this task?**

## Ranking loop

```text
agent intent
  -> Bazaar retrieval
  -> capability / budget filtering
  -> operational trust
  -> ranking
  -> x402 purchase
  -> execution
  -> verified outcome
  -> feedback
```

The baseline deliberately does **not** optimize for raw purchase count. Cheap endpoints make self-purchases easy to manufacture. Instead, the model is designed around:

- task relevance
- x402 Doctor operational trust
- verified successful outcomes
- distinct-payer diversity
- price and latency
- explicit exploration for cold-start endpoints

## x402 Doctor

The first trust adapter consumes the public x402 Doctor endpoint maintained by fizzl13:

```text
GET https://x402-doctor.fizzl.eu/api/trust?url=<endpoint>
```

Doctor's 30-day payable history can bootstrap operational trust before an endpoint has meaningful purchase history.

The adapter is intentionally defensive about response fields while the experiment is young. Raw responses are retained for inspection.

## Baseline score

The initial deterministic score is:

```text
0.30 task relevance
+ 0.20 operational trust
+ 0.20 verified outcome rate
+ 0.10 payer diversity
+ 0.08 price score
+ 0.05 latency score
+ 0.07 exploration bonus
```

These weights are a baseline, not a claim of optimality. The interface is designed so a learned ranker can replace it later.

### Cold start

Under-observed endpoints receive a bounded UCB-style exploration bonus. This prevents a pure historical-success ranker from permanently burying new sellers.

### Manipulation resistance

Raw purchase volume is intentionally excluded from the score. Future economic signals should prefer distinct independent payers, wallet-age-aware diversity, and—most importantly—cryptographically verifiable successful outcomes.

## Goal

The long-term objective is not:

```text
P(purchase | task, endpoint)
```

but something closer to:

```text
P(verified successful outcome | task, endpoint)
```

Signed receipts can eventually provide a stronger feedback label than a payment alone.

## Development

```bash
npm install
npm test
npm run typecheck
```

Requires Node.js 20+.

## Status

This repository is an early ranking experiment. The current implementation provides:

- typed endpoint candidates
- x402 Doctor trust adapter
- deterministic baseline ranker
- cold-start exploration bonus
- regression tests demonstrating that raw self-purchase volume does not improve rank

Next milestones:

1. ingest Bazaar resources and Doctor trust summary
2. normalize endpoint capability metadata
3. add signed-outcome receipt schema
4. add payer-diversity / Sybil-resistant signals
5. benchmark deterministic ranking
6. introduce a learned ranker once real outcome labels exist

## Why

A directory can make a service discoverable without making it selectable.

X402-rank is an experiment in turning an x402 catalog into an **agent procurement layer**.
