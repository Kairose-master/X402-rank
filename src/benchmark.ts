import { normalizeResource } from "./bazaar.js";

export interface RelevanceJudgment {
  id: string;
  grade: number;
  sourceField: "serviceName" | "description" | "tags";
  evidence: string;
}
export interface BenchmarkTask {
  id: string;
  query: string;
  request: { network: string; asset: string; maxAmount: string; allowCaution?: boolean; maxTrustAgeHours?: number; limit?: number };
  candidates: RelevanceJudgment[];
  nativeOrder: string[];
  nativeCapture: { capturedAt: string; request: string; source: string };
}
export interface BenchmarkManifest {
  schemaVersion: 1;
  labelProtocol: string;
  snapshotSha256: string;
  tasks: BenchmarkTask[];
}
export const benchmarkText = (resource: ReturnType<typeof normalizeResource>, field: RelevanceJudgment["sourceField"]): string => {
  if (field === "serviceName") {
    const raw = resource.raw as Record<string, unknown>;
    return typeof raw.serviceName === "string" ? raw.serviceName : "";
  }
  return field === "description" ? resource.description : resource.tags.join("\n");
};
export function validateBenchmark(snapshot: { catalog: { items: unknown[] }; capturedAt: string }, manifest: BenchmarkManifest, snapshotSha256: string) {
  if (manifest.schemaVersion !== 1 || manifest.snapshotSha256 !== snapshotSha256 || !Array.isArray(manifest.tasks) || !manifest.tasks.length) {
    throw new Error("Manifest schema, snapshot hash, or task set is invalid");
  }
  const resources = new Map<string, ReturnType<typeof normalizeResource>>();
  for (const raw of snapshot.catalog.items) {
    try {
      const resource = normalizeResource(raw);
      if (!resources.has(resource.id)) resources.set(resource.id, resource);
    } catch {}
  }
  const taskIds = new Set<string>();
  for (const task of manifest.tasks) {
    if (!task.id || taskIds.has(task.id) || !task.query.trim() || !Array.isArray(task.candidates) || !task.candidates.length) throw new Error("Invalid or duplicate benchmark task");
    taskIds.add(task.id);
    const labels = new Set<string>();
    for (const judgment of task.candidates) {
      const resource = resources.get(judgment.id);
      if (!resource || labels.has(judgment.id) || !Number.isInteger(judgment.grade) || judgment.grade < 0 || judgment.grade > 3 || !judgment.evidence.trim()) {
        throw new Error(`Invalid judgment in task ${task.id}: ${judgment.id}`);
      }
      labels.add(judgment.id);
      const text = benchmarkText(resource, judgment.sourceField);
      if (!text.includes(judgment.evidence)) throw new Error(`Evidence is not an exact quote from raw Bazaar metadata: ${judgment.id}`);
    }
    if (new Set(task.nativeOrder).size !== task.nativeOrder.length || task.nativeOrder.some(id => !labels.has(id))) throw new Error(`Native order must be unique and drawn from the judged candidate pool: ${task.id}`);
    if (!task.nativeCapture?.source || !task.nativeCapture?.request || !Number.isFinite(Date.parse(task.nativeCapture.capturedAt))) throw new Error(`Missing native-order provenance: ${task.id}`);
  }
  return resources;
}
function dcg(ids: string[], grades: Map<string, number>, k: number): number {
  return ids.slice(0, k).reduce((sum, id, index) => sum + (2 ** (grades.get(id) ?? 0) - 1) / Math.log2(index + 2), 0);
}
export function rankingMetrics(order: string[], nativeOrder: string[], judgments: RelevanceJudgment[], k: number) {
  const grades = new Map(judgments.map(j => [j.id, j.grade]));
  const relevant = judgments.filter(j => j.grade > 0).length;
  const top = order.slice(0, k);
  const nativeTop = nativeOrder.slice(0, k);
  const ideal = judgments.map(j => j.grade).sort((a, b) => b - a).slice(0, k).reduce((sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2), 0);
  const overlapDenominator = Math.max(1, Math.min(k, top.length, nativeTop.length));
  return {
    ndcgAtK: ideal === 0 ? 0 : dcg(order, grades, k) / ideal,
    recallAtK: relevant === 0 ? 0 : top.filter(id => (grades.get(id) ?? 0) > 0).length / relevant,
    topKOverlap: new Set(top.filter(id => nativeTop.includes(id))).size / overlapDenominator,
    returnedAtK: top.length,
  };
}
