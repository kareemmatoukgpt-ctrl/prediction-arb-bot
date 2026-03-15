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
  typeRisk: string | null;
}

/**
 * Score a Polymarket/Kalshi pair and determine if it's arb-eligible or research-only.
 *
 * Arb-eligible requires ALL of:
 *   1. Same asset (required)
 *   2. Predicate type match
 *   3. Direction match
 *   4. Threshold delta <= 1%
 *   5. Expiry delta within type-specific window:
 *      - CLOSE_AT: <= 4 hours
 *      - TOUCH_BY: <= 24 hours (TOUCH_BY contracts are less time-sensitive)
 */
export function scorePair(pm: MarketRow, kalshi: MarketRow): ScoreResult {
  const reasons: string[] = [];

  // Asset must match (hard requirement)
  if (!pm.asset || !kalshi.asset || pm.asset !== kalshi.asset) {
    return { score: 0, reasons: ['Asset mismatch'], bucket: 'research', expiryDeltaSeconds: null, thresholdDeltaPct: null, typeRisk: null };
  }
  reasons.push(`Asset: ${pm.asset} match`);
  let score = 40;

  // Predicate type match (+10) — computed early because it affects expiry gate
  const pmType = pm.predicate_type || 'TOUCH_BY';  // PM default is TOUCH_BY (hit/reach/dip)
  const kType = kalshi.predicate_type || 'CLOSE_AT'; // Kalshi default is CLOSE_AT
  let typeArbGate = false;
  let typeRisk: string | null = null;
  if (pmType === kType) {
    score += 10; reasons.push(`Type: ${pmType}`); typeArbGate = true;
  } else {
    // TOUCH_BY vs CLOSE_AT are fundamentally different products — different settlement
    // logic means these are NOT real arbs. Keep as research-only with risk flag.
    typeRisk = `${pmType} vs ${kType}`;
    reasons.push(`Type mismatch (PM=${pmType} K=${kType}) — different settlement logic`);
  }

  // Expiry proximity (up to +25)
  // Expiry gate depends on predicate type:
  //   CLOSE_AT: within 24h — PM and Kalshi often set different close times for the same event
  //   TOUCH_BY: within 24h is acceptable (both "touch by" a similar deadline)
  const maxExpiryForArb = (pmType === kType) ? 86400 : 14400;
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
      expiryArbGate = maxExpiryForArb >= 86400;
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
    if (!expiryArbGate) missing.push(`expiry>${maxExpiryForArb / 3600}h`);
    if (!thresholdArbGate) missing.push('threshold>1%');
    if (!typeArbGate) missing.push(`type mismatch (${pmType}≠${kType})`);
    if (!directionArbGate) missing.push('direction mismatch');
    reasons.push(`Research-only: ${missing.join(', ')}`);
  }

  return { score, reasons, bucket, expiryDeltaSeconds, thresholdDeltaPct, typeRisk };
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

/**
 * Auto-approve high-confidence arb-eligible suggestions.
 * Replicates the validation logic from the /approve route.
 * Returns the number of auto-approved mappings.
 */
export function autoApproveHighConfidence(): number {
  const db = getDb();
  const minScore = parseInt(process.env.AUTO_APPROVE_MIN_SCORE || '90', 10);

  const candidates = db.prepare(`
    SELECT * FROM mapping_suggestions
    WHERE status = 'suggested' AND bucket = 'arb_eligible' AND score >= ?
    ORDER BY score DESC
  `).all(minScore) as any[];

  if (candidates.length === 0) return 0;

  let approved = 0;

  for (const suggestion of candidates) {
    // Validate PM market
    const pmMarket = db.prepare(
      `SELECT * FROM canonical_markets WHERE venue = 'POLYMARKET' AND venue_market_id = ?`
    ).get(suggestion.polymarket_market_id) as any;
    if (!pmMarket || !pmMarket.yes_token_id || !pmMarket.no_token_id || pmMarket.status !== 'open') {
      continue;
    }

    // Validate Kalshi market
    const kalshiMarket = db.prepare(
      `SELECT * FROM canonical_markets WHERE venue = 'KALSHI' AND venue_market_id = ?`
    ).get(suggestion.kalshi_market_id) as any;
    if (!kalshiMarket || !kalshiMarket.yes_token_id || !kalshiMarket.no_token_id || kalshiMarket.status !== 'open') {
      continue;
    }

    // Create mapping
    const label = `${pmMarket.question.slice(0, 60)} <-> ${kalshiMarket.question.slice(0, 60)}`;
    const mappingId = uuid();

    try {
      db.prepare(`
        INSERT INTO match_mappings (id, polymarket_market_id, kalshi_market_id, label, confidence, enabled, mapping_kind)
        VALUES (?, ?, ?, ?, ?, 1, 'auto_approved')
      `).run(mappingId, suggestion.polymarket_market_id, suggestion.kalshi_market_id, label, suggestion.score);
    } catch (err: any) {
      if (err.message?.includes('UNIQUE constraint')) {
        // Mapping already exists — only mark approved if the existing mapping is enabled
        const existing = db.prepare(
          `SELECT enabled FROM match_mappings WHERE polymarket_market_id = ? AND kalshi_market_id = ?`
        ).get(suggestion.polymarket_market_id, suggestion.kalshi_market_id) as any;
        if (existing?.enabled === 1) {
          db.prepare(`UPDATE mapping_suggestions SET status = 'approved', updated_at = datetime('now') WHERE id = ?`).run(suggestion.id);
        }
        continue;
      }
      console.error(`[auto-approve] Failed to create mapping:`, err.message);
      continue;
    }

    // Update suggestion status
    db.prepare(`UPDATE mapping_suggestions SET status = 'approved', updated_at = datetime('now') WHERE id = ?`).run(suggestion.id);
    console.log(`[auto-approve] Created mapping: ${label} (score=${suggestion.score})`);
    approved++;
  }

  if (approved > 0) {
    console.log(`[auto-approve] Auto-approved ${approved} high-confidence mappings (minScore=${minScore})`);
  }
  return approved;
}
