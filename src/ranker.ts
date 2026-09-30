import type { DoctorVerdict, EndpointCandidate, RankedEndpoint } from "./types.js";

export interface RankingWeights {
  relevance: number;
  operationalTrust: number;
  outcome: number;
  payerDiversity: number;
  price: number;
  latency: number;
  exploration: number;
}

export const DEFAULT_WEIGHTS: RankingWeights = {
  relevance: 0.30,
  operationalTrust: 0.20,
  outcome: 0.20,
  payerDiversity: 0.10,
  price: 0.08,
  latency: 0.05,
  exploration: 0.07,
};

const clamp01 = (n: number | undefined, fallback = 0): number =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
const count = (n = 0): number => Number.isSafeInteger(n) && n >= 0 ? n : 0;

export function doctorScore(verdict: DoctorVerdict, uptime30d?: number): number {
  // A past good history must not rehabilitate a current known failure.
  if (verdict === "no_go") return 0;
  const base = verdict === "go" ? 1 : verdict === "caution" ? 0.45 : 0.25;
  return uptime30d === undefined ? base : 0.5 * base + 0.5 * clamp01(uptime30d);
}

export function explorationBonus(observations = 0, totalObservations = 1): number {
  return Math.min(1, Math.sqrt(Math.log(Math.max(2, count(totalObservations) + 1)) / (count(observations) + 1)));
}

/** Unconstrained scoring primitive. Use rankCatalog for eligibility/budget gates. */
export function rankEndpoints(
  candidates: EndpointCandidate[],
  weights: RankingWeights = DEFAULT_WEIGHTS,
): RankedEndpoint[] {
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof RankingWeights)[]) {
    if (!Number.isFinite(weights[key]) || weights[key] < 0) throw new Error(`Invalid weight: ${key}`);
  }
  const total = Math.min(Number.MAX_SAFE_INTEGER, candidates.reduce((sum, c) => sum + count(c.observations), 0));
  return candidates
    .map((candidate) => {
      const components = {
        relevance: clamp01(candidate.taskRelevance),
        operationalTrust: doctorScore(candidate.doctorVerdict, candidate.doctorUptime30d),
        outcome: clamp01(candidate.verifiedOutcomeRate, 0.5),
        payerDiversity: clamp01(candidate.payerDiversity),
        price: clamp01(candidate.priceScore),
        latency: clamp01(candidate.latencyScore),
        exploration: explorationBonus(candidate.observations, total),
      };
      const score = Object.entries(components).reduce(
        (sum, [key, value]) => sum + value * weights[key as keyof RankingWeights], 0,
      );
      if (!Number.isFinite(score)) throw new Error("Score overflow");
      return { ...candidate, score, components };
    })
    .sort((a, b) => b.score - a.score || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}
