import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';
import { extractMarketEntity, compareEntities, MarketEntity } from './llm-extractor';

interface MatchCandidate {
  pm_market_id: string;
  kalshi_market_id: string;
  pm_question: string;
  kalshi_question: string;
  pm_entity: MarketEntity;
  kalshi_entity: MarketEntity;
  score: number;
  confidence: number;
  risks: string[];
  bucket: 'arb_eligible' | 'research';
}

/**
 * Smart matching pipeline using LLM entity extraction.
 *
 * Flow:
 * 1. Fetch all unmatched markets from both venues
 * 2. Group by asset category (FED, GDP, CPI, crypto, etc.)
 * 3. For each group, extract entities via LLM
 * 4. Compare entities deterministically
 * 5. Upsert high-quality suggestions
 */
export async function runSmartMatcher(options: {
  maxMarkets?: number;
  minConfidence?: number;
} = {}): Promise<{
  processed: number;
  matches: number;
  arb_eligible: number;
  research: number;
  errors: number;
}> {
  const db = getDb();
  const maxMarkets = options.maxMarkets ?? 500;
  const minConfidence = options.minConfidence ?? 0.6;
  const start = Date.now();

  // Get markets that could benefit from smart matching
  // Focus on structured markets (FED, MACRO, crypto) where we have asset tags
  const pmMarkets = db.prepare(`
    SELECT venue_market_id, question, asset, category, predicate_type,
           predicate_threshold, predicate_direction, expiry_ts
    FROM canonical_markets
    WHERE venue = 'POLYMARKET' AND status = 'open' AND asset IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(maxMarkets) as any[];

  const kalshiMarkets = db.prepare(`
    SELECT venue_market_id, question, asset, category, predicate_type,
           predicate_threshold, predicate_direction, expiry_ts
    FROM canonical_markets
    WHERE venue = 'KALSHI' AND status = 'open' AND asset IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(maxMarkets) as any[];

  // Group Kalshi by asset for efficient lookup
  const kalshiByAsset = new Map<string, typeof kalshiMarkets>();
  for (const k of kalshiMarkets) {
    if (!k.asset) continue;
    const list = kalshiByAsset.get(k.asset) ?? [];
    list.push(k);
    kalshiByAsset.set(k.asset, list);
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

  let processed = 0;
  let matches = 0;
  let arb_eligible = 0;
  let research = 0;
  let errors = 0;

  for (const pm of pmMarkets) {
    const candidates = kalshiByAsset.get(pm.asset) ?? [];
    if (candidates.length === 0) continue;

    let pmEntity: MarketEntity;
    try {
      pmEntity = await extractMarketEntity(pm.question, 'POLYMARKET');
    } catch {
      errors++;
      continue;
    }

    for (const kalshi of candidates) {
      processed++;

      let kalshiEntity: MarketEntity;
      try {
        kalshiEntity = await extractMarketEntity(kalshi.question, 'KALSHI');
      } catch {
        errors++;
        continue;
      }

      const comparison = compareEntities(pmEntity, kalshiEntity);

      if (comparison.confidence < minConfidence) continue;

      // Build score (0-100)
      const score = Math.round(comparison.confidence * 100);
      const bucket = comparison.match ? 'arb_eligible' : 'research';
      const reasons = [
        `Smart match: ${(comparison.confidence * 100).toFixed(0)}% confidence`,
        `PM: ${pmEntity.predicate} ${pmEntity.threshold ?? '?'} (${pmEntity.geography})`,
        `K: ${kalshiEntity.predicate} ${kalshiEntity.threshold ?? '?'} (${kalshiEntity.geography})`,
        ...comparison.risks,
      ];

      const expiryDelta = pm.expiry_ts && kalshi.expiry_ts
        ? Math.abs(pm.expiry_ts - kalshi.expiry_ts) : null;
      const threshDelta = pm.predicate_threshold != null && kalshi.predicate_threshold != null && kalshi.predicate_threshold !== 0
        ? Math.abs(pm.predicate_threshold - kalshi.predicate_threshold) / kalshi.predicate_threshold : null;

      try {
        const info = upsert.run(
          uuid(),
          pm.venue_market_id,
          kalshi.venue_market_id,
          score,
          JSON.stringify(reasons),
          bucket,
          expiryDelta,
          threshDelta,
        );
        if (info.changes > 0) {
          matches++;
          if (bucket === 'arb_eligible') arb_eligible++;
          else research++;
        }
      } catch {
        errors++;
      }
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[smart-matcher] Done in ${elapsed}s: processed=${processed}, matches=${matches} (arb=${arb_eligible}, research=${research}), errors=${errors}`);

  return { processed, matches, arb_eligible, research, errors };
}
