#!/usr/bin/env node
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { verifyArchive } from './benchmark-archive.mjs';
const root = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node scripts/pack-benchmark.mjs <capture-directory>');
const archive = JSON.parse(await readFile(resolve(root, 'archive.json')));
await verifyArchive(root, archive);
const entries = [archive.snapshot, ...archive.responses];
const byFile = new Map(entries.map(entry => [entry.file, entry]));
for (const entry of byFile.values()) {
  if (entry.encoding === 'gzip') continue;
  const bytes = await readFile(resolve(root, entry.file));
  await writeFile(resolve(root, entry.file + '.gz'), gzipSync(bytes, { level: 9 }), { flag: 'wx' });
}
for (const entry of entries) {
  if (entry.encoding !== 'gzip') { entry.file += '.gz'; entry.encoding = 'gzip'; }
}
for (const search of archive.searches) search.response = archive.responses.find(r => r.url === search.url);
await verifyArchive(root, archive);
await writeFile(resolve(root, 'archive.json'), JSON.stringify(archive, null, 2) + '\n');
for (const file of byFile.keys()) if (!file.endsWith('.gz')) await unlink(resolve(root, file));
