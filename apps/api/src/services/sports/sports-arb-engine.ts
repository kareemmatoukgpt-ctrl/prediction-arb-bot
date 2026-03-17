/**
 * Sports arbitrage detection engine.
 * Compares prices across venues for the same game and bet type.
 * Reuses core arb math from @prediction-arb-bot/core.
 */

import { v4 as uuid } from 'uuid';
import { checkArbDirection, DEFAULT_COST_PARAMS } from '@prediction-arb-bot/core';
import type { CostModelParams } from '@prediction-arb-bot/core';
import { getDb } from '../../db/schema';

const SIZE_USD = parseFloat(process.env.DEFAULT_TRADE_SIZE_USD || '100');

interface SportsMarketRow {
  id: string;
  event_id: string;
  venue: string;
  venue_market_id: string;
  question: string;
  bet_type: string;
  side: string;
  line: number | null;
  yes_price: number | null;
  no_price: number | null;
}

interface ArbCandidate {
  eventId: string;
  betType: string;
  marketA: SportsMarketRow;
  marketB: SportsMarketRow;
}

/**
 * Scan all sports events with multi-venue coverage for arbitrage opportunities.
 * Returns count of arbs found.
 */
export function scanSportsArbs(): number {
  const db = getDb();
  const costParams: CostModelParams = {
    polymarketTakerFeeBps: parseInt(process.env.PM_TAKER_FEE_BPS || '100', 10),
    kalshiTakerFeeBps: parseInt(process.env.KALSHI_TAKER_FEE_BPS || '70', 10),
    slippageBps: parseInt(process.env.SLIPPAGE_BPS || '50', 10),
    arbThresholdBps: parseInt(process.env.ARB_THRESHOLD_BPS || '50', 10),
  };

  // Find events with markets on multiple venues
  const eventsWithMultiVenue = db.prepare(`
    SELECT DISTINCT sm.event_id
    FROM sports_markets sm
    CROSS JOIN sports_events se ON se.id = sm.event_id
    WHERE se.status = 'upcoming'
      AND sm.yes_price IS NOT NULL
    GROUP BY sm.event_id
    HAVING COUNT(DISTINCT sm.venue) >= 2
  `).all() as any[];

  const upsertArb = db.prepare(`
    INSERT INTO sports_arbs (id, event_id, bet_type, side_a, side_b, venue_a, venue_b,
      market_a_id, market_b_id, price_a, price_b, combined_cost, edge_bps,
      profit_per_dollar, size_usd, profit_usd, status, found_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    ON CONFLICT(market_a_id, market_b_id) DO UPDATE SET
      price_a = excluded.price_a,
      price_b = excluded.price_b,
      combined_cost = excluded.combined_cost,
      edge_bps = excluded.edge_bps,
      profit_per_dollar = excluded.profit_per_dollar,
      profit_usd = excluded.profit_usd,
      status = 'active',
      expired_at = NULL
  `);

  let arbCount = 0;
  const activeKeys = new Set<string>();

  const runScan = db.transaction(() => {
    for (const ev of eventsWithMultiVenue) {
      const markets = db.prepare(`
        SELECT id, event_id, venue, venue_market_id, question, bet_type, side, line, yes_price, no_price
        FROM sports_markets
        WHERE event_id = ? AND yes_price IS NOT NULL
      `).all(ev.event_id) as SportsMarketRow[];

      const candidates = findArbCandidates(markets);

      for (const cand of candidates) {
        const result = evaluateCandidate(cand, costParams);
        if (result) {
          const arbId = uuid();
          upsertArb.run(
            arbId,
            cand.eventId,
            cand.betType,
            cand.marketA.side,
            cand.marketB.side,
            cand.marketA.venue,
            cand.marketB.venue,
            cand.marketA.id,
            cand.marketB.id,
            result.priceA,
            result.priceB,
            result.combinedCost,
            result.edgeBps,
            result.profitPerDollar,
            SIZE_USD,
            result.profitUsd,
          );
          activeKeys.add(`${cand.marketA.id}|${cand.marketB.id}`);
          arbCount++;
        }
      }
    }

    // Expire stale arbs
    const allActive = db.prepare(
      "SELECT id, market_a_id, market_b_id FROM sports_arbs WHERE status = 'active'",
    ).all() as any[];

    for (const row of allActive) {
      if (!activeKeys.has(`${row.market_a_id}|${row.market_b_id}`)) {
        db.prepare(
          "UPDATE sports_arbs SET status = 'expired', expired_at = datetime('now') WHERE id = ?",
        ).run(row.id);
      }
    }
  });

  runScan();

  if (arbCount > 0) {
    console.log(`[sports/arb] Found ${arbCount} arb opportunities`);
  }

  return arbCount;
}

/**
 * Find all cross-venue arb candidate pairs for a set of markets.
 */
function findArbCandidates(markets: SportsMarketRow[]): ArbCandidate[] {
  const candidates: ArbCandidate[] = [];

  // Group by bet_type
  const byType = new Map<string, SportsMarketRow[]>();
  for (const m of markets) {
    const key = m.bet_type;
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key)!.push(m);
  }

  for (const [betType, typeMarkets] of byType) {
    // Group by venue
    const byVenue = new Map<string, SportsMarketRow[]>();
    for (const m of typeMarkets) {
      if (!byVenue.has(m.venue)) byVenue.set(m.venue, []);
      byVenue.get(m.venue)!.push(m);
    }

    const venues = Array.from(byVenue.keys());
    if (venues.length < 2) continue;

    // Cross-venue pairs
    for (let i = 0; i < venues.length; i++) {
      for (let j = i + 1; j < venues.length; j++) {
        const marketsA = byVenue.get(venues[i])!;
        const marketsB = byVenue.get(venues[j])!;

        if (betType === 'MONEYLINE') {
          // Match HOME on venue A with AWAY on venue B and vice versa
          for (const mA of marketsA) {
            for (const mB of marketsB) {
              if (areOppositeSides(mA.side, mB.side)) {
                candidates.push({ eventId: mA.event_id, betType, marketA: mA, marketB: mB });
              }
            }
          }
        } else if (betType === 'SPREAD' || betType === 'TOTAL') {
          // Must have matching |line| values
          for (const mA of marketsA) {
            for (const mB of marketsB) {
              if (
                mA.line !== null &&
                mB.line !== null &&
                Math.abs(Math.abs(mA.line) - Math.abs(mB.line)) < 0.01 &&
                areOppositeSides(mA.side, mB.side)
              ) {
                candidates.push({ eventId: mA.event_id, betType, marketA: mA, marketB: mB });
              }
            }
          }
        }
      }
    }
  }

  return candidates;
}

/**
 * Check if two sides are opposite (can form a binary arb pair).
 */
function areOppositeSides(a: string, b: string): boolean {
  const pairs: Record<string, string> = {
    HOME: 'AWAY',
    AWAY: 'HOME',
    OVER: 'UNDER',
    UNDER: 'OVER',
    YES: 'NO',
    NO: 'YES',
  };
  return pairs[a] === b;
}

/**
 * Evaluate whether a candidate pair constitutes an arb.
 * Uses the core checkArbDirection function.
 */
function evaluateCandidate(
  cand: ArbCandidate,
  costParams: CostModelParams,
): {
  priceA: number;
  priceB: number;
  combinedCost: number;
  edgeBps: number;
  profitPerDollar: number;
  profitUsd: number;
} | null {
  const priceA = cand.marketA.yes_price;
  const priceB = cand.marketB.yes_price;

  if (priceA === null || priceB === null) return null;
  if (priceA <= 0 || priceB <= 0) return null;

  // Determine direction for fee assignment
  const direction =
    cand.marketA.venue === 'POLYMARKET'
      ? 'BUY_YES_PM_BUY_NO_KALSHI' as const
      : 'BUY_NO_PM_BUY_YES_KALSHI' as const;

  const result = checkArbDirection(priceA, priceB, SIZE_USD, costParams, direction);

  if (!result.isArb) return null;

  return {
    priceA,
    priceB,
    combinedCost: result.totalCost,
    edgeBps: result.expectedProfitBps,
    profitPerDollar: result.expectedProfitUSD / SIZE_USD,
    profitUsd: result.expectedProfitUSD,
  };
}
