import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';
import { detectArb, DEFAULT_COST_PARAMS, ArbCheckResult } from '@prediction-arb-bot/core';
import { CostModelParams } from '@prediction-arb-bot/core';

/**
 * Compute a 0-100 liquidity score from two orderbook snapshots.
 * Based on available depth (total size within 5% of best price).
 */
function computeLiquidityScore(pmSnapshot: any, kalshiSnapshot: any): number {
  let totalDepth = 0;
  try {
    const pmDepth: { price: number; size: number }[] = pmSnapshot.depth_json
      ? JSON.parse(pmSnapshot.depth_json) : [];
    for (const level of pmDepth) {
      totalDepth += (level.price || 0) * (level.size || 0);
    }
  } catch { /* ignore parse errors */ }

  // Kalshi doesn't expose depth levels — small baseline if valid prices exist
  if (kalshiSnapshot.best_yes_ask != null && kalshiSnapshot.best_no_ask != null
      && kalshiSnapshot.best_yes_ask > 0.01 && kalshiSnapshot.best_no_ask > 0.01) {
    totalDepth += 10;
  }

  // Scale: 0 depth = 0, 200+ dollar depth = 100
  return Math.min(100, Math.round(totalDepth / 2));
}

function getCostParams(): CostModelParams {
  return {
    polymarketTakerFeeBps: parseInt(process.env.PM_TAKER_FEE_BPS || '100', 10),   // PM: ~1% effective fee
    kalshiTakerFeeBps: parseInt(process.env.KALSHI_TAKER_FEE_BPS || '70', 10),     // Kalshi: ~0.7% taker fee
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || '50', 10),                    // 50bps slippage per side
    arbThresholdBps: parseInt(process.env.ARB_THRESHOLD_BPS || '50', 10),
  };
}

/**
 * Scan all enabled mappings for arb opportunities using latest orderbook snapshots.
 * Uses upsert to keep only the latest opportunity per (mapping_id, direction).
 */
export function scanForArbs(): { found: number; opportunities: any[] } {
  const db = getDb();

  const sizeUSD = parseFloat(process.env.DEFAULT_TRADE_SIZE_USD || '100');
  const costParams = getCostParams();

  // Get all enabled mappings with their latest orderbook snapshots
  const mappings = db.prepare(`
    SELECT
      m.id as mapping_id,
      m.polymarket_market_id,
      m.kalshi_market_id,
      m.label,
      m.mapping_kind,
      pm.id as pm_id,
      pm.url as pm_url,
      pm.asset as pm_asset,
      pm.expiry_ts as pm_expiry_ts,
      pm.predicate_type as pm_predicate_type,
      k.id as k_id,
      k.url as k_url,
      k.expiry_ts as k_expiry_ts,
      k.predicate_type as k_predicate_type
    FROM match_mappings m
    JOIN canonical_markets pm ON pm.venue = 'POLYMARKET' AND pm.venue_market_id = m.polymarket_market_id
    JOIN canonical_markets k ON k.venue = 'KALSHI' AND k.venue_market_id = m.kalshi_market_id
    WHERE m.enabled = 1
      AND pm.status = 'open'
      AND k.status = 'open'
  `).all() as any[];

  const latestSnapshot = db.prepare(`
    SELECT best_yes_bid, best_yes_ask, best_no_bid, best_no_ask, ts
    FROM orderbook_snapshots
    WHERE market_id = ?
    ORDER BY ts DESC
    LIMIT 1
  `);

  // Upsert: insert or update by (mapping_id, direction) unique constraint
  const upsertArb = db.prepare(`
    INSERT INTO arb_opportunities (id, ts, mapping_id, direction, size_usd, cost_yes, cost_no, fees_estimate, slippage_estimate, buffer_bps, expected_profit_usd, expected_profit_bps, notes)
    VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mapping_id, direction) DO UPDATE SET
      ts = datetime('now'),
      size_usd = excluded.size_usd,
      cost_yes = excluded.cost_yes,
      cost_no = excluded.cost_no,
      fees_estimate = excluded.fees_estimate,
      slippage_estimate = excluded.slippage_estimate,
      buffer_bps = excluded.buffer_bps,
      expected_profit_usd = excluded.expected_profit_usd,
      expected_profit_bps = excluded.expected_profit_bps,
      notes = excluded.notes
  `);

  // Upsert into opportunity_feed (denormalized for fast feed queries)
  const upsertFeed = db.prepare(`
    INSERT INTO opportunity_feed (
      id, mapping_id, category, venue_a, venue_b, direction, label,
      pm_yes_ask, pm_no_ask, kalshi_yes_ask, kalshi_no_ask,
      total_cost, expected_profit_usd, expected_profit_bps, size_usd,
      liquidity_score, expiry_ts, mapping_kind, suspect, suspect_reasons,
      pm_market_url, kalshi_market_url, type_risk, ts_updated
    ) VALUES (?, ?, ?, 'POLYMARKET', 'KALSHI', ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, datetime('now'))
    ON CONFLICT(mapping_id, direction) DO UPDATE SET
      pm_yes_ask = excluded.pm_yes_ask,
      pm_no_ask = excluded.pm_no_ask,
      kalshi_yes_ask = excluded.kalshi_yes_ask,
      kalshi_no_ask = excluded.kalshi_no_ask,
      total_cost = excluded.total_cost,
      expected_profit_usd = excluded.expected_profit_usd,
      expected_profit_bps = excluded.expected_profit_bps,
      size_usd = excluded.size_usd,
      liquidity_score = excluded.liquidity_score,
      expiry_ts = excluded.expiry_ts,
      mapping_kind = excluded.mapping_kind,
      suspect = excluded.suspect,
      suspect_reasons = excluded.suspect_reasons,
      pm_market_url = excluded.pm_market_url,
      kalshi_market_url = excluded.kalshi_market_url,
      type_risk = excluded.type_risk,
      ts_updated = datetime('now')
  `);

  const opportunities: any[] = [];
  const activeKeys = new Set<string>();

  // Wrap all upserts + stale cleanup in a single transaction for consistency
  const runScanTransaction = db.transaction(() => {

  for (const mapping of mappings) {
    const pmSnapshot = latestSnapshot.get(mapping.pm_id) as any;
    const kalshiSnapshot = latestSnapshot.get(mapping.k_id) as any;

    if (!pmSnapshot || !kalshiSnapshot) continue;

    const pmOb = {
      yesAsk: pmSnapshot.best_yes_ask,
      noAsk: pmSnapshot.best_no_ask,
    };

    const kalshiOb = {
      yesAsk: kalshiSnapshot.best_yes_ask,
      noAsk: kalshiSnapshot.best_no_ask,
    };

    // Require all 4 prices non-null — partial orderbooks create phantom arbs
    if (pmOb.yesAsk == null || pmOb.noAsk == null || kalshiOb.yesAsk == null || kalshiOb.noAsk == null) {
      continue;
    }

    // Sanity guard: if yesAsk + noAsk < 0.20 on either side, the mapping
    // is likely invalid (wrong direction pairing or stale data). Skip.
    const pmTotal = pmOb.yesAsk + pmOb.noAsk;
    const kTotal = kalshiOb.yesAsk + kalshiOb.noAsk;
    if (pmTotal < 0.20 || kTotal < 0.20) {
      continue;
    }

    const arbs = detectArb(pmOb, kalshiOb, sizeUSD, costParams);

    for (const arb of arbs) {
      const id = uuid();
      upsertArb.run(
        id,
        mapping.mapping_id,
        arb.direction,
        sizeUSD,
        arb.costYes,
        arb.costNo,
        arb.feesEstimate,
        arb.slippageEstimate,
        costParams.arbThresholdBps,
        arb.expectedProfitUSD,
        arb.expectedProfitBps,
        `Mapping: ${mapping.label}`,
      );

      activeKeys.add(`${mapping.mapping_id}|${arb.direction}`);

      // Determine suspect status
      const suspectReasons: string[] = [];
      if (arb.totalCost < 0.20) suspectReasons.push('totalCost < 0.20 per unit (likely invalid pairing)');
      if (arb.expectedProfitBps > 5000) suspectReasons.push(`profitBps=${arb.expectedProfitBps} (absurdly high)`);
      if (pmOb.yesAsk == null || pmOb.noAsk == null) suspectReasons.push('PM has null ask');
      if (kalshiOb.yesAsk == null || kalshiOb.noAsk == null) suspectReasons.push('Kalshi has null ask');

      // Stale orderbook check (>30s since snapshot)
      const now = new Date();
      // SQLite datetime('now') is UTC but lacks 'Z' suffix — append it for correct JS parsing
      const pmAge = pmSnapshot.ts ? (now.getTime() - new Date(pmSnapshot.ts + 'Z').getTime()) / 1000 : Infinity;
      const kAge = kalshiSnapshot.ts ? (now.getTime() - new Date(kalshiSnapshot.ts + 'Z').getTime()) / 1000 : Infinity;
      if (pmAge > 120) suspectReasons.push(`PM orderbook stale (${Math.round(pmAge)}s old)`);
      if (kAge > 120) suspectReasons.push(`Kalshi orderbook stale (${Math.round(kAge)}s old)`);

      const isSuspect = suspectReasons.length > 0 ? 1 : 0;

      // Determine category from asset and predicate type
      const asset = mapping.pm_asset || '';
      const pmType = mapping.pm_predicate_type || 'TOUCH_BY';
      let category = 'CRYPTO';
      if (asset === 'FED_RATE') category = 'FED';
      else if (asset === 'CPI' || asset === 'GDP') category = 'MACRO';
      else if (pmType === 'BINARY_EVENT') category = 'EVENT';

      // Detect type mismatch risk
      const kType = mapping.k_predicate_type || 'CLOSE_AT';
      const typeRisk = pmType !== kType ? `${pmType} vs ${kType}` : null;

      // Upsert to opportunity_feed
      const feedId = uuid();
      upsertFeed.run(
        feedId,
        mapping.mapping_id,
        category,
        arb.direction,
        mapping.label,
        pmSnapshot.best_yes_ask,
        pmSnapshot.best_no_ask,
        kalshiSnapshot.best_yes_ask,
        kalshiSnapshot.best_no_ask,
        arb.totalCost,
        arb.expectedProfitUSD,
        arb.expectedProfitBps,
        sizeUSD,
        computeLiquidityScore(pmSnapshot, kalshiSnapshot),
        mapping.pm_expiry_ts ?? mapping.k_expiry_ts ?? null,
        mapping.mapping_kind ?? null,
        isSuspect,
        suspectReasons.length > 0 ? suspectReasons.join('; ') : null,
        mapping.pm_url ?? null,
        mapping.k_url ?? null,
        typeRisk,
      );

      opportunities.push({
        id,
        mappingId: mapping.mapping_id,
        label: mapping.label,
        direction: arb.direction,
        costYes: arb.costYes,
        costNo: arb.costNo,
        totalCost: arb.totalCost,
        expectedProfitUSD: arb.expectedProfitUSD,
        expectedProfitBps: arb.expectedProfitBps,
        pmSnapshot: {
          yesAsk: pmSnapshot.best_yes_ask,
          noAsk: pmSnapshot.best_no_ask,
          ts: pmSnapshot.ts,
        },
        kalshiSnapshot: {
          yesAsk: kalshiSnapshot.best_yes_ask,
          noAsk: kalshiSnapshot.best_no_ask,
          ts: kalshiSnapshot.ts,
        },
      });
    }
  }

  // Remove stale opportunities that are no longer active
  const allExisting = db.prepare(
    'SELECT id, mapping_id, direction FROM arb_opportunities'
  ).all() as any[];
  const deleteStale = db.prepare('DELETE FROM arb_opportunities WHERE id = ?');
  for (const row of allExisting) {
    if (!activeKeys.has(`${row.mapping_id}|${row.direction}`)) {
      deleteStale.run(row.id);
    }
  }

  // Also clean stale feed entries — only cross-venue (conditional arbs are managed separately)
  const allFeedEntries = db.prepare(
    "SELECT id, mapping_id, direction FROM opportunity_feed WHERE arb_type = 'cross_venue' OR arb_type IS NULL"
  ).all() as any[];
  const deleteStaleFeed = db.prepare('DELETE FROM opportunity_feed WHERE id = ?');
  for (const row of allFeedEntries) {
    if (!activeKeys.has(`${row.mapping_id}|${row.direction}`)) {
      deleteStaleFeed.run(row.id);
    }
  }

  }); // end transaction definition

  runScanTransaction(); // execute

  if (mappings.length > 0) {
    console.log(`[arb-engine] Scanned ${mappings.length} mappings, found ${opportunities.length} opportunities`);
  }
  return { found: opportunities.length, opportunities };
}

/**
 * Delete arb opportunities older than 7 days.
 */
export function cleanupOldOpportunities(): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM arb_opportunities
    WHERE ts < datetime('now', '-7 days')
  `).run();
  // Also clean old feed entries
  const feedResult = db.prepare(`
    DELETE FROM opportunity_feed
    WHERE ts_updated < datetime('now', '-7 days')
  `).run();
  const total = result.changes + feedResult.changes;
  if (total > 0) {
    console.log(`[arb-engine] Cleaned up ${result.changes} old opportunities, ${feedResult.changes} old feed entries`);
  }
  return total;
}

// ── Cleanup timer (arb scanning is now chained after orderbook refresh in ingestion.ts) ──

let cleanupTimer: NodeJS.Timeout | null = null;

export function startCleanupTimer(): void {
  console.log('[arb-engine] Starting opportunity cleanup every 60 min');
  cleanupTimer = setInterval(() => {
    try {
      cleanupOldOpportunities();
    } catch (err) {
      console.error('[arb-engine] Cleanup error:', err);
    }
  }, 60 * 60 * 1000);
}

export function stopCleanupTimer(): void {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
}
