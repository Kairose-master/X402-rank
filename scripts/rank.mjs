#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { collectSnapshot, rankSnapshot } from '../dist/index.js';

const { values: a } = parseArgs({ options: {
  query: { type: 'string' }, network: { type: 'string' }, asset: { type: 'string' },
  'max-amount': { type: 'string' }, out: { type: 'string', default: 'data/ranking.json' },
  snapshot: { type: 'string', default: 'data/snapshot.json' }, input: { type: 'string' },
  'page-size': { type: 'string', default: '500' }, 'max-pages': { type: 'string', default: '200' },
  limit: { type: 'string', default: '20' }, 'max-trust-age-hours': { type: 'string', default: '48' },
  'allow-caution': { type: 'boolean', default: false }, 'allow-partial': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
} });
const help = 'npm run rank -- --query "weather forecast" --network eip155:8453 --asset <token-address> --max-amount <atomic-units> [--input data/snapshot.json] [--allow-caution]';
async function atomicWrite(path, text) {
  const file = resolve(path);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, text, { mode: 0o600 });
  await rename(tmp, file);
}
async function run() {
  if (a.help) { console.log(help); return; }
  if (!a.query || !a.network || !a.asset || !a['max-amount']) throw new Error(help);
  if (resolve(a.out) === resolve(a.input ?? a.snapshot)) throw new Error('Report and snapshot paths must differ');
  let snapshot, bytes;
  if (a.input) { bytes = await readFile(a.input, 'utf8'); snapshot = JSON.parse(bytes); }
  else {
    snapshot = await collectSnapshot({ pageSize: Number(a['page-size']), maxPages: Number(a['max-pages']) });
    bytes = JSON.stringify(snapshot);
    await atomicWrite(a.snapshot, bytes);
  }
  const report = rankSnapshot(snapshot, {
    query: a.query, network: a.network, asset: a.asset, maxAmount: a['max-amount'],
    limit: Number(a.limit), maxTrustAgeHours: Number(a['max-trust-age-hours']), allowCaution: a['allow-caution'],
  });
  // Hash binds the local report to exactly the captured bytes; it is NOT a seller signature.
  report.snapshotSha256 = createHash('sha256').update(bytes).digest('hex');
  report.mode = a.input ? 'snapshot-replay' : 'live-catalog';
  await atomicWrite(a.out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({
    mode: report.mode, complete: report.complete, stopReason: report.stopReason, capturedAt: report.capturedAt,
    coverage: report.coverage, warnings: report.warnings, snapshotSha256: report.snapshotSha256,
    top: report.ranked.slice(0, 5).map(r => ({ url: r.url, score: r.score, amount: r.paymentOption.amount, verdict: r.trust.verdict })),
    output: a.out,
  }, null, 2));
  if (!report.complete && !a['allow-partial']) {
    console.error('INCOMPLETE catalog saved for inspection; not a whole-catalog result. Rerun or explicitly pass --allow-partial.');
    process.exitCode = 2;
  }
}
run().catch(error => { console.error(`x402-rank: ${error.message}`); process.exitCode = 1; });
