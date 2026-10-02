import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyArchive, sha256 } from '../scripts/benchmark-archive.mjs';
import { validateBenchmark } from '../dist/benchmark.js';

const root = 'benchmarks/captures/actions-36973011378';
test('real CDP capture verifies provenance and replays the frozen benchmark metrics offline', async () => {
  const archiveBytes = await readFile(join(root, 'archive.json'));
  const archive = JSON.parse(archiveBytes);
  const { snapshot, tasks, snapshotSha256 } = await verifyArchive(root, archive);
  const manifest = JSON.parse(await readFile('benchmarks/live-tasks.json'));
  assert.equal(snapshot.catalog.items.length, 21999);
  assert.equal(snapshot.catalog.complete, true);
  assert.equal(snapshotSha256, '66030c0735f0f306fa6b400825181ef73fbac609d3f1ecc8d3b446581cdd4208');
  assert.equal(manifest.provenance.archiveSha256, sha256(archiveBytes));
  assert.equal(manifest.provenance.judgmentsSha256, sha256(await readFile('benchmarks/live-judgments.json')));
  validateBenchmark(snapshot, manifest, snapshotSha256);
  for (const task of tasks) {
    const frozen = manifest.tasks.find(t => t.id === task.id);
    assert.deepEqual(frozen.nativeOrder, task.nativeOrder);
    assert.deepEqual(frozen.candidates.map(c => c.id).sort(), task.cards.map(c => c.id).sort());
    assert.deepEqual(frozen.nativeCapture, task.nativeCapture);
    assert.equal(task.searchMethod, 'hybrid');
    assert.equal(task.partialResults, false);
    assert.equal(frozen.nativeSearchMethod, task.searchMethod);
    assert.equal(frozen.nativePartialResults, task.partialResults);
  }
  const temp = await mkdtemp(join(tmpdir(), 'real-benchmark-'));
  try {
    const output = join(temp, 'results.json');
    const result = spawnSync(process.execPath, ['scripts/benchmark.mjs', '--snapshot', join(root, 'snapshot.json.gz'), '--labels', 'benchmarks/live-tasks.json', '--out', output], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(output, 'utf8'), await readFile('benchmarks/live-results.json', 'utf8'));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
