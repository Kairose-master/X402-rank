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

## Unscored live capture and archive import

`benchmarks/live-plan.json` freezes three tasks (weather forecast, web search,
cryptocurrency price), a Base USDC budget of 50,000 atomic units, and a deterministic
metadata-only candidate-pool rule. Commit this plan before fetching data. Neither
capture nor import imports the ranker or calculates scores.

```sh
npm run benchmark:capture -- --out benchmarks/captures/<unique-run>
```

This GET-only path uses the existing complete catalog/Doctor collector and adds
CDP `/discovery/search?query=...&type=http&limit=20` for each task. It saves exact
successful JSON response bytes, SHA-256, URL, HTTP status, and capture timestamp.
The archive binds the frozen plan and serialized harness snapshot to those files.
A run must finish within 30 minutes; catalog totals must remain consistent and
native results must exist with identical explicit metadata in the catalog.
This is a bounded capture window, **not an atomic upstream snapshot**. Recapture
on drift. The API limits native search to 20; `partialResults` and `searchMethod`
are retained, so this is a judged-pool comparison, not whole-catalog recall.

`judgment-cards.json` contains only IDs and explicit name/description/tags.
Before viewing any scores, judge **every** card using the existing 0–3 rubric and
save a separate JSON file:

```json
{
  "schemaVersion": 1,
  "snapshotSha256": "<from archive.snapshot.sha256>",
  "annotation": {
    "annotator": "<actual reviewer>",
    "frozenAt": "<actual post-capture, pre-score ISO timestamp>",
    "scoringNotViewed": true
  },
  "tasks": [{
    "id": "weather",
    "candidates": [{
      "id": "<exact card ID>",
      "grade": 3,
      "sourceField": "description",
      "evidence": "<verbatim quote>"
    }]
  }]
}
```

The example is a shape only, not actual judgments. Include all three tasks and
all their candidates. Doctor, price, URL wording, quality counters and inferred
seller behavior must not supply relevance evidence. An annotation declaration
records provenance; it cannot prove a reviewer never saw scores.

```sh
npm run benchmark:import -- --capture benchmarks/captures/<unique-run> \
  --judgments benchmarks/judgments.json --out benchmarks/tasks.json
# Review and commit the archive, judgments and imported manifest BEFORE scoring.
npm run benchmark -- --snapshot benchmarks/captures/<unique-run>/snapshot.json \
  --labels benchmarks/tasks.json --out benchmarks/results.json
```

Import checks every archived response hash, reconstructs catalog/Doctor inputs,
checks capture provenance and exact candidate membership, and derives native order
from the bound native response rather than accepting a manually entered order.
It then calls the original harness validation. It refuses to overwrite an existing
manifest. A failed capture writes `FAILED.json`, never a valid archive or metrics.

### 2026-10-02 capture status

The checked-in attempt under `benchmarks/captures/2026-10-02-attempt` failed at
the catalog request because this execution environment returned a `text/html`
`Site Unavailable` response (HTTP 200). A separate native-search request returned
the same HTML. These are access failures in this environment, not evidence that
Coinbase's service is globally unavailable. No catalog, native JSON, labels or live
metrics were obtained. No historical 2026-09-30 data has been reconstructed.
The added archive/import regressions use synthetic protocol data and do not count
as a real benchmark. This was superseded by the successful GitHub Actions capture below.


### Successful 2026-10-02 live comparison

GitHub Actions run [36973011378](https://github.com/Kairose-master/X402-rank/actions/runs/36973011378)
captured the full catalog, raw Doctor index/summary and three native searches
between **2026-10-02 06:20:31.452 and 06:21:31.244 UTC**. There are 21,999 catalog
rows and 23,885 Doctor index records (index record count is not catalog match count).
All three native searches report `partialResults: false`; returned counts are
weather 15, web 15, crypto 11. These are the actual response orders, not catalog
pagination order. There are 69 judgments across pools of 23, 25 and 21 candidates.

The archive and exact response bytes are checked in under
`benchmarks/captures/actions-36973011378/`. JSON bodies are losslessly gzip-compressed
for repository size. `encoding: gzip` archive entries bind SHA-256 to the original
decompressed bytes. Import verifies those bytes; the existing metric harness now
also accepts a `.json.gz` snapshot. No scoring formulas or ranker behavior changed.

The snapshot SHA-256 is
`66030c0735f0f306fa6b400825181ef73fbac609d3f1ecc8d3b446581cdd4208`.
The unscored capture was committed in `95469af53361cbcb7e870c73da58c60e05c87471`.
Metadata-only labels, rationales, annotation protocol and imported manifest were
committed in `34a75d45f8292bcb8c0e15a5970a4a069eadb93f` before this comparison was run.
Labels use a single model annotator and explicit raw descriptions; they have not
been validated by a second human annotator or actual seller outcomes.

```sh
npm run benchmark:import -- --capture benchmarks/captures/actions-36973011378 \
  --judgments benchmarks/live-judgments.json --out /tmp/imported-live-tasks.json
npm run benchmark -- --snapshot benchmarks/captures/actions-36973011378/snapshot.json.gz \
  --labels benchmarks/live-tasks.json --out /tmp/live-benchmark.json
```

The checked-in `benchmarks/live-results.json` is the original harness output,
including @1/@3/@5 metrics, coverage, exclusions and separate Doctor context.
`benchmarks/live-results.md` summarizes interpretation. `test/live-benchmark.test.mjs`
verifies the archived raw inputs and label bindings and compares offline replay
byte-for-byte with the checked-in report. Frozen PR labels suppress further
automatic recaptures; an explicit workflow dispatch can capture a new run.
