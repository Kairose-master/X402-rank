/** Read-only upstream transport. Never call seller endpoints or payment routes. */
export const BAZAAR_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
export const DOCTOR_API = "https://x402-doctor.fizzl.eu/api/trust";
export const DOCTOR_INDEX = "https://raw.githubusercontent.com/Fizzl13/x402-doctor/trust-data/index.json";
export const DOCTOR_SUMMARY = `${DOCTOR_API}/summary`;

export interface HttpOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected JSON object");
  return value as Record<string, unknown>;
}

export function endpointUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192) throw new Error("Invalid endpoint URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Endpoint must be credential-free HTTPS without a fragment");
  return url.href; // preserve query and trailing slash: these may change the service.
}

export class HttpError extends Error {
  constructor(public readonly status: number) { super(`Upstream HTTP ${status}`); }
}

export async function fetchJson(target: string, options: HttpOptions = {}): Promise<unknown> {
  const url = new URL(target);
  const base = `${url.origin}${url.pathname}`;
  if (![BAZAAR_URL, DOCTOR_API, DOCTOR_SUMMARY, DOCTOR_INDEX].includes(base) || url.username || url.password || url.hash) {
    throw new Error("Upstream URL is not allowlisted");
  }
  const retries = options.retries ?? 2;
  const timeout = options.timeoutMs ?? 30_000;
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  if (!Number.isInteger(retries) || retries < 0 || retries > 3 || !Number.isFinite(timeout) || timeout < 1 || timeout > 120_000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid HTTP limits");
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let retryWait: number | undefined;
    try {
      const response = await (options.fetchImpl ?? fetch)(url, {
        method: "GET", redirect: "error", signal: controller.signal,
        headers: { accept: "application/json", "user-agent": "x402-rank/0.2 (+https://github.com/Kairose-master/X402-rank; catalog reader, never pays)" },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (![429, 502, 503, 504].includes(response.status) || attempt === retries) throw new HttpError(response.status);
        const retryAfter = response.headers.get("retry-after");
        retryWait = retryAfter == null ? 500 * 2 ** attempt
          : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
        // Do not retry earlier than a server's long requested backoff.
        if (!Number.isFinite(retryWait) || retryWait > 5000) throw new HttpError(response.status);
        retryWait = Math.max(0, retryWait);
      } else {
        const length = Number(response.headers.get("content-length") ?? 0);
        if (length > maxBytes) { await response.body?.cancel(); throw new Error("Upstream body exceeds size limit"); }
        if (!response.body) throw new Error("Empty upstream body");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        let text = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > maxBytes) throw new Error("Upstream body exceeds size limit");
            text += decoder.decode(value, { stream: true });
          }
          return JSON.parse(text + decoder.decode()) as unknown;
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      }
    } finally { clearTimeout(timer); }
    if (retryWait !== undefined) await sleep(retryWait);
  }
  throw new Error("HTTP retry exhausted");
}
