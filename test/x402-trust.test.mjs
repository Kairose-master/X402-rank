import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalizeJcs, PINNED_X402_TRUST_KEYS, reverifyX402TrustEvidence, verifyX402TrustResponse } from '../dist/x402-trust.js';
import { rankSnapshot } from '../dist/pipeline.js';

const fixture = async name => readFile(new URL(`./fixtures/x402-trust/${name}`, import.meta.url));
const vector = JSON.parse(await (await fixture('signature-test-vector.json')).toString('utf8'));
const preview = await fixture('free-preview-2026-10-01.json');

test('JCS matches the published x402 Trust test vector and verifies its test-only key', () => {
  const unsigned = { ...vector.response };
  delete unsigned.signature;
  const canonical = canonicalizeJcs(unsigned);
  assert.equal(canonical, vector.canonicalJson);
  assert.equal(createHash('sha256').update(canonical).digest('hex'), vector.canonicalSha256);
  const verified = verifyX402TrustResponse(JSON.stringify(vector.response), {
    pinnedKeys: { [vector.keyId]: vector.publicKey }, capturedAt: '2026-10-01T00:00:00.000Z',
  });
  assert.equal(verified.digest, vector.canonicalSha256);
  assert.equal(verified.provenance.verified, true);
});

test('real free preview verifies with production pinned key and contains x402-trust schema 2.0.0', () => {
  const verified = verifyX402TrustResponse(preview, { capturedAt: '2026-10-01T00:00:00.000Z' });
  assert.equal(verified.provenance.keyId, 'x402trust-2026-09-20');
  assert.equal(verified.envelope.schemaType, 'x402-trust-preview');
  assert.equal(verified.envelope.samples[0].report.schemaVersion, '2.0.0');
  assert.equal(verified.rawResponseBase64, preview.toString('base64'));
  assert.equal(reverifyX402TrustEvidence(verified).rawResponseSha256, verified.rawResponseSha256);
});

test('fails closed on payload tamper, digest mismatch, unknown key, wrong key, or missing signature', () => {
  const changed = structuredClone(vector.response);
  changed.query = 'tampered';
  const digest = body => {
    const unsigned = { ...body }; delete unsigned.signature;
    return createHash('sha256').update(canonicalizeJcs(unsigned)).digest('hex');
  };
  assert.throws(() => verifyX402TrustResponse(JSON.stringify(changed), { pinnedKeys: { [vector.keyId]: vector.publicKey } }), /digest mismatch/);
  changed.signature.digest = digest(changed);
  assert.throws(() => verifyX402TrustResponse(JSON.stringify(changed), { pinnedKeys: { [vector.keyId]: vector.publicKey } }), /Invalid x402 Trust Ed25519 signature/);
  assert.throws(() => verifyX402TrustResponse(JSON.stringify(vector.response)), /Unknown pinned/);
  assert.throws(() => verifyX402TrustResponse(JSON.stringify(vector.response), { pinnedKeys: { [vector.keyId]: PINNED_X402_TRUST_KEYS['x402trust-2026-09-20'] } }), /Invalid x402 Trust Ed25519 signature/);
  const unsigned = structuredClone(vector.response); delete unsigned.signature;
  assert.throws(() => verifyX402TrustResponse(JSON.stringify(unsigned), { pinnedKeys: { [vector.keyId]: vector.publicKey } }), /Missing x402 Trust signature/);
});

test('fails closed on malformed signature, digest, contract metadata, and canonicalization substitution', () => {
  for (const mutate of [
    body => { body.signature.value = `${body.signature.value.slice(0, -1)}!`; },
    body => { body.signature.value = `${body.signature.value.slice(0, -1)}A`; },
    body => { body.signature.digest = '0'.repeat(64); },
    body => { body.signature.canon = 'JSON.stringify'; },
  ]) {
    const body = structuredClone(vector.response); mutate(body);
    assert.throws(() => verifyX402TrustResponse(JSON.stringify(body), { pinnedKeys: { [vector.keyId]: vector.publicKey } }));
  }
  // Raw whitespace/key order are excluded from JCS input; a verifier that signs raw
  // JSON bytes instead of JCS bytes would reject this provider-valid response.
  const spaced = JSON.stringify(vector.response, null, 3);
  assert.equal(verifyX402TrustResponse(spaced, { pinnedKeys: { [vector.keyId]: vector.publicKey } }).digest, vector.canonicalSha256);
});

test('snapshot replay rejects altered bytes or forged provenance', () => {
  const verified = verifyX402TrustResponse(preview, { capturedAt: '2026-10-01T00:00:00.000Z' });
  assert.throws(() => reverifyX402TrustEvidence({ ...verified, rawResponseSha256: '0'.repeat(64) }), /provenance mismatch/);
  assert.throws(() => reverifyX402TrustEvidence({ ...verified, provenance: { ...verified.provenance, sourceUrl: 'https://attacker.invalid' } }), /provenance/);
});

test('rankSnapshot preserves and reverifies signed evidence without changing Doctor fields', () => {
  const evidence = verifyX402TrustResponse(preview, { capturedAt: '2026-10-01T00:00:00.000Z' });
  const snapshot = {
    schemaVersion: 1, capturedAt: '2026-10-01T00:00:00.000Z',
    catalog: { items: [], pages: [], complete: true, stopReason: null },
    doctorIndex: { version: 1, updated: '2026-10-01T00:00:00.000Z', days: [], resources: {} },
    doctorSummary: {}, warnings: [], sources: {}, x402TrustEvidence: evidence,
  };
  const report = rankSnapshot(snapshot, { query: 'weather', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', maxAmount: '1' });
  assert.equal(report.x402TrustEvidence.rawResponseBase64, evidence.rawResponseBase64);
  assert.deepEqual(report.ranked, []);
  assert.equal(report.coverage.doctorMatched, 0);
});
