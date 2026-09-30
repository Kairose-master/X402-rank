import type { DoctorVerdict } from "./types.js";
import { DOCTOR_API, DOCTOR_INDEX, DOCTOR_SUMMARY, endpointUrl, fetchJson, HttpError, object, type HttpOptions } from "./http.js";

export interface DoctorTrust {
  url: string;
  verdict: DoctorVerdict;
  /** Fraction of scanned days marked go/caution; NOT continuous uptime or task success. */
  uptime30d?: number;
  daysChecked: number;
  observedDate?: string;
  updated?: string;
  method?: string;
  networks: string[];
  scope: "origin-path";
  raw: unknown;
}
export interface DoctorIndex { version: 1; updated: string; days: string[]; resources: Record<string, unknown> }

/** Doctor's upstream join key ignores query, method and trailing slashes. */
export function doctorKey(endpoint: string): string {
  const url = new URL(endpointUrl(endpoint));
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
const validDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function parseDays(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 30 || !v.every(validDay) || v.some((d, i) => i > 0 && d <= v[i - 1]!)) throw new Error("Invalid Doctor history days");
  return v;
}
function timestamp(v: unknown): string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v) || !Number.isFinite(Date.parse(v))) throw new Error("Invalid Doctor timestamp");
  return v;
}
export function parseDoctorIndex(raw: unknown): DoctorIndex {
  const value = object(raw);
  if (value.version !== 1) throw new Error("Unsupported Doctor index version");
  return { version: 1, updated: timestamp(value.updated), days: parseDays(value.days), resources: object(value.resources) };
}
function unknownTrust(url: string, raw: unknown): DoctorTrust {
  return { url, verdict: "unknown", daysChecked: 0, networks: [], scope: "origin-path", raw };
}
function fromHistory(url: string, history: unknown, days: string[], lastRaw: unknown, updated: string, raw: unknown, method?: string): DoctorTrust {
  if (typeof history !== "string" || !/^[gcnx-]*$/.test(history) || history.length > days.length) throw new Error("Invalid Doctor history string");
  const seen = [...history].filter(c => c !== "-");
  if (!seen.length) return { ...unknownTrust(url, raw), updated, method };
  const last = object(lastRaw);
  const position = history.search(/[^-]-*$/);
  const observedDate = days[days.length - history.length + position];
  const letter = history[position];
  // A rate-limited scan overwrites last but writes "-" into history. It is
  // valid missing data, not a failed scan or confirmation of the prior verdict.
  if (last.verdict === "rate_limited" && history.endsWith("-")) {
    return { ...unknownTrust(url, raw), updated, method, observedDate, daysChecked: seen.length,
      uptime30d: seen.filter(c => c === "g" || c === "c").length / seen.length };
  }
  const verdict: DoctorVerdict = letter === "g" ? "go" : letter === "c" ? "caution" : "no_go";
  // last holds the most recent scan, even when newer days were not scanned.
  const expected = letter === "g" ? "go" : letter === "c" ? "caution" : letter === "n" ? "no_go" : "error";
  if (last.verdict !== expected) throw new Error("Doctor verdict/history mismatch");
  if (!Array.isArray(last.networks) || !last.networks.every(n => typeof n === "string")) throw new Error("Invalid Doctor payable networks");
  return {
    url, verdict, observedDate, updated, method, daysChecked: seen.length,
    uptime30d: seen.filter(c => c === "g" || c === "c").length / seen.length,
    networks: last.networks as string[], scope: "origin-path", raw,
  };
}
export function lookupDoctor(index: DoctorIndex, endpoint: string): DoctorTrust {
  const key = doctorKey(endpoint);
  if (!Object.hasOwn(index.resources, key)) return unknownTrust(endpoint, null);
  const entry = object(index.resources[key]);
  if (doctorKey(String(entry.url)) !== key) throw new Error("Doctor key/URL mismatch");
  const method = typeof entry.m === "string" ? entry.m.toUpperCase() : undefined;
  return fromHistory(endpoint, entry.h, index.days, entry.last, index.updated, entry, method);
}

/** Public /api/trust returns history + last_scan + payable_ratio, not verdict/status. */
export function parseDoctorTrust(raw: unknown, endpoint: string): DoctorTrust {
  const body = object(raw);
  if (endpointUrl(body.url) !== endpointUrl(endpoint)) throw new Error("Doctor response URL mismatch");
  return fromHistory(endpoint, body.history, parseDays(body.days), body.last_scan, timestamp(body.updated), raw);
}
export async function fetchDoctorTrust(endpoint: string, fetchImpl: typeof fetch = fetch): Promise<DoctorTrust> {
  const url = new URL(DOCTOR_API);
  url.searchParams.set("url", endpointUrl(endpoint));
  try { return parseDoctorTrust(await fetchJson(url.href, { fetchImpl }), endpoint); }
  catch (error) { if (error instanceof HttpError && error.status === 404) return unknownTrust(endpoint, null); throw error; }
}
export async function fetchDoctorData(options: HttpOptions = {}) {
  // One bulk read, not thousands of calls to the 30/min lookup endpoint.
  const rawIndex = await fetchJson(DOCTOR_INDEX, options);
  const index = parseDoctorIndex(rawIndex);
  let rawSummary: unknown = null;
  const warnings: string[] = [];
  try {
    rawSummary = await fetchJson(DOCTOR_SUMMARY, options);
    const summary = object(rawSummary);
    if (!Number.isSafeInteger(summary.resources) || !summary.latest) throw new Error("Unexpected Doctor summary shape");
    if (summary.updated !== index.updated) warnings.push("Doctor summary and index are different snapshots; only the index is used for ranking");
  } catch (error) {
    warnings.push(`Doctor summary unavailable: ${error instanceof Error ? error.message : "unknown error"}; index remains the endpoint signal`);
  }
  return { index, rawIndex, rawSummary, warnings };
}
