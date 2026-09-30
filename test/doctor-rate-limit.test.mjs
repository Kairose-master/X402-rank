import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupDoctor, parseDoctorIndex } from '../dist/index.js';

test('rate-limited latest scan is unknown, not a malformed record or new failure', () => {
  const url = 'https://weather.example/forecast';
  for (const history of ['gc-', 'nn-', '---']) {
    const index = parseDoctorIndex({
      version: 1, updated: '2026-09-30T12:00:00.000Z',
      days: ['2026-09-28', '2026-09-29', '2026-09-30'],
      resources: { [url]: { url, m: 'GET', h: history,
        last: { verdict: 'rate_limited', codes: ['rate_limited'], networks: [] } } },
    });
    const trust = lookupDoctor(index, url);
    assert.equal(trust.verdict, 'unknown');
    assert.equal(trust.daysChecked, history === '---' ? 0 : 2);
    assert.deepEqual(trust.networks, []);
    assert.equal(trust.uptime30d, history === 'gc-' ? 1 : history === 'nn-' ? 0 : undefined);
  }
});
