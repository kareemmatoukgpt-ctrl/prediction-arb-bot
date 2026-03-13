import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';
import { detectArb, DEFAULT_COST_PARAMS, ArbCheckResult } from '@prediction-arb-bot/core';

/**
 * Scan all enabled mappings for arb opportunities using latest orderbook snapshots.
 */
export function scanForArbs(): { found: number; opportunities: any[] } {
  const db = getDb();

  const sizeUSD = parseFloat(process.env.DEFAULT_TRADE_SIZE_USD || '100');
  const bufferBps = parseInt(process.env.BUFFER_BPS || '50', 10);

  const costParams = {
    ...DEFAULT_COST_PARAMS,
    bufferBps,
  };

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

  const insertArb = db.prepare(`
    INSERT INTO arb_opportunities (id, ts, mapping_id, direction, size_usd, cost_yes, cost_no, fees_estimate, slippage_estimate, buffer_bps, expected_profit_usd, expected_profit_bps, notes)
    VALUES (?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const opportunities: any[] = [];

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
      insertArb.run(
        id,
        mapping.mapping_id,
        arb.direction,
        sizeUSD,
        arb.costYes,
        arb.costNo,
        arb.feesEstimate,
        arb.slippageEstimate,
        bufferBps,
        arb.expectedProfitUSD,
        arb.expectedProfitBps,
        `Mapping: ${mapping.label}`,
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

  console.log(`[arb-engine] Scanned ${mappings.length} mappings, found ${opportunities.length} opportunities`);
  return { found: opportunities.length, opportunities };
}

// ── Arb scanning loop ──

let arbTimer: NodeJS.Timeout | null = null;

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
}

export function stopArbScanner(): void {
  if (arbTimer) clearInterval(arbTimer);
  arbTimer = null;
}
