import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';

/**
 * Conditional arb detection — finds structural pricing inefficiencies
 * within groups of related markets on the same or different venues.
 *
 * Types:
 * - complement: Two binary outcomes that should sum to ~1.00 (YES_A + YES_B)
 * - mutex: N mutually exclusive outcomes that should sum to ~1.00
 * - cross_venue_complement: Same outcome on PM and Kalshi (PM YES + K NO ≈ 1.00)
 */

interface ConditionalOpportunity {
  type: 'complement' | 'mutex';
  venue: string;
  eventGroup: string;
  markets: { marketId: string; question: string; yesAsk: number | null; noAsk: number | null }[];
  impliedProbabilitySum: number;
  edgeBps: number;
  description: string;
}

/**
 * Scan for complement/mutex arbs within a single venue.
 *
 * Groups markets by event_group, then checks if YES prices across
 * mutually exclusive outcomes sum to significantly more (or less) than 1.00.
 *
 * Example: If Kalshi has "Trump wins" YES=$0.55 and "Harris wins" YES=$0.52,
 * the sum is $1.07. Selling both YES positions guarantees $0.07 profit
 * (minus fees) since exactly one resolves YES.
 */
export function scanConditionalArbs(thresholdBps = 200): ConditionalOpportunity[] {
  const db = getDb();

  // Find event groups with 2+ markets on the same venue
  const groups = db.prepare(`
    SELECT venue, event_group, COUNT(*) as cnt
    FROM canonical_markets
    WHERE event_group IS NOT NULL AND status = 'open'
    GROUP BY venue, event_group
    HAVING cnt >= 2 AND cnt <= 20
    ORDER BY cnt DESC
  `).all() as any[];

  const opportunities: ConditionalOpportunity[] = [];

  for (const group of groups) {
    // Get all markets in this group with latest orderbook snapshots
    const markets = db.prepare(`
      SELECT cm.id, cm.venue_market_id, cm.question,
        os.best_yes_ask, os.best_no_ask, os.best_yes_bid, os.best_no_bid, os.ts
      FROM canonical_markets cm
      LEFT JOIN (
        SELECT market_id, best_yes_ask, best_no_ask, best_yes_bid, best_no_bid, ts,
          ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY ts DESC) as rn
        FROM orderbook_snapshots
      ) os ON os.market_id = cm.id AND os.rn = 1
      WHERE cm.venue = ? AND cm.event_group = ? AND cm.status = 'open'
    `).all(group.venue, group.event_group) as any[];

    // Filter to markets with valid YES ask prices
    const priced = markets.filter((m: any) => m.best_yes_ask != null && m.best_yes_ask > 0.01);

    if (priced.length < 2) continue;

    // Sum all YES ask prices
    const yesAskSum = priced.reduce((sum: number, m: any) => sum + m.best_yes_ask, 0);

    // If sum > 1.00 + threshold → overpriced (sell all YES)
    // If sum < 1.00 - threshold → underpriced (buy all YES)
    const edgeBps = Math.round(Math.abs(yesAskSum - 1.0) * 10000);

    if (edgeBps >= thresholdBps) {
      const type = priced.length === 2 ? 'complement' : 'mutex';
      const direction = yesAskSum > 1.0 ? 'overpriced (sell all YES)' : 'underpriced (buy all YES)';

      opportunities.push({
        type,
        venue: group.venue,
        eventGroup: group.event_group,
        markets: priced.map((m: any) => ({
          marketId: m.venue_market_id,
          question: m.question,
          yesAsk: m.best_yes_ask,
          noAsk: m.best_no_ask,
        })),
        impliedProbabilitySum: yesAskSum,
        edgeBps,
        description: `${group.venue} ${group.event_group}: ${priced.length} outcomes, sum=${yesAskSum.toFixed(4)}, ${direction}`,
      });
    }
  }

  if (opportunities.length > 0) {
    console.log(`[conditional] Found ${opportunities.length} conditional opportunities`);
  }
  return opportunities;
}

/**
 * Upsert conditional opportunities into the opportunity_feed table.
 * These use a synthetic mapping_id based on the event group.
 */
export function upsertConditionalOpportunities(opportunities: ConditionalOpportunity[]): number {
  if (opportunities.length === 0) return 0;

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO opportunity_feed (
      id, mapping_id, category, venue_a, venue_b, direction, label,
      pm_yes_ask, pm_no_ask, kalshi_yes_ask, kalshi_no_ask,
      total_cost, expected_profit_usd, expected_profit_bps, size_usd,
      liquidity_score, suspect, suspect_reasons, arb_type, ts_updated
    ) VALUES (?, ?, 'EVENT', ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, 100,
      0, ?, ?, ?, datetime('now'))
    ON CONFLICT(mapping_id, direction) DO UPDATE SET
      label = excluded.label,
      pm_yes_ask = excluded.pm_yes_ask,
      pm_no_ask = excluded.pm_no_ask,
      kalshi_yes_ask = excluded.kalshi_yes_ask,
      kalshi_no_ask = excluded.kalshi_no_ask,
      total_cost = excluded.total_cost,
      expected_profit_usd = excluded.expected_profit_usd,
      expected_profit_bps = excluded.expected_profit_bps,
      suspect = excluded.suspect,
      suspect_reasons = excluded.suspect_reasons,
      arb_type = excluded.arb_type,
      ts_updated = datetime('now')
  `);

  let count = 0;
  for (const opp of opportunities) {
    // Use event_group as a synthetic mapping_id for dedup
    const syntheticMappingId = `conditional:${opp.venue}:${opp.eventGroup}`;
    const direction = opp.impliedProbabilitySum > 1.0 ? 'SELL_ALL_YES' : 'BUY_ALL_YES';

    const totalCost = opp.impliedProbabilitySum;
    const profitUsd = Math.abs(opp.impliedProbabilitySum - 1.0) * 100; // per $100
    const isSuspect = opp.edgeBps > 5000 ? 1 : 0;
    const suspectReasons = opp.edgeBps > 5000 ? `Edge ${opp.edgeBps}bps absurdly high` : null;

    // For display: show first two market prices
    const m0 = opp.markets[0];
    const m1 = opp.markets[1];

    upsert.run(
      uuid(),
      syntheticMappingId,
      opp.venue, opp.venue, // venue_a = venue_b (same venue arb)
      direction,
      opp.description,
      m0?.yesAsk ?? null, m0?.noAsk ?? null,
      m1?.yesAsk ?? null, m1?.noAsk ?? null,
      totalCost,
      profitUsd,
      opp.edgeBps,
      isSuspect,
      suspectReasons,
      opp.type,
    );
    count++;
  }

  console.log(`[conditional] Upserted ${count} conditional opportunities to feed`);
  return count;
}
