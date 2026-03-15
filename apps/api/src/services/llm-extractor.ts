import Anthropic from '@anthropic-ai/sdk';

/**
 * Structured entity extracted from a market question by LLM.
 */
export interface MarketEntity {
  asset: string;              // e.g. "FEDERAL_FUNDS_RATE", "US_GDP", "MEXICO_GDP", "BTC"
  predicate: string;          // "IS" | "ABOVE" | "BELOW" | "BETWEEN" | "AT_LEAST" | "LESS_THAN"
  threshold: number | null;   // e.g. 3.75
  threshold_upper: number | null; // for BETWEEN predicates, e.g. 2.5 (upper bound)
  threshold_unit: string;     // "percent" | "dollars" | "bps"
  geography: string;          // "US" | "EUROZONE" | "MEXICO" | "GLOBAL" etc.
  date: string | null;        // "2026-12-31" or null
  event_type: string;         // "MONETARY_POLICY" | "ECONOMIC_DATA" | "CRYPTO_PRICE" | "SPORTS" | "POLITICS" | "OTHER"
  confidence: number;         // 0-1
}

/**
 * Comparison result between two extracted entities.
 */
export interface EntityComparison {
  match: boolean;
  confidence: number;
  risks: string[];
  details: {
    asset_match: boolean;
    predicate_match: boolean;
    threshold_match: boolean;
    geography_match: boolean;
    date_match: boolean;
  };
}

const EXTRACTION_PROMPT = `Extract structured fields from this prediction market question. Return ONLY valid JSON, no markdown.

Question: "{question}"
Venue: {venue}

Return this exact JSON structure:
{
  "asset": "<underlying asset/metric, e.g. FEDERAL_FUNDS_RATE, US_GDP, MEXICO_GDP, BTC_PRICE, CPI>",
  "predicate": "<IS|ABOVE|BELOW|BETWEEN|AT_LEAST|LESS_THAN|GREATER_THAN|REACHES|TOUCHES>",
  "threshold": <number or null>,
  "threshold_upper": <number or null, only for BETWEEN>,
  "threshold_unit": "<percent|dollars|bps>",
  "geography": "<US|EUROZONE|MEXICO|CANADA|UK|CHINA|JAPAN|GERMANY|GLOBAL>",
  "date": "<YYYY-MM-DD or null>",
  "event_type": "<MONETARY_POLICY|ECONOMIC_DATA|CRYPTO_PRICE|SPORTS|POLITICS|OTHER>",
  "confidence": <0.0-1.0>
}

Rules:
- "Will the rate BE 3.75%" → predicate: "IS" (exact value)
- "Will the rate be ABOVE 3.75%" → predicate: "ABOVE"
- "Will the rate be ≥ 4.5%" → predicate: "AT_LEAST"
- "between 2.0% and 2.5%" → predicate: "BETWEEN", threshold: 2.0, threshold_upper: 2.5
- "more than X%" or "greater than X%" → predicate: "ABOVE"
- "less than X%" → predicate: "LESS_THAN"
- "real GDP" without country qualifier → geography: "US" (Kalshi default)
- "Mexico GDP" → geography: "MEXICO"
- "Eurozone GDP" → geography: "EUROZONE"
- For crypto: "Bitcoin above $80k" → asset: "BTC_PRICE", predicate: "ABOVE", threshold: 80000`;

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  console.log('[llm-extractor] Anthropic client initialized');
  client = new Anthropic({ apiKey });
  return client;
}

// ── In-memory cache ──
const extractionCache = new Map<string, MarketEntity>();
const CACHE_MAX_SIZE = 10000;

/**
 * Extract structured entities from a market question using Claude Haiku.
 * Falls back to regex-based extraction if no API key is set.
 */
export async function extractMarketEntity(
  question: string,
  venue: 'POLYMARKET' | 'KALSHI',
): Promise<MarketEntity> {
  const cacheKey = `${venue}:${question}`;
  if (extractionCache.has(cacheKey)) return extractionCache.get(cacheKey)!;

  const anthropic = getClient();
  if (!anthropic) {
    return extractWithRegex(question, venue);
  }

  try {
    const prompt = EXTRACTION_PROMPT
      .replace('{question}', question)
      .replace('{venue}', venue);

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    let text = response.content[0].type === 'text' ? response.content[0].text : '';
    // Strip markdown code fencing if present
    text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const entity = JSON.parse(text) as MarketEntity;

    // Cache it
    if (extractionCache.size >= CACHE_MAX_SIZE) {
      const firstKey = extractionCache.keys().next().value;
      if (firstKey) extractionCache.delete(firstKey);
    }
    extractionCache.set(cacheKey, entity);

    return entity;
  } catch (err) {
    console.error('[llm-extractor] LLM extraction failed, falling back to regex:', err);
    return extractWithRegex(question, venue);
  }
}

/**
 * Batch extract entities for multiple questions (with rate limiting).
 * Processes up to `concurrency` at a time.
 */
export async function batchExtract(
  questions: { question: string; venue: 'POLYMARKET' | 'KALSHI' }[],
  concurrency = 5,
): Promise<MarketEntity[]> {
  const results: MarketEntity[] = [];

  for (let i = 0; i < questions.length; i += concurrency) {
    const batch = questions.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(q => extractMarketEntity(q.question, q.venue)),
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Compare two extracted entities and determine if they represent the same bet.
 */
export function compareEntities(pm: MarketEntity, kalshi: MarketEntity): EntityComparison {
  const risks: string[] = [];

  // Asset match
  const asset_match = normalizeAsset(pm.asset) === normalizeAsset(kalshi.asset);
  if (!asset_match) risks.push(`Asset mismatch: ${pm.asset} vs ${kalshi.asset}`);

  // Predicate match
  const pmPred = normalizePredicate(pm.predicate);
  const kPred = normalizePredicate(kalshi.predicate);
  const predicate_match = pmPred === kPred;
  if (!predicate_match) {
    risks.push(`Predicate mismatch: ${pm.predicate} (${pmPred}) vs ${kalshi.predicate} (${kPred})`);
  }

  // Threshold match
  let threshold_match = true;
  if (pm.threshold != null && kalshi.threshold != null) {
    const delta = Math.abs(pm.threshold - kalshi.threshold);
    const pct = kalshi.threshold !== 0 ? delta / Math.abs(kalshi.threshold) : delta;
    threshold_match = pct <= 0.01; // within 1%
    if (!threshold_match) {
      risks.push(`Threshold mismatch: ${pm.threshold} vs ${kalshi.threshold} (${(pct * 100).toFixed(1)}% apart)`);
    }
  }

  // Geography match
  const geography_match = normalizeGeo(pm.geography) === normalizeGeo(kalshi.geography);
  if (!geography_match) {
    risks.push(`Geography mismatch: ${pm.geography} vs ${kalshi.geography}`);
  }

  // Date match (within 48h)
  let date_match = true;
  if (pm.date && kalshi.date) {
    const pmDate = new Date(pm.date).getTime();
    const kDate = new Date(kalshi.date).getTime();
    const deltaHours = Math.abs(pmDate - kDate) / (1000 * 3600);
    date_match = deltaHours <= 48;
    if (!date_match) {
      risks.push(`Date mismatch: ${pm.date} vs ${kalshi.date} (${deltaHours.toFixed(0)}h apart)`);
    }
  }

  // Overall match requires asset + geography + threshold; predicate mismatch is a risk
  const match = asset_match && geography_match && threshold_match && predicate_match;
  const confidence = [
    asset_match ? 0.3 : 0,
    predicate_match ? 0.25 : 0,
    threshold_match ? 0.2 : 0,
    geography_match ? 0.15 : 0,
    date_match ? 0.1 : 0,
  ].reduce((a, b) => a + b, 0);

  return {
    match,
    confidence,
    risks,
    details: { asset_match, predicate_match, threshold_match, geography_match, date_match },
  };
}

// ── Normalization helpers ──

function normalizeAsset(asset: string): string {
  const a = asset.toUpperCase().replace(/[_\s-]/g, '');
  const map: Record<string, string> = {
    FEDERALFUNDSRATE: 'FED_RATE',
    FEDRATE: 'FED_RATE',
    FEDFUNDSRATE: 'FED_RATE',
    FED: 'FED_RATE',
    USGDP: 'GDP',
    REALGDP: 'GDP',
    GDP: 'GDP',
    CPI: 'CPI',
    BTCPRICE: 'BTC',
    BITCOIN: 'BTC',
    BTC: 'BTC',
    ETHPRICE: 'ETH',
    ETHEREUM: 'ETH',
    ETH: 'ETH',
  };
  return map[a] || a;
}

function normalizePredicate(pred: string): string {
  const p = pred.toUpperCase().replace(/[_\s]/g, '');
  const map: Record<string, string> = {
    IS: 'EXACT',
    EQUALS: 'EXACT',
    AT: 'EXACT',
    ABOVE: 'ABOVE',
    GREATERTHAN: 'ABOVE',
    MORETHAN: 'ABOVE',
    OVER: 'ABOVE',
    ATLEAST: 'ABOVE', // ≥ is effectively ABOVE for arb purposes
    BELOW: 'BELOW',
    LESSTHAN: 'BELOW',
    UNDER: 'BELOW',
    BETWEEN: 'BETWEEN',
    REACHES: 'TOUCHES',
    TOUCHES: 'TOUCHES',
    HITS: 'TOUCHES',
  };
  return map[p] || p;
}

function normalizeGeo(geo: string): string {
  const g = geo.toUpperCase().replace(/[_\s]/g, '');
  const map: Record<string, string> = {
    US: 'US',
    USA: 'US',
    UNITEDSTATES: 'US',
    GLOBAL: 'GLOBAL',
    EUROZONE: 'EU',
    EU: 'EU',
    EUROPE: 'EU',
    MEXICO: 'MX',
    MX: 'MX',
    CANADA: 'CA',
    CA: 'CA',
    UK: 'UK',
    UNITEDKINGDOM: 'UK',
  };
  return map[g] || g;
}

// ── Regex fallback ──

function extractWithRegex(question: string, venue: string): MarketEntity {
  const q = question.toLowerCase();

  // Geography
  let geography = 'US'; // default
  if (q.includes('mexico')) geography = 'MEXICO';
  else if (q.includes('eurozone') || q.includes('europe')) geography = 'EUROZONE';
  else if (q.includes('canada')) geography = 'CANADA';
  else if (q.includes('uk') || q.includes('united kingdom')) geography = 'UK';
  else if (q.includes('china')) geography = 'CHINA';
  else if (q.includes('japan')) geography = 'JAPAN';
  else if (q.includes('germany')) geography = 'GERMANY';

  // Asset
  let asset = 'UNKNOWN';
  let event_type = 'OTHER';
  if (/fed(eral)?\s*(funds?)?\s*rate|interest\s*rate/i.test(question)) {
    asset = 'FEDERAL_FUNDS_RATE'; event_type = 'MONETARY_POLICY';
  } else if (/\bgdp\b/i.test(question)) {
    asset = `${geography}_GDP`; event_type = 'ECONOMIC_DATA';
  } else if (/\bcpi\b|inflation/i.test(question)) {
    asset = 'CPI'; event_type = 'ECONOMIC_DATA';
  } else if (/bitcoin|btc/i.test(question)) {
    asset = 'BTC_PRICE'; event_type = 'CRYPTO_PRICE';
  } else if (/ethereum|eth\b/i.test(question)) {
    asset = 'ETH_PRICE'; event_type = 'CRYPTO_PRICE';
  }

  // Predicate
  let predicate = 'UNKNOWN';
  if (/between\s+[\d.]+%?\s+and\s+[\d.]+%/i.test(question)) predicate = 'BETWEEN';
  else if (/more than|greater than|above|over\s+[\d]/i.test(question)) predicate = 'ABOVE';
  else if (/at least|≥|>=|\bor more\b/i.test(question)) predicate = 'AT_LEAST';
  else if (/less than|under|below/i.test(question)) predicate = 'LESS_THAN';
  else if (/\bbe\s+[\d.]+%/i.test(question)) predicate = 'IS';

  // Threshold
  let threshold: number | null = null;
  let threshold_upper: number | null = null;
  const betweenMatch = question.match(/between\s+([\d.]+)%?\s+and\s+([\d.]+)%/i);
  if (betweenMatch) {
    threshold = parseFloat(betweenMatch[1]);
    threshold_upper = parseFloat(betweenMatch[2]);
  } else {
    const numMatch = question.match(/([\d.]+)\s*%/);
    if (numMatch) threshold = parseFloat(numMatch[1]);
  }

  // Date
  let date: string | null = null;
  const dateMatch = question.match(/(?:by|before|after|in|end of)\s+(\w+\s+\d{4}|\d{4})/i);
  if (dateMatch) date = dateMatch[1];

  return {
    asset,
    predicate,
    threshold,
    threshold_upper,
    threshold_unit: 'percent',
    geography,
    date,
    event_type,
    confidence: 0.6, // regex is lower confidence
  };
}
