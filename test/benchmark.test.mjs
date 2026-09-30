import test from 'node:test';
import assert from 'node:assert/strict';
import { rankingMetrics, validateBenchmark } from '../dist/benchmark.js';

const raw = (name, description, tags = []) => ({
  type: 'http', resource: 'https://example.test/' + name.toLowerCase().replaceAll(' ', '-'),
  serviceName: name, description, tags,
  accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '1', payTo: '0x0000000000000000000000000000000000000001', outputSchema: { input: { method: 'GET' } } }],
  extensions: { bazaar: { info: { input: { method: 'GET' } } } },
});

test('relevance metrics are deterministic and distinguish both orderings', () => {
  const judgments = [
    { id: 'GET https://example.test/weather', grade: 3, sourceField: 'description', evidence: 'weather forecast' },
    { id: 'GET https://example.test/maps', grade: 1, sourceField: 'description', evidence: 'weather map' },
    { id: 'GET https://example.test/crypto', grade: 0, sourceField: 'description', evidence: 'token prices' },
  ];
  const native = rankingMetrics([judgments[2].id, judgments[0].id, judgments[1].id], [], judgments, 2);
  const improved = rankingMetrics([judgments[0].id, judgments[1].id, judgments[2].id], [], judgments, 2);
  assert.equal(improved.ndcgAtK, 1);
  assert.ok(improved.ndcgAtK > native.ndcgAtK);
  assert.equal(improved.recallAtK, 1);
  assert.equal(improved.topKOverlap, 0);
});

test('label evidence must be an exact quote from explicit raw Bazaar metadata and bind to snapshot bytes', () => {
  const items = [raw('Weather forecast', 'Current forecast by city'), raw('Map lookup', 'Weather map tiles', ['maps'])];
  const snapshotHash = 'abc123';
  const manifest = {
    schemaVersion: 1, snapshotSha256: snapshotHash, labelProtocol: 'raw metadata only',
    tasks: [{
      id: 'weather', query: 'weather forecast',
      candidates: [
        { id: 'GET https://example.test/weather-forecast', grade: 3, sourceField: 'serviceName', evidence: 'Weather forecast' },
        { id: 'GET https://example.test/map-lookup', grade: 1, sourceField: 'description', evidence: 'Weather map tiles' },
      ],
      nativeOrder: ['GET https://example.test/map-lookup', 'GET https://example.test/weather-forecast'],
      nativeCapture: { capturedAt: '2026-09-30T12:00:00Z', request: 'search query', source: 'Bazaar native search' },
    }],
  };
  assert.equal(validateBenchmark({ catalog: { items }, capturedAt: '2026-09-30T12:00:00Z' }, manifest, snapshotHash).size, 2);
  manifest.tasks[0].candidates[0].evidence = 'not in raw metadata';
  assert.throws(() => validateBenchmark({ catalog: { items } }, manifest, snapshotHash), /exact quote/);
  manifest.tasks[0].candidates[0].evidence = 'Weather forecast';
  assert.throws(() => validateBenchmark({ catalog: { items } }, { ...manifest, snapshotSha256: 'other' }, snapshotHash), /snapshot hash/);
});

test('manifest rejects native rankings that escape the predeclared judged candidate pool', () => {
  const items = [raw('Weather forecast', 'Forecast')];
  const manifest = {
    schemaVersion: 1, snapshotSha256: 'h', labelProtocol: 'raw only',
    tasks: [{
      id: 'weather', query: 'weather forecast',
      candidates: [{ id: 'GET https://example.test/weather-forecast', grade: 2, sourceField: 'serviceName', evidence: 'Weather forecast' }],
      nativeOrder: ['GET https://outside.test/hidden'],
      nativeCapture: { capturedAt: '2026-09-30T12:00:00Z', request: 'q', source: 'Bazaar' },
    }],
  };
  assert.throws(() => validateBenchmark({ catalog: { items } }, manifest, 'h'), /judged candidate pool/);
});
