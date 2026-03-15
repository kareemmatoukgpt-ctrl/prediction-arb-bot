import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';

interface EventMarketRow {
  venue_market_id: string;
  question: string;
  asset: string | null;
  expiry_ts: number | null;
  predicate_type: string | null;
  yes_token_id: string | null;
  no_token_id: string | null;
  status: string;
  event_group: string | null;
}

interface EventScoreResult {
  score: number;
  reasons: string[];
  bucket: 'arb_eligible' | 'research';
  similarity: number;
}

// ── Fuzzy matching utilities ──

const STOP_WORDS = new Set([
  'will', 'the', 'a', 'an', 'in', 'on', 'at', 'by', 'to', 'of', 'for', 'be',
  'is', 'are', 'was', 'were', 'it', 'its', 'this', 'that', 'or', 'and',
  'with', 'from', 'as', 'not', 'no', 'yes', 'do', 'does', 'did', 'have',
  'has', 'had', 'before', 'after', 'during', 'between', 'than', 'more',
  'most', 'any', 'all', 'each', 'every', 'both', 'either', 'neither',
  'whether', 'if', 'when', 'where', 'how', 'what', 'which', 'who', 'whom',
]);

/**
 * Normalize and tokenize a question for fuzzy matching.
 * Strips punctuation, lowercases, removes stop words.
 */
function tokenize(text: string): Set<string> {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = new Set<string>();
  for (const word of normalized.split(' ')) {
    if (word.length >= 2 && !STOP_WORDS.has(word)) {
      tokens.add(word);
    }
  }
  return tokens;
}

/**
 * Compute Jaccard similarity between two token sets.
 * Returns 0-1 where 1 = identical token sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Extract key entities from a question — names, teams, years, numbers.
 * These are weighted higher in matching.
 */
function extractEntities(text: string): Set<string> {
  const entities = new Set<string>();

  // Years (2024-2030)
  const years = text.match(/\b20[2-3]\d\b/g);
  if (years) years.forEach(y => entities.add(y));

  // Capitalized words (likely proper nouns) — from original text, not lowered
  const properNouns = text.match(/\b[A-Z][a-z]{2,}\b/g);
  if (properNouns) properNouns.forEach(n => entities.add(n.toLowerCase()));

  // Numbers with context (e.g., "4.25%", "$100k", "Super Bowl LIX")
  const numbers = text.match(/\d+\.?\d*/g);
  if (numbers) numbers.forEach(n => entities.add(n));

  return entities;
}

/**
 * Score an event market pair using fuzzy title matching.
 * Unlike crypto/FED/MACRO, event markets don't have structured fields —
 * we match by comparing the question text itself.
 */
export function scoreEventPair(pm: EventMarketRow, kalshi: EventMarketRow): EventScoreResult {
  const reasons: string[] = [];

  // Both must be BINARY_EVENT type
  if (pm.predicate_type !== 'BINARY_EVENT' || kalshi.predicate_type !== 'BINARY_EVENT') {
    return { score: 0, reasons: ['Not both BINARY_EVENT'], bucket: 'research', similarity: 0 };
  }

  // Tokenize and compute similarity
  const pmTokens = tokenize(pm.question);
  const kTokens = tokenize(kalshi.question);
  const similarity = jaccardSimilarity(pmTokens, kTokens);

  // Entity matching (weighted higher — proper nouns, years, numbers)
  const pmEntities = extractEntities(pm.question);
  const kEntities = extractEntities(kalshi.question);
  const entitySimilarity = jaccardSimilarity(pmEntities, kEntities);

  // Combined score: 60% token similarity + 40% entity similarity
  const combinedSimilarity = similarity * 0.6 + entitySimilarity * 0.4;

  if (combinedSimilarity < 0.3) {
    return { score: 0, reasons: ['Too dissimilar'], bucket: 'research', similarity: combinedSimilarity };
  }

  let score = Math.round(combinedSimilarity * 80); // max 80 from similarity

  // Expiry proximity bonus (up to +20)
  if (pm.expiry_ts && kalshi.expiry_ts) {
    const expiryDelta = Math.abs(pm.expiry_ts - kalshi.expiry_ts);
    if (expiryDelta <= 86400) { // within 1 day
      score += 20;
      reasons.push('Expiry within 1 day');
    } else if (expiryDelta <= 604800) { // within 1 week
      score += 10;
      reasons.push('Expiry within 1 week');
    }
  }

  reasons.push(`Token similarity: ${(similarity * 100).toFixed(0)}%`);
  reasons.push(`Entity similarity: ${(entitySimilarity * 100).toFixed(0)}%`);
  reasons.push(`Combined: ${(combinedSimilarity * 100).toFixed(0)}%`);

  // Determine bucket — 0.50 threshold balances coverage vs quality for event markets
  const bucket = combinedSimilarity >= 0.5 ? 'arb_eligible' : 'research';
  if (bucket === 'research') {
    reasons.push('Research-only: similarity < 50%');
  }

  return { score, reasons, bucket, similarity: combinedSimilarity };
}

/**
 * Generate event market suggestions by cross-comparing PM and Kalshi event markets.
 */
export function generateEventSuggestions(minScore = 50): {
  created: number; arb_eligible: number; research: number;
} {
  const db = getDb();

  const pmMarkets = db.prepare(`
    SELECT venue_market_id, question, asset, expiry_ts, predicate_type, yes_token_id, no_token_id, status, event_group
    FROM canonical_markets
    WHERE venue = 'POLYMARKET' AND predicate_type = 'BINARY_EVENT' AND status = 'open'
  `).all() as EventMarketRow[];

  const kalshiMarkets = db.prepare(`
    SELECT venue_market_id, question, asset, expiry_ts, predicate_type, yes_token_id, no_token_id, status, event_group
    FROM canonical_markets
    WHERE venue = 'KALSHI' AND predicate_type = 'BINARY_EVENT' AND status = 'open'
  `).all() as EventMarketRow[];

  if (pmMarkets.length === 0 || kalshiMarkets.length === 0) {
    console.log(`[event-matcher] No event markets to match (PM=${pmMarkets.length}, K=${kalshiMarkets.length})`);
    return { created: 0, arb_eligible: 0, research: 0 };
  }

  const upsert = db.prepare(`
    INSERT INTO mapping_suggestions (id, polymarket_market_id, kalshi_market_id, score, reasons_json, bucket, status, expiry_delta_seconds, threshold_delta_pct)
    VALUES (?, ?, ?, ?, ?, ?, 'suggested', ?, ?)
    ON CONFLICT(polymarket_market_id, kalshi_market_id) DO UPDATE SET
      score = excluded.score,
      reasons_json = excluded.reasons_json,
      bucket = excluded.bucket,
      expiry_delta_seconds = excluded.expiry_delta_seconds,
      updated_at = datetime('now')
    WHERE status = 'suggested'
  `);

  let total = 0;
  let arb_eligible = 0;
  let research = 0;
  let pairsChecked = 0;
  const pending: { pm: any; kalshi: any; result: any; expiryDelta: number | null }[] = [];

  // Build inverted index: token → set of Kalshi market indices
  // This avoids O(PM * K) full comparisons by only scoring pairs that share tokens
  const kalshiTokenized = kalshiMarkets.map(k => ({
    market: k,
    tokens: tokenize(k.question),
    entities: extractEntities(k.question),
  }));

  const invertedIndex = new Map<string, number[]>();
  for (let i = 0; i < kalshiTokenized.length; i++) {
    for (const token of kalshiTokenized[i].tokens) {
      let list = invertedIndex.get(token);
      if (!list) { list = []; invertedIndex.set(token, list); }
      list.push(i);
    }
  }

  for (const pm of pmMarkets) {
    const pmTokens = tokenize(pm.question);

    // Find candidate Kalshi markets: those sharing at least 2 tokens with this PM market
    const candidateCounts = new Map<number, number>();
    for (const token of pmTokens) {
      const indices = invertedIndex.get(token);
      if (!indices) continue;
      for (const idx of indices) {
        candidateCounts.set(idx, (candidateCounts.get(idx) || 0) + 1);
      }
    }

    // Only score pairs with >= 2 shared tokens (minimum for meaningful similarity)
    for (const [kIdx, sharedCount] of candidateCounts) {
      if (sharedCount < 2) continue;

      const kalshi = kalshiTokenized[kIdx].market;
      pairsChecked++;

      const result = scoreEventPair(pm, kalshi);
      if (result.score < minScore) continue;

      const expiryDelta = (pm.expiry_ts && kalshi.expiry_ts)
        ? Math.abs(pm.expiry_ts - kalshi.expiry_ts) : null;

      pending.push({ pm, kalshi, result, expiryDelta });
    }
  }

  // Batch upsert in transaction (avoids blocking event loop with individual fsyncs)
  const runBatch = db.transaction((batch: typeof pending) => {
    for (const { pm, kalshi, result, expiryDelta } of batch) {
      const info = upsert.run(
        uuid(),
        pm.venue_market_id,
        kalshi.venue_market_id,
        result.score,
        JSON.stringify(result.reasons),
        result.bucket,
        expiryDelta,
        result.similarity,
      );
      if (info.changes > 0) {
        total++;
        if (result.bucket === 'arb_eligible') arb_eligible++; else research++;
      }
    }
  });

  const BATCH = 1000;
  for (let i = 0; i < pending.length; i += BATCH) {
    runBatch(pending.slice(i, i + BATCH));
  }

  console.log(`[event-matcher] ${total} suggestions upserted (arb_eligible=${arb_eligible}, research=${research}) — checked ${pairsChecked} candidate pairs from ${pmMarkets.length} PM x ${kalshiMarkets.length} Kalshi event markets`);
  return { created: total, arb_eligible, research };
}
