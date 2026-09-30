import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  atomicAmount, normalizeResource, fetchBazaarCatalog, fetchJson, BAZAAR_URL, DOCTOR_API, DOCTOR_INDEX, DOCTOR_SUMMARY,
  parseDoctorIndex, lookupDoctor, parseDoctorTrust, fetchDoctorTrust, fetchDoctorData,
  rankCatalog, rankSnapshot, collectSnapshot, rankEndpoints, doctorScore, explorationBonus,
} from '../dist/index.js';

const NET = 'eip155:8453';
const ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const NOW = '2026-09-30T12:00:00.000Z';
const url = 'https://weather.example/forecast';
const policy = { query: 'weather forecast', network: NET, asset: ASSET, maxAmount: '10000', now: NOW };
const resource = (u = url, extra = {}) => ({
  type: 'http', resource: u, description: 'Weather forecast', x402Version: 2,
  accepts: [{ scheme: 'exact', network: NET, asset: ASSET, amount: '1000', payTo: '0x1111111111111111111111111111111111111111' }],
  extensions: { bazaar: { info: { input: { method: 'GET' } }, schema: {} } }, ...extra,
});
const entry = (u = url, extra = {}) => ({ url: u, m: 'GET', h: 'ggg',
  last: { verdict: 'go', codes: [], networks: [NET], price_usd: 0.001, ms: 90 }, d: 'weather forecast', ...extra });
const index = (resources = { [url]: entry() }, extra = {}) => ({ version: 1, updated: NOW,
  days: ['2026-09-28', '2026-09-29', '2026-09-30'], resources, ...extra });
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const page = (items, offset = 0, total = items.length, limit = Math.max(1, items.length)) => ({ x402Version: 2, items, pagination: { offset, total, limit } });
const summary = { updated: NOW, resources: 1, latest: { go: 1, caution: 0, no_go: 0, unreachable: 0 } };

// Fixtures below are synthetic protocol examples, never represented as live data.
test('reads capped pages using actual offset, and never fetches sellers', async () => {
  const seen = [];
  const catalog = await fetchBazaarCatalog({ pageSize: 500, fetchImpl: async target => {
    const u = new URL(target); seen.push(u.href);
    assert.equal(u.origin + u.pathname, BAZAAR_URL);
    const offset = Number(u.searchParams.get('offset'));
    return response(page([resource(`https://example.com/${offset}`)], offset, 3, 1));
  } });
  assert.equal(catalog.complete, true); assert.equal(catalog.items.length, 3);
  assert.deepEqual(seen.map(u => new URL(u).searchParams.get('offset')), ['0', '1', '2']);
});
test('page cap is explicitly incomplete, not an empty/successful full index', async () => {
  const result = await fetchBazaarCatalog({ maxPages: 1, fetchImpl: async () => response(page([resource()], 0, 5)) });
  assert.equal(result.complete, false); assert.equal(result.stopReason, 'max_pages');
});
test('rejects repeated pages, malformed envelopes and premature empty pages', async () => {
  let offset = 0;
  await assert.rejects(fetchBazaarCatalog({ fetchImpl: async () => response(page([resource()], offset++, 3)) }), /Repeated/);
  for (const body of [{}, { resources: [] }, page([], 0, 3), page([resource()], 1, 2)]) {
    await assert.rejects(fetchBazaarCatalog({ fetchImpl: async () => response(body) }));
  }
});
test('changed catalog size is marked incomplete', async () => {
  let calls = 0;
  const c = await fetchBazaarCatalog({ fetchImpl: async () => response(page([resource()], calls, ++calls === 1 ? 3 : 4)) });
  assert.equal(c.complete, false); assert.equal(c.stopReason, 'catalog_changed');
});
test('retries 429 respecting short Retry-After and bounds retries', async () => {
  let n = 0; const sleeps = [];
  const data = await fetchJson(BAZAAR_URL, { sleep: async ms => { sleeps.push(ms); }, fetchImpl: async () => ++n === 1 ? response({}, 429, { 'retry-after': '1' }) : response({ ok: true }) });
  assert.deepEqual(data, { ok: true }); assert.deepEqual(sleeps, [1000]);
  await assert.rejects(fetchJson(BAZAAR_URL, { fetchImpl: async () => response({}, 429, { 'retry-after': '120' }) }), /429/);
});
test('rejects redirect responses, oversized/invalid JSON and disallowed upstreams', async () => {
  await assert.rejects(fetchJson('https://evil.example/collect'), /allowlisted/);
  await assert.rejects(fetchJson(BAZAAR_URL, { fetchImpl: async () => response({}, 302) }), /302/);
  await assert.rejects(fetchJson(BAZAAR_URL, { maxBytes: 5, fetchImpl: async () => response({ much: 'too long' }) }), /size/);
  await assert.rejects(fetchJson(BAZAAR_URL, { fetchImpl: async () => new Response('<html>bad</html>') }));
});
test('timeout also protects an unfinished response body', async () => {
  await assert.rejects(fetchJson(BAZAAR_URL, { timeoutMs: 5, fetchImpl: async (_u, init) => new Response(new ReadableStream({
    start(controller) { init.signal.addEventListener('abort', () => controller.error(new Error('aborted'))); },
  })) }), /aborted/);
});
test('normalizes v1/v2 amounts without precision loss or cross-chain assumptions', () => {
  const r = resource(); r.accepts[0].maxAmountRequired = '9007199254740993'; delete r.accepts[0].amount; r.accepts[0].network = 'base';
  assert.equal(normalizeResource(r).accepts[0].amount, '9007199254740993');
  assert.equal(normalizeResource(r).accepts[0].network, NET);
  for (const amount of ['NaN', 'Infinity', '1e3', '-1', '0.001', '', '01', '1'.repeat(1000), 1000]) assert.throws(() => atomicAmount(amount));
  assert.equal(atomicAmount('0'), 0n);
  r.accepts[0].amount = '2'; assert.equal(normalizeResource(r).accepts.length, 0);
});
test('resource identity keeps method and query; rejects unsafe URLs', () => {
  const a = normalizeResource(resource(url + '?city=Seoul'));
  const b = normalizeResource(resource(url + '?city=Busan'));
  assert.notEqual(a.id, b.id);
  for (const u of ['http://example.com', 'file:///etc/passwd', 'https://user:pass@example.com', 'https://example.com/#secret']) assert.throws(() => normalizeResource(resource(u)));
});
test('reads actual Doctor v1 history, right-aligns it and excludes unscanned days from ratio', () => {
  const i = parseDoctorIndex(index({ [url]: entry(url, { h: 'cn', last: { verdict: 'no_go', networks: [] } }) }));
  const r = lookupDoctor(i, url + '?city=Seoul');
  assert.equal(r.verdict, 'no_go'); assert.equal(r.uptime30d, 0.5); assert.equal(r.observedDate, '2026-09-30');
  const g = lookupDoctor(parseDoctorIndex(index({ [url]: entry(url, { h: 'g-g' }) })), url);
  assert.equal(g.daysChecked, 2); assert.equal(g.uptime30d, 1);
  assert.equal(lookupDoctor(i, 'https://unscanned.example/paid').verdict, 'unknown');
});
test('fixes single-lookup response parsing; does not guess uptime30d/status fields', () => {
  const body = { url, history: 'gcg', days: index().days, last_scan: entry().last, updated: NOW, payable_ratio: 1 };
  assert.equal(parseDoctorTrust(body, url).verdict, 'go');
  assert.throws(() => parseDoctorTrust({ url, verdict: 'go', uptime30d: 1 }, url));
  assert.throws(() => parseDoctorTrust({ ...body, url: 'https://other.example/' }, url));
});
test('404 Doctor lookup returns unknown, 503 is not good trust', async () => {
  const trust = await fetchDoctorTrust(url, async () => response({}, 404)); assert.equal(trust.verdict, 'unknown');
  await assert.rejects(fetchDoctorData({ retries: 0, fetchImpl: async () => response({}, 503) }), /503/);
});
test('rejects unknown index version, invalid dates and mismatched histories', () => {
  assert.throws(() => parseDoctorIndex(index({}, { version: 2 })));
  assert.throws(() => parseDoctorIndex(index({}, { days: ['2026-02-31'] })));
  assert.throws(() => lookupDoctor(parseDoctorIndex(index({ [url]: entry(url, { h: 'ggn' }) })), url));
  assert.throws(() => lookupDoctor(parseDoctorIndex(index({ [url]: entry('https://other.example/') })), url));
});
test('summary is optional aggregate metadata, never endpoint records', async () => {
  const data = await fetchDoctorData({ retries: 0, fetchImpl: async u => String(u) === DOCTOR_INDEX ? response(index()) : response({}, 503) });
  assert.equal(Object.keys(data.index.resources).length, 1); assert.equal(data.warnings.length, 1);
  assert.throws(() => parseDoctorIndex(summary));
});
test('joins catalog with Doctor and never invents outcome/payer/latency signals', () => {
  const result = rankCatalog([resource()], parseDoctorIndex(index()), policy);
  assert.equal(result.ranked.length, 1); assert.equal(result.ranked[0].trust.scope, 'origin-path');
  assert.equal(result.weights.outcome, 0); assert.equal(result.weights.payerDiversity, 0); assert.equal(result.weights.latency, 0);
  assert.equal(result.weights.exploration, 0); assert.equal(result.ranked[0].requiresPrePaymentValidation, true);
  assert.ok(!('verifiedOutcomeRate' in result.ranked[0]));
});
test('no-go cannot buy its way into results with price, volume or exploration', () => {
  const r = resource(); r.quality = { l30DaysTotalCalls: 1e9, l30DaysUniquePayers: 1e9 };
  const i = index({ [url]: entry(url, { h: 'ggn', last: { verdict: 'no_go', networks: [NET] } }) });
  const result = rankCatalog([r], parseDoctorIndex(i), policy);
  assert.equal(result.ranked.length, 0); assert.equal(result.coverage.excludedByReason.doctor_no_go, 1);
});
test('unknown and caution are excluded by default; caution requires opt in', () => {
  assert.equal(rankCatalog([resource()], parseDoctorIndex(index({})), policy).ranked.length, 0);
  const i = parseDoctorIndex(index({ [url]: entry(url, { h: 'ggc', last: { verdict: 'caution', networks: [NET] } }) }));
  assert.equal(rankCatalog([resource()], i, policy).ranked.length, 0);
  assert.equal(rankCatalog([resource()], i, { ...policy, allowCaution: true }).ranked.length, 1);
});
test('endpoint history age is checked even when index was refreshed today', () => {
  const i = parseDoctorIndex(index({ [url]: entry(url, { h: 'g--' }) }));
  const result = rankCatalog([resource()], i, policy);
  assert.equal(result.coverage.excludedByReason.doctor_stale, 1);
  assert.throws(() => rankCatalog([], parseDoctorIndex(index({}, { updated: '2026-10-05T00:00:00Z' })), policy), /future/);
});
test('does not treat probe duration as service latency, or scan days as paid observations', () => {
  const i = index(); const base = rankCatalog([resource()], parseDoctorIndex(i), policy).ranked[0].score;
  i.resources[url].last.ms = 1e9;
  const r = resource(); r.quality = { l30DaysTotalCalls: 1e9, l30DaysUniquePayers: 99 };
  assert.equal(rankCatalog([r], parseDoctorIndex(i), policy).ranked[0].score, base);
});
test('compares only matching network/asset, enforces exact bigint budget', () => {
  for (const change of [{ network: 'eip155:1' }, { asset: 'OTHER' }, { maxAmount: '999' }]) {
    assert.equal(rankCatalog([resource()], parseDoctorIndex(index()), { ...policy, ...change }).ranked.length, 0);
  }
  const r = resource(); r.accepts[0].amount = '9007199254740993';
  assert.equal(rankCatalog([r], parseDoctorIndex(index()), { ...policy, maxAmount: '9007199254740992' }).ranked.length, 0);
});
test('method mismatch and unconfirmed requested network are not transferable trust', () => {
  for (const e of [entry(url, { m: 'POST' }), entry(url, { last: { verdict: 'go', networks: ['eip155:1'] } })]) {
    assert.equal(rankCatalog([resource()], parseDoctorIndex(index({ [url]: e })), policy).ranked.length, 0);
  }
});
test('deduplicates identical entries; conflicting duplicate cannot undercut price', () => {
  const a = resource(), b = structuredClone(a); b.accepts[0].amount = '1';
  assert.equal(rankCatalog([a, a], parseDoctorIndex(index()), policy).ranked.length, 1);
  const result = rankCatalog([a, b], parseDoctorIndex(index()), policy);
  assert.equal(result.ranked.length, 0); assert.equal(result.coverage.excludedByReason.conflicting_duplicate, 1);
});
test('URL query variants remain separate despite route-level Doctor join', () => {
  const result = rankCatalog([resource(url + '?city=A'), resource(url + '?city=B')], parseDoctorIndex(index()), policy);
  assert.equal(result.ranked.length, 2);
  assert.deepEqual(result.ranked.map(r => r.url), [url + '?city=A', url + '?city=B']);
});
test('irrelevant metadata is excluded even when cheap and payable', () => {
  const r = resource(url, { description: 'cat pictures' });
  assert.equal(rankCatalog([r], parseDoctorIndex(index()), policy).coverage.excludedByReason.no_lexical_match, 1);
});
test('core scorer stays finite and no-go history cannot raise operational score', () => {
  assert.equal(doctorScore('no_go', 1), 0);
  assert.ok(explorationBonus(0, 100) > explorationBonus(100, 100));
  const row = rankEndpoints([{ url, taskRelevance: NaN, priceScore: Infinity, latencyScore: NaN, doctorVerdict: 'go', doctorUptime30d: NaN, observations: -1 }])[0];
  assert.ok(Number.isFinite(row.score));
});
test('full ingest -> join -> deterministic report uses only three approved sources', async () => {
  const seen = [];
  const snapshot = await collectSnapshot({ fetchImpl: async target => {
    const u = String(target); seen.push(u);
    if (u.startsWith(BAZAAR_URL)) return response(page([resource()]));
    if (u === DOCTOR_INDEX) return response(index());
    if (u === DOCTOR_SUMMARY) return response(summary);
    throw new Error('Unexpected URL: ' + u);
  } });
  assert.equal(seen.length, 3); assert.equal(snapshot.catalog.complete, true);
  snapshot.capturedAt = NOW;
  const a = rankSnapshot(snapshot, policy); const b = rankSnapshot(snapshot, policy);
  assert.deepEqual(a, b); assert.equal(a.ranked.length, 1);
});
test('CLI replays a synthetic fixture offline, labels partial output and exits 2', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'x402-rank-'));
  const input = join(dir, 'snapshot.json'), output = join(dir, 'ranking.json');
  await writeFile(input, JSON.stringify({ schemaVersion: 1, capturedAt: NOW, sources: {}, warnings: ['SYNTHETIC TEST FIXTURE'],
    catalog: { items: [resource()], pages: [], complete: false, stopReason: 'max_pages', reportedTotal: 4 }, doctorIndex: index(), doctorSummary: summary }));
  const r = spawnSync(process.execPath, ['scripts/rank.mjs', '--input', input, '--out', output, '--query', policy.query, '--network', NET, '--asset', ASSET, '--max-amount', '10000'], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stderr);
  const report = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(report.mode, 'snapshot-replay'); assert.equal(report.complete, false); assert.match(report.snapshotSha256, /^[a-f0-9]{64}$/);
});
