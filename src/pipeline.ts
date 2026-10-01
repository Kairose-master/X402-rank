import { assetKey, atomicAmount, fetchBazaarCatalog, normalizeNetwork, normalizeResource, type BazaarSnapshot, type CatalogResource, type PaymentOption } from "./bazaar.js";
import { fetchDoctorData, lookupDoctor, parseDoctorIndex, type DoctorIndex, type DoctorTrust } from "./doctor.js";
import { reverifyX402TrustEvidence, type VerifiedTrustEvidence } from "./x402-trust.js";
import { BAZAAR_URL, DOCTOR_INDEX, DOCTOR_SUMMARY, type HttpOptions } from "./http.js";
import { rankEndpoints, type RankingWeights } from "./ranker.js";

export interface RankRequest {
  query: string;
  network: string;
  asset: string;
  /** Atomic units of this ONE network/asset. No cross-token or USD comparison. */
  maxAmount: string;
  now?: string;
  maxTrustAgeHours?: number;
  allowCaution?: boolean;
  limit?: number;
}
export const CATALOG_WEIGHTS: RankingWeights = {
  relevance: 0.65, operationalTrust: 0.25, price: 0.10,
  // There are no verified outcomes, payer independence or service latency in these sources.
  outcome: 0, payerDiversity: 0, latency: 0, exploration: 0,
};
const tokens = (s: string): Set<string> => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
export function lexicalRelevance(query: string, resource: CatalogResource): number {
  const q = tokens(query);
  const text = tokens(`${resource.name} ${resource.description} ${resource.tags.join(" ")}`);
  return q.size ? [...q].filter(t => text.has(t)).length / q.size : 0;
}

export function rankCatalog(rawItems: unknown[], index: DoctorIndex, request: RankRequest) {
  if (!request.query.trim() || request.query.length > 1000 || !tokens(request.query).size || !request.network || !request.asset) throw new Error("Query, network and asset are required");
  const budget = atomicAmount(request.maxAmount);
  const limit = request.limit ?? 20;
  const maxAge = request.maxTrustAgeHours ?? 48;
  const nowText = request.now ?? new Date().toISOString();
  const now = Date.parse(nowText);
  if (!Number.isFinite(now) || !Number.isFinite(maxAge) || maxAge <= 0 || maxAge > 720 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid ranking policy");
  if (Date.parse(index.updated) > now + 5 * 60_000) throw new Error("Doctor index timestamp is in the future");
  const network = normalizeNetwork(request.network);
  const rejected: { id: string; reason: string }[] = [];
  const resources = new Map<string, CatalogResource>();
  const conflicts = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  for (const raw of rawItems) {
    try {
      const r = normalizeResource(raw);
      const previous = resources.get(r.id);
      if (previous) {
        duplicates++;
        // Never trust a cheaper duplicate with conflicting options/metadata.
        if (JSON.stringify(previous.raw) !== JSON.stringify(raw)) conflicts.add(r.id);
      } else resources.set(r.id, r);
    } catch { invalid++; }
  }
  const accepted: { resource: CatalogResource; trust: DoctorTrust; option: PaymentOption; relevance: number }[] = [];
  let doctorMatched = 0;
  for (const r of resources.values()) {
    let reason = "";
    let trust: DoctorTrust;
    try { trust = lookupDoctor(index, r.url); }
    catch { rejected.push({ id: r.id, reason: "invalid_doctor_record" }); continue; }
    if (trust.daysChecked > 0) doctorMatched++;
    const ageHours = trust.observedDate ? (now - Date.parse(trust.observedDate)) / 3_600_000 : Infinity;
    const options = r.accepts.filter(o => o.network === network && assetKey(o.asset) === assetKey(request.asset));
    options.sort((a, b) => atomicAmount(a.amount) < atomicAmount(b.amount) ? -1 : atomicAmount(a.amount) > atomicAmount(b.amount) ? 1 : a.payTo.localeCompare(b.payTo));
    const option = options[0];
    const relevance = lexicalRelevance(request.query, r);
    if (conflicts.has(r.id)) reason = "conflicting_duplicate";
    else if (!option) reason = "no_matching_payment_option";
    else if (atomicAmount(option.amount) > budget) reason = "over_budget";
    else if (relevance <= 0) reason = "no_lexical_match";
    else if (trust.verdict === "no_go") reason = "doctor_no_go";
    else if (trust.verdict === "unknown") reason = "doctor_unknown";
    else if (ageHours < 0 || ageHours > maxAge || (now - Date.parse(index.updated)) / 3_600_000 > maxAge) reason = "doctor_stale";
    else if (trust.verdict === "caution" && !request.allowCaution) reason = "doctor_caution";
    else if (r.method === "UNKNOWN" || !trust.method || r.method !== trust.method) reason = "doctor_method_unconfirmed";
    else if (!trust.networks.includes(network)) reason = "doctor_network_unconfirmed";
    if (reason || !option) { rejected.push({ id: r.id, reason: reason || "no_matching_payment_option" }); continue; }
    accepted.push({ resource: r, trust, option, relevance });
  }
  // Amount comparisons are exact bigint arithmetic. Number conversion is only a bounded score ratio.
  const rows = accepted.map(({ resource: r, trust, option, relevance }) => {
    const priceScore = budget === 0n ? 1 : Number((budget - atomicAmount(option.amount)) * 1_000_000n / budget) / 1_000_000;
    const scored = rankEndpoints([{
      url: r.url, taskRelevance: relevance, doctorVerdict: trust.verdict,
      doctorUptime30d: trust.uptime30d, priceScore, latencyScore: 0,
    }], CATALOG_WEIGHTS)[0]!;
    const { raw: _raw, ...evidence } = trust;
    return {
      id: r.id, url: r.url, method: r.method, name: r.name, description: r.description,
      paymentOption: option, score: scored.score,
      components: { relevance: scored.components.relevance, operationalTrust: scored.components.operationalTrust, price: scored.components.price },
      trust: evidence,
      missingSignals: ["verifiedTaskOutcome", "independentPayers", "serviceLatency"],
      requiresPrePaymentValidation: true,
    };
  }).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const excludedByReason: Record<string, number> = {};
  for (const { reason } of rejected) excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1;
  return {
    policy: { ...request, network, now: nowText, maxTrustAgeHours: maxAge, allowCaution: request.allowCaution ?? false, limit },
    weights: CATALOG_WEIGHTS,
    coverage: { read: rawItems.length, normalized: resources.size, invalid, duplicates, doctorMatched, eligible: rows.length, returned: Math.min(limit, rows.length), excludedByReason },
    ranked: rows.slice(0, limit), excluded: rejected,
    limitations: [
      "Read-only catalog ranking, not a payment authorization or task-success probability.",
      "Doctor signals cover origin + path and scanned method/network; not query-specific output quality.",
      "Lexical relevance is a baseline, not semantic/schema compatibility validation.",
      "No outcomes, payer-independence evidence, service latency or live exploration trials were collected.",
    ],
  };
}

export interface Snapshot {
  schemaVersion: 1; capturedAt: string; catalog: BazaarSnapshot;
  doctorIndex: unknown; doctorSummary: unknown; warnings: string[];
  sources: { bazaar: string; doctorIndex: string; doctorSummary: string };
  /** Optional signed artifact; independent of Doctor operational trust and ranking features. */
  x402TrustEvidence?: VerifiedTrustEvidence;
}
export async function collectSnapshot(options: HttpOptions & { pageSize?: number; maxPages?: number } = {}): Promise<Snapshot> {
  const catalog = await fetchBazaarCatalog(options);
  const doctor = await fetchDoctorData(options);
  return {
    schemaVersion: 1, capturedAt: new Date().toISOString(), catalog,
    doctorIndex: doctor.rawIndex, doctorSummary: doctor.rawSummary, warnings: doctor.warnings,
    sources: { bazaar: BAZAAR_URL, doctorIndex: DOCTOR_INDEX, doctorSummary: DOCTOR_SUMMARY },
  };
}
export function rankSnapshot(snapshot: Snapshot, request: RankRequest) {
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.catalog?.items) || !Array.isArray(snapshot.warnings) || typeof snapshot.catalog.complete !== "boolean" || !Number.isFinite(Date.parse(snapshot.capturedAt))) throw new Error("Invalid snapshot");
  const x402TrustEvidence = snapshot.x402TrustEvidence === undefined ? undefined : reverifyX402TrustEvidence(snapshot.x402TrustEvidence);
  return {
    schemaVersion: 1, capturedAt: snapshot.capturedAt, sources: snapshot.sources,
    complete: snapshot.catalog.complete, stopReason: snapshot.catalog.stopReason,
    warnings: snapshot.warnings,
    ...(x402TrustEvidence ? { x402TrustEvidence } : {}),
    ...rankCatalog(snapshot.catalog.items, parseDoctorIndex(snapshot.doctorIndex), { ...request, now: request.now ?? snapshot.capturedAt }),
  };
}
