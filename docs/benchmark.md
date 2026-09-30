# Bazaar ranking benchmark

The benchmark compares **Bazaar's own query-specific result order** with X402-rank on a fixed candidate pool from one immutable catalog snapshot. The task manifest contains labels and native-order provenance, but no X402-rank scores or score components.

## Reproduce

Capture the regular read-only catalog and Doctor snapshot, then bind an independently prepared label manifest to its exact bytes:

```sh
npm run rank -- --query "weather forecast" --network eip155:8453 \
  --asset 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 --max-amount 50000
sha256sum data/snapshot.json
npm run benchmark -- --snapshot data/snapshot.json --labels benchmarks/tasks.json
```

The manifest is deliberately kept separate from ranking output. Its top-level `snapshotSha256` must equal the snapshot's SHA-256. For each task, `nativeOrder` is the ordered list from Bazaar's native search response, restricted to the predeclared judged candidates. Record the exact query/request and capture time in `nativeCapture`; keep the native response with the snapshot/archive used to create the manifest.

Each judgment is made before examining X402-rank output and contains only:
- a candidate ID in the format produced by `normalizeResource` (HTTP method + full URL);
- an ordinal relevance grade from 0 (irrelevant) through 3 (direct match);
- one explicit raw Bazaar field and a verbatim evidence substring from that field.

The harness rejects evidence not found in the selected raw field, candidates absent from the snapshot, candidate lists with duplicates, native rankings that introduce unjudged candidates, invalid grades, and snapshot hash mismatches. A reviewer should freeze and commit the task manifest before running the benchmark against the new ranking. Do not use Doctor verdicts, prices, endpoint behavior, or X402-rank scores to assign semantic grades.

## Metrics and interpretation

For each task and k = 1, 3, 5:
- **NDCG@k** uses the fixed ordinal relevance grades.
- **Recall@k** is relevant judged candidates retrieved in the first k divided by all relevant judged candidates.
- **Top-k overlap** is the set overlap between the two returned top-k lists.
- **Coverage** reports how much of the judged pool each order/eligible set covers.
- **Exclusion reasons** report X402-rank policy gates for candidates that did not enter its order.

Semantic relevance is evaluated only with the independent labels. Doctor operational trust is a separate descriptive section (top-five verdict counts and mean trust component); it is not a semantic relevance label or a substitute for task success. Operational exclusions can reduce X402-rank coverage, and metrics must be read alongside those reasons.

The CLI is offline: it reads the same saved snapshot for both systems, invokes no service endpoint, and performs no purchase, payment, wallet operation, or seller call. The manifest's Bazaar native order must have been captured separately from Bazaar's own search before seeing X402-rank scores. The full-catalog snapshot's original pagination order is not a substitute for a query-specific native search order.

## Manifest shape

```json
{
  "schemaVersion": 1,
  "labelProtocol": "Freeze judgments from explicit Bazaar name/description/tags before X402-rank scoring.",
  "snapshotSha256": "<sha256 of exact snapshot file bytes>",
  "tasks": [{
    "id": "task-slug",
    "query": "plain-language task",
    "request": {
      "network": "eip155:8453",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "maxAmount": "50000"
    },
    "candidates": [{
      "id": "GET https://example.test/weather",
      "grade": 3,
      "sourceField": "description",
      "evidence": "weather forecast"
    }],
    "nativeOrder": ["GET https://example.test/weather"],
    "nativeCapture": {
      "capturedAt": "2026-09-30T12:00:00Z",
      "request": "Bazaar native search request, including query and options",
      "source": "Bazaar search API/version or UI provenance"
    }
  }]
}
```

The checked-in Node tests use synthetic fixtures solely to test determinism and validation. They are not benchmark results. Keep a real task set and its raw inputs distinct from tests, document the source snapshot and native-search capture, and never characterize a fixture result as a live Bazaar comparison.
