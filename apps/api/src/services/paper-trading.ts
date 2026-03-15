import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';
import { simulateExecution, ArbCheckResult, SimParams } from '@prediction-arb-bot/core';

/**
 * Execute a paper trade for a given arb opportunity.
 */
export function executePaperTrade(opportunityId: string): any {
  const db = getDb();

  let opp = db.prepare(`
    SELECT * FROM arb_opportunities WHERE id = ?
  `).get(opportunityId) as any;

  if (!opp) {
    // Try looking up via opportunity_feed (frontend passes feed IDs)
    const feedItem = db.prepare('SELECT mapping_id, direction FROM opportunity_feed WHERE id = ?').get(opportunityId) as any;
    if (feedItem) {
      opp = db.prepare('SELECT * FROM arb_opportunities WHERE mapping_id = ? AND direction = ?').get(feedItem.mapping_id, feedItem.direction) as any;
    }
  }
  if (!opp) {
    throw new Error(`Opportunity not found: ${opportunityId}`);
  }

  const simParams: SimParams = {
    latencyMs:
      Math.random() *
        (parseInt(process.env.SIM_LATENCY_MAX_MS || '2000', 10) -
          parseInt(process.env.SIM_LATENCY_MIN_MS || '250', 10)) +
      parseInt(process.env.SIM_LATENCY_MIN_MS || '250', 10),
    slippageModel: 'fixed_bps',
    slippageBps: parseInt(process.env.SIM_SLIPPAGE_BPS || '10', 10),
    fillModel: 'full',
  };

  const arbResult: ArbCheckResult = {
    isArb: true,
    direction: opp.direction,
    costYes: opp.cost_yes,
    costNo: opp.cost_no,
    totalCost: opp.cost_yes + opp.cost_no,  // per-unit (consistent with ArbCheckResult)
    feesEstimate: opp.fees_estimate,
    slippageEstimate: opp.slippage_estimate,
    expectedProfitUSD: opp.expected_profit_usd,
    expectedProfitBps: opp.expected_profit_bps,
  };

  const result = simulateExecution(arbResult, simParams);

  const id = uuid();
  const status = result.failureReason && result.pnl <= 0 ? 'FAILED' : 'SIMULATED';

  db.prepare(`
    INSERT INTO paper_trades (id, opportunity_id, ts, sim_params, result, status)
    VALUES (?, ?, datetime('now'), ?, ?, ?)
  `).run(id, opportunityId, JSON.stringify(simParams), JSON.stringify(result), status);

  return {
    id,
    opportunityId,
    simParams,
    result,
    status,
  };
}

/**
 * Get all paper trades with optional filtering.
 */
export function getPaperTrades(limit = 50): any[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT pt.*, ao.direction, ao.mapping_id, ao.expected_profit_usd,
           mm.label as mapping_label
    FROM paper_trades pt
    JOIN arb_opportunities ao ON ao.id = pt.opportunity_id
    LEFT JOIN match_mappings mm ON mm.id = ao.mapping_id
    ORDER BY pt.ts DESC
    LIMIT ?
  `).all(limit) as any[];

  return rows.map((r) => ({
    ...r,
    sim_params: JSON.parse(r.sim_params),
    result: JSON.parse(r.result),
  }));
}

/**
 * Get paper trading summary stats.
 */
export function getPaperTradingStats(): any {
  const db = getDb();

  const total = db.prepare('SELECT COUNT(*) as count FROM paper_trades').get() as any;
  const simulated = db.prepare("SELECT COUNT(*) as count FROM paper_trades WHERE status = 'SIMULATED'").get() as any;
  const failed = db.prepare("SELECT COUNT(*) as count FROM paper_trades WHERE status = 'FAILED'").get() as any;

  const trades = db.prepare(`
    SELECT result FROM paper_trades WHERE status = 'SIMULATED'
  `).all() as any[];

  let totalPnl = 0;
  for (const t of trades) {
    const result = JSON.parse(t.result);
    totalPnl += result.pnl || 0;
  }

  return {
    totalTrades: total.count,
    simulated: simulated.count,
    failed: failed.count,
    totalPnl,
    avgPnl: simulated.count > 0 ? totalPnl / simulated.count : 0,
  };
}
