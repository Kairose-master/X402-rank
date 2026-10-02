# Frozen annotation protocol

Tasks are the three queries in live-plan.json. Policy is Base USDC, budget 50,000
atomic units, default operational gates. Freeze this document before inspecting
X402-rank scores for this capture.

- 3: explicit metadata advertises the requested capability itself (forecast,
  general web search, or cryptocurrency price lookup).
- 2: explicit metadata advertises a narrower version of the capability (current
  weather without a forecast, domain-restricted web search, or one cryptocurrency's price).
- 1: metadata advertises an adjacent capability that can assist the task but does
  not deliver it (weather history, website crawl, token metadata/news).
- 0: unrelated or insufficient explicit metadata for the requested capability.

Each grade uses one verbatim quote from explicit description/serviceName/tags.
Add a short rationale for auditability. Endpoint URLs identify candidates but do
not establish relevance. Doctor, price, payment volume and rank scores never
supply relevance evidence. Missing/unknown output schemas and untested seller
behavior cannot establish task success. These are single-annotator metadata
judgments, not verified capability/outcome measurements.

Native results retain their original order and top-20 truncation. The pool also
includes up to ten lexical metadata matches sorted by ID; unrelated ambiguous
catalog IDs are omitted, and ambiguous native metadata fails import. Duplicate
payment/quality records with identical explicit metadata retain semantic labels;
the existing ranker can exclude them through its conflicting_duplicate gate.
