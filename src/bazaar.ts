import { BAZAAR_URL, endpointUrl, fetchJson, object, type HttpOptions } from "./http.js";

export interface BazaarSnapshot {
  pages: unknown[];
  items: unknown[];
  complete: boolean;
  stopReason: "total_reached" | "max_pages" | "catalog_changed";
  reportedTotal: number;
}

const natural = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export function parseBazaarPage(raw: unknown, expectedOffset: number) {
  const page = object(raw);
  const p = object(page.pagination);
  if (!Array.isArray(page.items) || !natural(p.offset) || p.offset !== expectedOffset || !natural(p.total) || !natural(p.limit) || p.limit < 1 || page.items.length > p.limit) throw new Error("Invalid Bazaar page/pagination");
  if (page.items.length === 0 && expectedOffset < p.total) throw new Error("Premature empty Bazaar page");
  return { items: page.items as unknown[], total: p.total, limit: p.limit };
}

export async function fetchBazaarCatalog(options: HttpOptions & { pageSize?: number; maxPages?: number } = {}): Promise<BazaarSnapshot> {
  const pageSize = options.pageSize ?? 500;
  const maxPages = options.maxPages ?? 200;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) throw new Error("Invalid pagination limits");
  const pages: unknown[] = [];
  const items: unknown[] = [];
  const fingerprints = new Set<string>();
  let total = 0;
  for (let n = 0, offset = 0; n < maxPages; n++) {
    const url = new URL(BAZAAR_URL);
    url.search = new URLSearchParams({ type: "http", limit: String(pageSize), offset: String(offset) }).toString();
    const raw = await fetchJson(url.href, options);
    const page = parseBazaarPage(raw, offset);
    if (n > 0 && total !== page.total) return { pages, items, complete: false, stopReason: "catalog_changed", reportedTotal: page.total };
    total = page.total;
    const fingerprint = JSON.stringify(page.items);
    if (page.items.length && fingerprints.has(fingerprint)) throw new Error("Repeated Bazaar page; refusing incomplete catalog");
    fingerprints.add(fingerprint);
    pages.push(raw);
    items.push(...page.items);
    offset += page.items.length; // actual returned size, not requested size
    if (offset >= total) return { pages, items, complete: true, stopReason: "total_reached", reportedTotal: total };
  }
  return { pages, items, complete: false, stopReason: "max_pages", reportedTotal: total };
}

export interface PaymentOption { network: string; asset: string; amount: string; payTo: string }
export interface CatalogResource {
  id: string; url: string; method: string; description: string; name: string;
  tags: string[]; accepts: PaymentOption[]; raw: unknown;
}

export function atomicAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new Error("Amount must be a bounded atomic-unit integer string");
  return BigInt(value);
}

export function normalizeNetwork(network: string): string {
  return ({ base: "eip155:8453", "base-sepolia": "eip155:84532", solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" } as Record<string, string>)[network] ?? network;
}
export function assetKey(asset: string): string { return /^0x[0-9a-fA-F]{40}$/.test(asset) ? asset.toLowerCase() : asset; }

export function normalizeResource(raw: unknown): CatalogResource {
  const item = object(raw);
  if (item.type !== "http") throw new Error("Unsupported resource type");
  const url = endpointUrl(item.resource);
  const accepts: PaymentOption[] = [];
  if (!Array.isArray(item.accepts)) throw new Error("Missing payment options");
  for (const value of item.accepts) {
    try {
      const option = object(value);
      if (option.scheme !== "exact" || typeof option.network !== "string" || typeof option.asset !== "string" || !option.asset || typeof option.payTo !== "string" || !option.payTo) continue;
      // Conflicting v1/v2 amounts are ambiguous, never choose the cheaper one.
      if (option.amount !== undefined && option.maxAmountRequired !== undefined && option.amount !== option.maxAmountRequired) continue;
      const amount = option.amount ?? option.maxAmountRequired;
      atomicAmount(amount);
      const network = normalizeNetwork(option.network);
      if (!/^[a-z0-9-]{3,8}:[a-zA-Z0-9_-]{1,64}$/.test(network)) continue;
      accepts.push({ network, asset: option.asset, amount: amount as string, payTo: option.payTo });
    } catch { /* Reject this malformed option without inventing a price. */ }
  }
  const legacy = item.accepts.find(v => v && typeof v === "object") as Record<string, unknown> | undefined;
  const nested = (v: unknown, key: string): unknown => v && typeof v === "object" ? (v as Record<string, unknown>)[key] : undefined;
  const input = nested(nested(nested(item.extensions, "bazaar"), "info"), "input");
  const methodValue = nested(input, "method") ?? nested(nested(legacy?.outputSchema, "input"), "method");
  const method = typeof methodValue === "string" && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(methodValue) ? methodValue.toUpperCase() : "UNKNOWN";
  const description = typeof item.description === "string" ? item.description : typeof legacy?.description === "string" ? legacy.description : "";
  return {
    id: `${method} ${url}`, url, method, accepts, description: description.slice(0, 8000),
    name: typeof item.serviceName === "string" ? item.serviceName.slice(0, 200) : "",
    tags: Array.isArray(item.tags) ? item.tags.filter((t): t is string => typeof t === "string").slice(0, 50) : [], raw,
  };
}
