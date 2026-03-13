import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';

interface MarketRow {
  venue_market_id: string;
  question: string;
  asset: string | null;
  expiry_ts: number | null;
  predicate_direction: string | null;
  predicate_threshold: number | null;
  predicate_type: string | null;
  yes_token_id: string | null;
  no_token_id: string | null;
  status: string;
}

interface ScoreResult {
  score: number;
  reasons: string[];
  bucket: 'arb_eligible' | 'research';
  expiryDeltaSeconds: number | null;
  thresholdDeltaPct: number | null;
}

/**
 * Score a Polymarket/Kalshi pair and determine if it's arb-eligible or research-only.
 *
 * Arb-eligible requires ALL of:
 *   1. Same asset (required)
 *   2. Expiry delta <= 4 hours (14400s)
 *   3. Predicate type match
 *   4. Direction match
 *   5. Threshold delta <= 1%
 */
export function scorePair(pm: MarketRow, kalshi: MarketRow): ScoreResult {
  const reasons: string[] = [];

  // Asset must match (hard requirement)
  if (!pm.asset || !kalshi.asset || pm.asset !== kalshi.asset) {
    return { score: 0, reasons: ['Asset mismatch'], bucket: 'research', expiryDeltaSeconds: null, thresholdDeltaPct: null };
  }
  reasons.push(`Asset: ${pm.asset} match`);
  let score = 40;

  // Expiry proximity (up to +25)
  let expiryDeltaSeconds: number | null = null;
  let expiryArbGate = false;
  if (pm.expiry_ts && kalshi.expiry_ts) {
    expiryDeltaSeconds = Math.abs(pm.expiry_ts - kalshi.expiry_ts);
    if (expiryDeltaSeconds <= 3600) {
      score += 25; reasons.push('Expiry within 1h'); expiryArbGate = true;
    } else if (expiryDeltaSeconds <= 14400) {
      score += 20; reasons.push('Expiry within 4h'); expiryArbGate = true;
    } else if (expiryDeltaSeconds <= 86400) {
      score += 10; reasons.push('Expiry within 24h');
    } else if (expiryDeltaSeconds <= 604800) {
      score += 5; reasons.push('Expiry within 7 days');
    } else {
      score += 0; reasons.push('Expiry mismatch >7 days');
    }
  } else {
    reasons.push('Expiry unknown (missing on one or both sides)');
  }

  // Threshold match (up to +25)
  let thresholdDeltaPct: number | null = null;
  let thresholdArbGate = false;
  if (pm.predicate_threshold != null && kalshi.predicate_threshold != null && kalshi.predicate_threshold !== 0) {
    thresholdDeltaPct = Math.abs(pm.predicate_threshold - kalshi.predicate_threshold) / kalshi.predicate_threshold;
    const pct = thresholdDeltaPct;
    if (pct === 0) {
      score += 25; reasons.push(`Threshold exact match: $${kalshi.predicate_threshold.toLocaleString()}`); thresholdArbGate = true;
    } else if (pct <= 0.001) {
      score += 22; reasons.push(`Threshold near-exact (${(pct * 100).toFixed(3)}%)`); thresholdArbGate = true;
    } else if (pct <= 0.01) {
      score += 15; reasons.push(`Threshold within 1%`); thresholdArbGate = true;
    } else if (pct <= 0.05) {
      score += 8; reasons.push(`Threshold within 5%`);
    } else {
      score += 0; reasons.push(`Threshold mismatch >5% (PM=$${pm.predicate_threshold?.toLocaleString()} K=$${kalshi.predicate_threshold?.toLocaleString()})`);
    }
  } else if (pm.predicate_threshold == null || kalshi.predicate_threshold == null) {
    reasons.push('Threshold unknown (missing on one or both sides)');
  }

  // Predicate type match (+10)
  const pmType = pm.predicate_type || 'CLOSE_AT';
  const kType = kalshi.predicate_type || 'CLOSE_AT';
  let typeArbGate = false;
  if (pmType === kType) {
    score += 10; reasons.push(`Type: ${pmType}`); typeArbGate = true;
  } else {
    reasons.push(`Type mismatch (PM=${pmType} K=${kType})`);
  }

  // Direction match (informational for score, required for arb)
  let directionArbGate = false;
  if (pm.predicate_direction && kalshi.predicate_direction) {
    if (pm.predicate_direction === kalshi.predicate_direction) {
      reasons.push(`Direction: ${pm.predicate_direction}`); directionArbGate = true;
    } else {
      reasons.push(`Direction mismatch (PM=${pm.predicate_direction} K=${kalshi.predicate_direction})`);
    }
  } else {
    reasons.push('Direction unknown');
    directionArbGate = true; // don't penalize if unknown
  }

  // Determine bucket
  const isArbEligible = expiryArbGate && thresholdArbGate && typeArbGate && directionArbGate;
  const bucket: 'arb_eligible' | 'research' = isArbEligible ? 'arb_eligible' : 'research';

  if (!isArbEligible) {
    const missing: string[] = [];
    if (!expiryArbGate) missing.push('expiry>4h');
    if (!thresholdArbGate) missing.push('threshold>1%');
    if (!typeArbGate) missing.push('type mismatch');
    if (!directionArbGate) missing.push('direction mismatch');
    reasons.push(`Research-only: ${missing.join(', ')}`);
  }

  return { score, reasons, bucket, expiryDeltaSeconds, thresholdDeltaPct };
}

/**
 * Generate and upsert mapping suggestions for all crypto market pairs.
 * Returns counts of upserted suggestions by bucket.
 */
export function generateSuggestions(minScore = 40): {
  created: number; updated: number; arb_eligible: number; research: number;
} {
  const db = getDb();

  const pmMarkets = db.prepare(`
    SELECT venue_market_id, question, asset, expiry_ts, predicate_direction, predicate_threshold, predicate_type, yes_token_id, no_token_id, status
    FROM canonical_markets
    WHERE venue = 'POLYMARKET' AND asset IS NOT NULL AND status = 'open'
  `).all() as MarketRow[];

  const kalshiMarkets = db.prepare(`
    SELECT venue_market_id, question, asset, expiry_ts, predicate_direction, predicate_threshold, predicate_type, yes_token_id, no_token_id, status
    FROM canonical_markets
    WHERE venue = 'KALSHI' AND asset IS NOT NULL AND status = 'open'
  `).all() as MarketRow[];

  // Group Kalshi markets by asset for fast lookup
  const kalshiByAsset = new Map<string, MarketRow[]>();
  for (const km of kalshiMarkets) {
    if (!km.asset) continue;
    const list = kalshiByAsset.get(km.asset) ?? [];
    list.push(km);
    kalshiByAsset.set(km.asset, list);
  }

  const upsert = db.prepare(`
    INSERT INTO mapping_suggestions (id, polymarket_market_id, kalshi_market_id, score, reasons_json, bucket, status, expiry_delta_seconds, threshold_delta_pct)
    VALUES (?, ?, ?, ?, ?, ?, 'suggested', ?, ?)
    ON CONFLICT(polymarket_market_id, kalshi_market_id) DO UPDATE SET
      score = excluded.score,
      reasons_json = excluded.reasons_json,
      bucket = excluded.bucket,
      expiry_delta_seconds = excluded.expiry_delta_seconds,
      threshold_delta_pct = excluded.threshold_delta_pct,
      updated_at = datetime('now')
    WHERE status = 'suggested'
  `);

  let total = 0;
  let arb_eligible = 0;
  let research = 0;

  for (const pm of pmMarkets) {
    const candidates = kalshiByAsset.get(pm.asset!) ?? [];
    for (const kalshi of candidates) {
      const result = scorePair(pm, kalshi);
      if (result.score < minScore) continue;
      const info = upsert.run(
        uuid(),
        pm.venue_market_id,
        kalshi.venue_market_id,
        result.score,
        JSON.stringify(result.reasons),
        result.bucket,
        result.expiryDeltaSeconds ?? null,
        result.thresholdDeltaPct ?? null,
      );
      if (info.changes > 0) {
        total++;
        if (result.bucket === 'arb_eligible') arb_eligible++; else research++;
      }
    }
  }

  console.log(`[crypto-matcher] ${total} suggestions upserted (arb_eligible=${arb_eligible}, research=${research})`);
  return { created: total, updated: 0, arb_eligible, research };
}
