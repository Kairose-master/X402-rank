import type { DoctorVerdict } from "./types.js";

export interface DoctorTrust {
  url: string;
  verdict: DoctorVerdict;
  uptime30d?: number;
  raw: unknown;
}

export async function fetchDoctorTrust(
  endpoint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DoctorTrust> {
  const url = new URL("https://x402-doctor.fizzl.eu/api/trust");
  url.searchParams.set("url", endpoint);
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`x402 Doctor returned ${response.status}`);
  const raw = (await response.json()) as Record<string, unknown>;
  const value = raw.verdict ?? raw.status ?? raw.trust;
  const verdict: DoctorVerdict =
    value === "go" || value === "caution" || value === "no_go" ? value : "unknown";
  const uptime = raw.uptime30d ?? raw.uptime_30d ?? raw.payableRate;
  return {
    url: endpoint,
    verdict,
    uptime30d: typeof uptime === "number" ? uptime : undefined,
    raw,
  };
}
