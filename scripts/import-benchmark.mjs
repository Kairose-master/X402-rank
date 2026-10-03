#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyArchive, sha256 } from './benchmark-archive.mjs';
import { validateBenchmark } from '../dist/benchmark.js';

const { values } = parseArgs({ options: { capture: { type: 'string' }, judgments: { type: 'string' }, out: { type: 'string' } } });
if (!values.capture || !values.judgments || !values.out) throw new Error('Usage: npm run benchmark:import -- --capture <archive-directory> --judgments <labels.json> --out <manifest.json>');
const archiveBytes = await readFile(resolve(values.capture, 'archive.json'));
const archive = JSON.parse(archiveBytes);
const { snapshot, tasks, snapshotSha256 } = await verifyArchive(values.capture, archive);
const judgmentBytes = await readFile(values.judgments), judgments = JSON.parse(judgmentBytes);
if (judgments.schemaVersion !== 1 || judgments.snapshotSha256 !== snapshotSha256 || judgments.annotation?.scoringNotViewed !== true || !judgments.annotation.annotator || !Number.isFinite(Date.parse(judgments.annotation.frozenAt)) || Date.parse(judgments.annotation.frozenAt) < Date.parse(archive.finishedAt) || !Array.isArray(judgments.tasks) || judgments.tasks.length !== tasks.length || new Set(judgments.tasks.map(t => t.id)).size !== tasks.length) throw new Error('Judgments require snapshot binding and a post-capture, pre-score annotation declaration');
const manifest = {
  schemaVersion: 1, snapshotSha256,
  labelProtocol: archive.plan.sha256 + ': ' + 'Metadata-only judgments frozen before scoring; annotation declaration is provenance, not proof of blindness.',
  provenance: { archiveSha256: sha256(archiveBytes), judgmentsSha256: sha256(judgmentBytes), annotation: judgments.annotation },
  tasks: tasks.map(task => {
    const labels = judgments.tasks.find(t => t.id === task.id)?.candidates;
    const expected = task.cards.map(c => c.id).sort();
    if (!Array.isArray(labels) || JSON.stringify(labels.map(c => c.id).sort()) !== JSON.stringify(expected)) throw new Error(`Judged pool differs from frozen metadata pool: ${task.id}`);
    return { id: task.id, query: task.query, request: task.request, candidates: labels, nativeOrder: task.nativeOrder, nativeCapture: task.nativeCapture, nativePartialResults: task.partialResults, nativeSearchMethod: task.searchMethod };
  }),
};
validateBenchmark(snapshot, manifest, snapshotSha256);
await writeFile(values.out, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'imported-unscored', snapshotSha256, tasks: tasks.length, output: values.out }));
