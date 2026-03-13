import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';
import { detectArb, DEFAULT_COST_PARAMS, ArbCheckResult } from '@prediction-arb-bot/core';
import { CostModelParams } from '@prediction-arb-bot/core';

function getCostParams(): CostModelParams {
  return {
    polymarketTakerFeeBps: parseInt(process.env.PM_TAKER_FEE_BPS || '0', 10),
    kalshiTakerFeeBps: parseInt(process.env.KALSHI_TAKER_FEE_BPS || '0', 10),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || '10', 10),
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
      pm.id as pm_id,
      k.id as k_id
    FROM match_mappings m
    JOIN canonical_markets pm ON pm.venue = 'POLYMARKET' AND pm.venue_market_id = m.polymarket_market_id
    JOIN canonical_markets k ON k.venue = 'KALSHI' AND k.venue_market_id = m.kalshi_market_id
    WHERE m.enabled = 1
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

  const opportunities: any[] = [];
  const activeKeys = new Set<string>();

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
  if (result.changes > 0) {
    console.log(`[arb-engine] Cleaned up ${result.changes} old opportunities`);
  }
  return result.changes;
}

// ── Arb scanning loop ──

let arbTimer: NodeJS.Timeout | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;

export function startArbScanner(): void {
  const interval = parseInt(process.env.ORDERBOOK_REFRESH_INTERVAL_MS || '5000', 10);
  console.log(`[arb-engine] Starting arb scanner every ${interval}ms`);

  arbTimer = setInterval(() => {
    try {
      scanForArbs();
    } catch (err) {
      console.error('[arb-engine] Scan error:', err);
    }
  }, interval);

  // Cleanup old opportunities every hour
  cleanupTimer = setInterval(() => {
    try {
      cleanupOldOpportunities();
    } catch (err) {
      console.error('[arb-engine] Cleanup error:', err);
    }
  }, 60 * 60 * 1000);
}

export function stopArbScanner(): void {
  if (arbTimer) clearInterval(arbTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  arbTimer = null;
  cleanupTimer = null;
}
