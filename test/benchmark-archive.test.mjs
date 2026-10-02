import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metadataPool, nativeIds, readBound, searchUrl, sha256, verifyArchive } from '../scripts/benchmark-archive.mjs';
import { BAZAAR_URL, DOCTOR_INDEX } from '../dist/http.js';
const raw = (id, description) => ({ type: 'http', resource: `https://example.test/${id}`, description, serviceName: id, tags: [], accepts: [], extensions: { bazaar: { info: { input: { method: 'GET' } } } } });
const a = raw('a', 'weather forecast'), b = raw('b', 'weather maps');
const search = { resources: [b, a], partialResults: true, searchMethod: 'text' };

test('native order is preserved independently of catalog order; pool uses only explicit metadata', () => {
  const snapshot = { catalog: { items: [a, b, raw('c', 'unrelated')] } };
  assert.deepEqual(nativeIds(search), ['GET https://example.test/b', 'GET https://example.test/a']);
  assert.deepEqual(metadataPool(snapshot, search, 'weather forecast').map(c => c.id), nativeIds(search));
  assert.deepEqual(Object.keys(metadataPool(snapshot, search, 'weather')[0]), ['id', 'serviceName', 'description', 'tags']);
  assert.throws(() => metadataPool(snapshot, { ...search, resources: [raw('missing', 'weather')] }, 'weather'), /missing/);
  assert.throws(() => metadataPool(snapshot, { ...search, resources: [{ ...a, description: 'changed' }] }, 'weather'), /drift/);
  assert.throws(() => nativeIds({ ...search, resources: [a, a] }), /Duplicate/);
  assert.throws(() => nativeIds({ items: [a] }), /Invalid/);
  assert.equal(new URL(searchUrl('weather forecast')).searchParams.get('query'), 'weather forecast');
});

test('archive import verifies exact bytes, raw catalog reconstruction, native request and capture window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'benchmark-archive-'));
  const bound = async (file, value) => {
    const bytes = JSON.stringify(value) + '\n';
    await writeFile(join(root, file), bytes);
    return { file, sha256: sha256(bytes) };
  };
  try {
    const capturedAt = '2026-10-02T00:00:01Z';
    const page = { items: [a, b], pagination: { offset: 0, limit: 500, total: 2 } };
    const doctor = { version: 1, updated: capturedAt, days: ['2026-10-02'], resources: {} };
    const response = async (file, value, url) => ({ ...await bound(file, value), url, status: 200, capturedAt });
    const p = await response('page.json', page, BAZAAR_URL + '?offset=0');
    const d = await response('doctor.json', doctor, DOCTOR_INDEX);
    const s = await response('search.json', search, searchUrl('weather forecast'));
    const snapshot = { schemaVersion: 1, warnings: [], capturedAt, catalog: { items: page.items, pages: [page], complete: true, reportedTotal: 2 }, doctorIndex: doctor, sources: { bazaar: BAZAAR_URL, doctorIndex: DOCTOR_INDEX } };
    const archive = { schemaVersion: 1, startedAt: '2026-10-02T00:00:00Z', finishedAt: '2026-10-02T00:00:02Z', plan: await bound('plan.json', { tasks: [{ id: 'weather', query: 'weather forecast', request: { network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', maxAmount: '50000' } }] }), snapshot: await bound('snapshot.json', snapshot), responses: [p, d, s], searches: [{ taskId: 'weather', url: s.url, response: s }] };
    assert.deepEqual((await verifyArchive(root, archive)).tasks[0].nativeOrder, nativeIds(search));
    await writeFile(join(root, 'archive.json'), JSON.stringify(archive));
    const labels = { schemaVersion: 1, snapshotSha256: archive.snapshot.sha256, annotation: { scoringNotViewed: true, annotator: 'synthetic regression only', frozenAt: '2026-10-02T00:00:03Z' }, tasks: [{ id: 'weather', candidates: [a, b].map((r, i) => ({ id: `GET ${r.resource}`, grade: i ? 1 : 3, sourceField: 'description', evidence: r.description })) }] };
    await writeFile(join(root, 'labels.json'), JSON.stringify(labels));
    const run = (...args) => spawnSync(process.execPath, args, { encoding: 'utf8' });
    const imported = run('scripts/import-benchmark.mjs', '--capture', root, '--judgments', join(root, 'labels.json'), '--out', join(root, 'manifest.json'));
    assert.equal(imported.status, 0, imported.stderr);
    const replay = () => run('scripts/benchmark.mjs', '--snapshot', join(root, 'snapshot.json'), '--labels', join(root, 'manifest.json'), '--out', join(root, 'metrics.json'));
    assert.equal(replay().status, 0);
    const first = await readFile(join(root, 'metrics.json'), 'utf8');
    assert.equal(replay().status, 0);
    assert.equal(await readFile(join(root, 'metrics.json'), 'utf8'), first);
    assert.deepEqual(JSON.parse(first).results[0].bazaarNativeOrder, nativeIds(search));
    labels.tasks[0].candidates.pop();
    await writeFile(join(root, 'labels.json'), JSON.stringify(labels));
    assert.notEqual(run('scripts/import-benchmark.mjs', '--capture', root, '--judgments', join(root, 'labels.json'), '--out', join(root, 'bad.json')).status, 0);
    await assert.rejects(verifyArchive(root, { ...archive, searches: [{ ...archive.searches[0], url: searchUrl('crypto') }] }), /frozen task/);
    await assert.rejects(verifyArchive(root, { ...archive, finishedAt: '2026-10-02T01:00:00Z' }), /window/);
    await assert.rejects(readBound(root, { file: '../escape', sha256: '0'.repeat(64) }), /escapes/);
    await writeFile(join(root, 'search.json'), JSON.stringify({ ...search, resources: [a, b] }));
    await assert.rejects(verifyArchive(root, archive), /SHA mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
