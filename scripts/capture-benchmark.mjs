#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { collectSnapshot } from '../dist/pipeline.js';
import { fetchJson } from '../dist/http.js';
import { sha256, searchUrl, verifyArchive } from './benchmark-archive.mjs';

const { values } = parseArgs({ options: { plan: { type: 'string', default: 'benchmarks/live-plan.json' }, out: { type: 'string' } } });
if (!values.out) throw new Error('Usage: npm run benchmark:capture -- --out benchmarks/captures/<unique-run> [--plan benchmarks/live-plan.json]');
const root = resolve(values.out);
await mkdir(dirname(root), { recursive: true });
await mkdir(root); // Never overwrite a frozen capture.
const planBytes = await readFile(values.plan), plan = JSON.parse(planBytes);
if (plan.schemaVersion !== 1 || !Array.isArray(plan.tasks) || !plan.tasks.length || new Set(plan.tasks.map(t => t.id)).size !== plan.tasks.length || plan.tasks.some(t => !t.id || typeof t.query !== 'string' || !t.query.trim())) throw new Error('Invalid task plan');
await writeFile(resolve(root, 'plan.json'), planBytes);
const archive = { schemaVersion: 1, startedAt: new Date().toISOString(), plan: { file: 'plan.json', sha256: sha256(planBytes) }, responses: [], searches: [] };
const recorder = async (url, init) => {
  const response = await fetch(url, init);
  if (!response.ok) return response;
  const chunks = [], reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32 * 1024 * 1024) throw new Error('Capture response too large');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  if (!/\bapplication\/json\b/i.test(response.headers.get('content-type') ?? '')) throw new Error('Capture expected JSON; upstream returned non-JSON (possibly an access wall)');
  JSON.parse(bytes.toString('utf8'));
  const file = `response-${String(archive.responses.length).padStart(3, '0')}.json`;
  await writeFile(resolve(root, file), bytes);
  archive.responses.push({ file, sha256: sha256(bytes), url: String(url), status: response.status, capturedAt: new Date().toISOString() });
  return new Response(bytes, { status: response.status, headers: { 'content-type': 'application/json' } });
};
try {
  const snapshot = await collectSnapshot({ fetchImpl: recorder });
  if (!snapshot.catalog.complete) throw new Error('Catalog changed/incomplete; discard this run and recapture');
  for (const task of plan.tasks) {
    const url = searchUrl(task.query);
    await fetchJson(url, { fetchImpl: recorder });
    archive.searches.push({ taskId: task.id, url, response: archive.responses.at(-1) });
  }
  const bytes = Buffer.from(JSON.stringify(snapshot) + '\n');
  await writeFile(resolve(root, 'snapshot.json'), bytes);
  archive.snapshot = { file: 'snapshot.json', sha256: sha256(bytes) };
  archive.finishedAt = new Date().toISOString();
  const verified = await verifyArchive(root, archive);
  // Cards expose only metadata and IDs; no operational or ranking signals.
  await writeFile(resolve(root, 'judgment-cards.json'), JSON.stringify(verified.tasks.map(t => ({ id: t.id, query: t.query, cards: t.cards })), null, 2) + '\n');
  await writeFile(resolve(root, 'archive.json'), JSON.stringify(archive, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'captured-unscored', tasks: verified.tasks.length, snapshotSha256: archive.snapshot.sha256, out: root }));
} catch (error) {
  await writeFile(resolve(root, 'FAILED.json'), JSON.stringify({ startedAt: archive.startedAt, failedAt: new Date().toISOString(), error: error.message }, null, 2) + '\n');
  throw error;
}
