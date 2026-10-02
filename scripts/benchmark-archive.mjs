import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { normalizeResource, parseBazaarPage } from '../dist/bazaar.js';
import { BAZAAR_URL, BAZAAR_SEARCH_URL, DOCTOR_INDEX } from '../dist/http.js';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const tokens = text => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

export function searchUrl(query) {
  const url = new URL(BAZAAR_SEARCH_URL);
  url.search = new URLSearchParams({ query, type: 'http', limit: '20' }).toString();
  return url.href;
}

export function nativeIds(raw) {
  if (!Array.isArray(raw?.resources) || raw.resources.length > 20 || typeof raw.partialResults !== 'boolean' || typeof raw.searchMethod !== 'string' || !raw.searchMethod) throw new Error('Invalid native search response');
  const ids = raw.resources.map(item => normalizeResource(item).id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate native search IDs');
  return ids;
}

export function metadataPool(snapshot, rawSearch, query) {
  const resources = new Map();
  for (const raw of snapshot.catalog.items) {
    try {
      const r = normalizeResource(raw);
      if (resources.has(r.id) && JSON.stringify(resources.get(r.id).raw) !== JSON.stringify(raw)) throw new Error('Conflicting catalog duplicate');
      resources.set(r.id, r);
    } catch (error) { if (error.message === 'Conflicting catalog duplicate') throw error; }
  }
  const ids = nativeIds(rawSearch);
  for (const raw of rawSearch.resources) {
    const r = normalizeResource(raw), catalog = resources.get(r.id);
    if (!catalog) throw new Error(`Native result missing from same-window catalog: ${r.id}`);
    for (const field of ['serviceName', 'description', 'tags']) {
      if (JSON.stringify(raw[field]) !== JSON.stringify(catalog.raw[field])) throw new Error(`Catalog/search metadata drift: ${r.id}`);
    }
  }
  const q = tokens(query);
  const extra = [...resources.values()].filter(r => {
    const raw = r.raw;
    const text = tokens([raw.serviceName ?? '', raw.description ?? '', ...(Array.isArray(raw.tags) ? raw.tags : [])].join(' '));
    return [...q].some(t => text.has(t));
  }).map(r => r.id).sort(compare).slice(0, 10);
  return [...new Set([...ids, ...extra])].map(id => {
    const raw = resources.get(id).raw;
    return { id, serviceName: raw.serviceName ?? '', description: raw.description ?? '', tags: raw.tags ?? [] };
  });
}

export async function readBound(root, entry) {
  if (!entry || typeof entry.file !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid archive entry');
  const path = resolve(root, entry.file);
  if (!path.startsWith(resolve(root) + sep)) throw new Error('Archive path escapes root');
  const bytes = await readFile(path);
  if (sha256(bytes) !== entry.sha256) throw new Error(`Archive SHA mismatch: ${entry.file}`);
  return JSON.parse(bytes);
}

export async function verifyArchive(root, archive) {
  if (archive.schemaVersion !== 1 || !Array.isArray(archive.responses) || !Array.isArray(archive.searches)) throw new Error('Invalid capture archive');
  const plan = await readBound(root, archive.plan);
  const snapshot = await readBound(root, archive.snapshot);
  if (snapshot.sources.bazaar !== BAZAAR_URL || snapshot.sources.doctorIndex !== DOCTOR_INDEX) throw new Error('Unexpected snapshot sources');
  if (!snapshot.catalog.complete) throw new Error('Incomplete catalog cannot be imported');
  const start = Date.parse(archive.startedAt), end = Date.parse(archive.finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 30 * 60_000 || Date.parse(snapshot.capturedAt) < start || Date.parse(snapshot.capturedAt) > end) throw new Error('Invalid capture window');
  const pages = [];
  let doctor;
  for (const entry of archive.responses) {
    const raw = await readBound(root, entry);
    const time = Date.parse(entry.capturedAt);
    if (!Number.isFinite(time) || time < start || time > end || entry.status !== 200) throw new Error('Invalid response provenance');
    const url = new URL(entry.url);
    if (url.origin + url.pathname === snapshot.sources.bazaar) pages.push(raw);
    else if (entry.url === snapshot.sources.doctorIndex) doctor = raw;
  }
  if (JSON.stringify(pages) !== JSON.stringify(snapshot.catalog.pages) || JSON.stringify(pages.flatMap(p => p.items)) !== JSON.stringify(snapshot.catalog.items) || !doctor || JSON.stringify(doctor) !== JSON.stringify(snapshot.doctorIndex)) throw new Error('Snapshot differs from raw archived responses');
  let offset = 0, total;
  for (const raw of pages) {
    const page = parseBazaarPage(raw, offset);
    if (total !== undefined && total !== page.total) throw new Error('Catalog changed during capture');
    total = page.total; offset += page.items.length;
  }
  if (total === undefined || offset !== total || total !== snapshot.catalog.reportedTotal) throw new Error('Incomplete raw catalog');
  if (archive.searches.length !== plan.tasks.length) throw new Error('Missing native capture');
  const tasks = [];
  for (const task of plan.tasks) {
    const entries = archive.searches.filter(s => s.taskId === task.id);
    if (entries.length !== 1 || entries[0].url !== searchUrl(task.query)) throw new Error('Native request differs from frozen task');
    const entry = entries[0];
    if (!archive.responses.some(r => JSON.stringify(r) === JSON.stringify(entry.response))) throw new Error('Native response lacks archive provenance');
    if (entry.url !== entry.response.url) throw new Error('Native response URL mismatch');
    const raw = await readBound(root, entry.response);
    tasks.push({ ...task, cards: metadataPool(snapshot, raw, task.query), nativeOrder: nativeIds(raw), nativeCapture: { capturedAt: entry.response.capturedAt, request: entry.url, source: BAZAAR_SEARCH_URL }, partialResults: raw.partialResults, searchMethod: raw.searchMethod });
  }
  return { snapshot, tasks, snapshotSha256: archive.snapshot.sha256 };
}
