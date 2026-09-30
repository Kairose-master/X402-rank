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
  Math.max(0, Math.min(1, n ?? fallback));

export function doctorScore(verdict: DoctorVerdict, uptime30d?: number): number {
  const base = verdict === "go" ? 1 : verdict === "caution" ? 0.45 : verdict === "no_go" ? 0 : 0.25;
  return uptime30d === undefined ? base : 0.5 * base + 0.5 * clamp01(uptime30d);
}

export function explorationBonus(observations = 0, totalObservations = 1): number {
  return Math.min(1, Math.sqrt(Math.log(Math.max(2, totalObservations + 1)) / (observations + 1)));
}

export function rankEndpoints(
  candidates: EndpointCandidate[],
  weights: RankingWeights = DEFAULT_WEIGHTS,
): RankedEndpoint[] {
  const total = candidates.reduce((sum, c) => sum + (c.observations ?? 0), 0);
  return candidates
    .map((candidate) => {
      const components = {
        relevance: clamp01(candidate.taskRelevance),
        operationalTrust: doctorScore(candidate.doctorVerdict, candidate.doctorUptime30d),
        outcome: clamp01(candidate.verifiedOutcomeRate, 0.5),
        payerDiversity: clamp01(candidate.payerDiversity, 0),
        price: clamp01(candidate.priceScore),
        latency: clamp01(candidate.latencyScore),
        exploration: explorationBonus(candidate.observations, total),
      };
      const score = Object.entries(components).reduce(
        (sum, [key, value]) => sum + value * weights[key as keyof RankingWeights],
        0,
      );
      return { ...candidate, score, components };
    })
    .sort((a, b) => b.score - a.score);
}
