# Live Bazaar comparison — 2026-10-02

The existing benchmark harness replays one full public CDP catalog capture plus
query-specific native search responses and raw Doctor data. Capture window:
06:20:31.452–06:21:31.244 UTC (15:20:31–15:21:31 Korea time).
21,999 catalog rows; 23,885 Doctor index records; 69 metadata judgments.
Snapshot SHA-256: `66030c0735f0f306fa6b400825181ef73fbac609d3f1ecc8d3b446581cdd4208`.

Tasks and metadata-only pool rule were committed before capture. The unscored
capture was committed as `95469af53361cbcb7e870c73da58c60e05c87471`; judgments and
imported manifest were frozen in `34a75d45f8292bcb8c0e15a5970a4a069eadb93f` before
running X402-rank against this task set. No grades or scoring weights were changed
after viewing metrics. See [annotation protocol](annotation-protocol.md),
[judgments](live-judgments.json), [manifest](live-tasks.json),
[raw archive](captures/actions-36973011378/archive.json) and
[full metrics](live-results.json).

| Task | Pool | Native returned | X402-rank eligible | Native NDCG@5 | X402-rank NDCG@5 | Native Recall@5 | X402-rank Recall@5 | Top-5 overlap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| weather forecast | 23 | 15 | 22 | 1.000 | 0.806 | 22.73% | 22.73% | 40% |
| web search | 25 | 15 | 24 | 1.000 | 1.000 | 29.41% | 29.41% | 40% |
| cryptocurrency price | 21 | 11 | 19 | 1.000 | 1.000 | 31.25% | 31.25% | 40% |

Weather NDCG@1 is 1.000 native versus 0.429 X402-rank; NDCG@3 is
1.000 versus 0.732. Web and crypto NDCG@1/@3 are 1.000 for both systems.
The full JSON also contains the exact orders and all @1/@3/@5 metrics.

Native order coverage of the judged pool is 65.22%, 60.00%, 52.38%;
X402-rank eligible coverage is 95.65%, 96.00%, 90.48%. The pool deliberately adds
catalog lexical matches outside the native response. The higher X402-rank pool
coverage therefore does **not** establish higher whole-catalog retrieval recall.
All native responses report `partialResults: false`, with `searchMethod: hybrid`.
The requested API limit is 20; actual native response counts are retained above.

## Operational context — separate from relevance

The original policy excludes one weather candidate over budget, one web candidate
without a matching Base USDC option, and two crypto candidates with Doctor `no_go`.
X402-rank's top five in each task have five Doctor `go` verdicts and a mean Doctor
component of 1. These describe payment availability history, not semantic relevance
or successful task outputs. The current harness reports operational top-five
context for X402-rank only; it cannot establish operational superiority over native.
No Doctor field, price or endpoint behavior was used to set semantic grades.

## What this comparison supports

This small capture does not show semantic ranking superiority: native is better
for weather under the frozen labels and ties for the other two tasks. Top-five
Recall is equal on all three tasks. X402-rank's policy gates remove some candidates,
but that fact cannot be counted as a semantic improvement. The weather result is
preserved rather than tuning the ranker or changing labels to obtain a better score.

Limits: one ~60-second capture window rather than an atomic upstream snapshot;
three broad tasks; native-seeded pools plus ID-sorted lexical extras (which can
concentrate providers); one model annotator; coarse ordinal labels; no seller
response, purchase, wallet, output-quality or task-success evaluation. Geographic
restrictions count as narrower weather capabilities under the frozen rubric.
Independent human annotations and a broader task sample would be needed for a
strong comparative claim.

## Offline reproduction

```sh
npm run benchmark -- --snapshot benchmarks/captures/actions-36973011378/snapshot.json.gz \
  --labels benchmarks/live-tasks.json --out /tmp/live-benchmark.json
npm test
```

Gzip preserves the original JSON bytes; archive hashes bind the decompressed
bytes. The regression checks archive SHA/provenance, native-order reconstruction,
exact candidate membership, judgment bindings and byte-identical report replay.
All raw inputs are committed in the PR; reproduction needs no seller or public
API requests after installing dependencies.
