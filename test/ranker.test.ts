import { describe, expect, it } from "vitest";
import { doctorScore, explorationBonus, rankEndpoints } from "../src/ranker.js";

describe("x402-rank baseline", () => {
  it("treats no_go as lower operational trust than go", () => {
    expect(doctorScore("go")).toBeGreaterThan(doctorScore("no_go"));
  });

  it("gives under-observed endpoints an exploration bonus", () => {
    expect(explorationBonus(0, 100)).toBeGreaterThan(explorationBonus(100, 100));
  });

  it("ranks verified outcomes and trust instead of raw purchase count", () => {
    const ranked = rankEndpoints([
      {
        url: "https://wash.example",
        taskRelevance: 0.9,
        priceScore: 1,
        latencyScore: 1,
        doctorVerdict: "caution",
        verifiedOutcomeRate: 0.2,
        distinctPayers: 1,
        payerDiversity: 0.05,
        observations: 1000,
      },
      {
        url: "https://useful.example",
        taskRelevance: 0.9,
        priceScore: 0.8,
        latencyScore: 0.8,
        doctorVerdict: "go",
        verifiedOutcomeRate: 0.95,
        distinctPayers: 12,
        payerDiversity: 0.9,
        observations: 20,
      },
    ]);
    expect(ranked[0]?.url).toBe("https://useful.example");
  });
});
