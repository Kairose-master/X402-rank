export type DoctorVerdict = "go" | "caution" | "no_go" | "unknown";

export interface EndpointCandidate {
  url: string;
  taskRelevance: number;
  priceScore: number;
  latencyScore: number;
  doctorVerdict: DoctorVerdict;
  doctorUptime30d?: number;
  verifiedOutcomeRate?: number;
  distinctPayers?: number;
  payerDiversity?: number;
  observations?: number;
}

export interface RankedEndpoint extends EndpointCandidate {
  score: number;
  components: Record<string, number>;
}
