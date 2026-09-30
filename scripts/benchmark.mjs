#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { rankSnapshot } from '../dist/pipeline.js';
import { normalizeResource } from '../dist/bazaar.js';
import { validateBenchmark, rankingMetrics } from '../dist/benchmark.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((out, value, index, all) => {
  if (value.startsWith('--')) out.push([value.slice(2), all[index + 1]]);
  return out;
}, []));
if (!args.snapshot || !args.labels) throw new Error('Usage: npm run benchmark -- --snapshot data/snapshot.json --labels benchmarks/tasks.json [--out data/benchmark.json]');
const snapshotBytes = await readFile(args.snapshot);
const manifest = JSON.parse(await readFile(args.labels, 'utf8'));
const snapshot = JSON.parse(snapshotBytes);
const snapshotSha256 = createHash('sha256').update(snapshotBytes).digest('hex');
const resources = validateBenchmark(snapshot, manifest, snapshotSha256);
const results = [];
for (const task of manifest.tasks) {
  const pool = new Set(task.candidates.map(item => item.id));
  const nativeOrder = task.nativeOrder.filter(id => pool.has(id));
  const rawItems = snapshot.catalog.items.filter(raw => {
    try { return pool.has(normalizeResource(raw).id); } catch { return false; }
  });
  const subset = { ...snapshot, catalog: { ...snapshot.catalog, items: rawItems } };
  const ranked = rankSnapshot(subset, { query: task.query, ...task.request, now: snapshot.capturedAt, limit: 1000 });
  const xOrder = ranked.ranked.map(row => row.id);
  const judgments = task.candidates;
  const semanticRelevance = Object.fromEntries([1, 3, 5].map(k => [`at${k}`, {
    bazaarNative: rankingMetrics(nativeOrder, nativeOrder, judgments, k),
    x402Rank: rankingMetrics(xOrder, nativeOrder, judgments, k),
  }]));
  const top = ranked.ranked.slice(0, 5);
  const operationalTrust = {
    top5VerdictCounts: top.reduce((counts, row) => {
      counts[row.trust.verdict] = (counts[row.trust.verdict] ?? 0) + 1;
      return counts;
    }, {}),
    top5MeanDoctorScore: top.length ? top.reduce((sum, row) => sum + row.components.operationalTrust, 0) / top.length : null,
  };
  results.push({
    taskId: task.id, query: task.query, candidateCount: judgments.length,
    coverage: {
      nativeOrder: nativeOrder.length / judgments.length,
      x402RankEligible: ranked.coverage.eligible / judgments.length,
      x402RankReturned: xOrder.length / judgments.length,
      relevantCandidateCount: judgments.filter(item => item.grade > 0).length,
    },
    semanticRelevance,
    operationalTrust,
    exclusions: ranked.coverage.excludedByReason,
    x402RankOrder: xOrder,
    bazaarNativeOrder: nativeOrder,
    nativeCapture: task.nativeCapture,
  });
}
const report = {
  schemaVersion: 1, mode: 'offline-snapshot-replay', snapshotCapturedAt: snapshot.capturedAt,
  snapshotSha256, labelProtocol: manifest.labelProtocol,
  separation: 'Semantic labels use exact quotes from raw Bazaar name/description/tags. Doctor values are reported as operational context and never define relevance labels.',
  results,
};
const out = resolve(args.out ?? 'data/benchmark.json');
await mkdir(dirname(out), { recursive: true });
const temp = `${out}.${process.pid}.tmp`;
await writeFile(temp, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
await rename(temp, out);
console.log(JSON.stringify({ snapshotSha256, tasks: results.length, output: out, metrics: results.map(({ taskId, semanticRelevance, coverage, exclusions }) => ({ taskId, semanticRelevance, coverage, exclusions })) }, null, 2));
