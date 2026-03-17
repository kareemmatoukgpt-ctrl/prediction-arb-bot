/**
 * Sports ingestion pipeline — polling loop for market fetching,
 * arb scanning, and cleanup.
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../../db/schema';
import { seedTeamAliases } from './seed-teams';
import { fetchKalshiSportsMarkets } from './kalshi-sports';
import { fetchPolymarketSportsMarkets } from './polymarket-sports';
import { resolveTeamName, matchOrCreateEvent } from './normalizer';
import { scanSportsArbs } from './sports-arb-engine';

let marketTimer: NodeJS.Timeout | null = null;
let arbTimer: NodeJS.Timeout | null = null;
let cleanupTimer: NodeJS.Timeout | null = null;

const BATCH_SIZE = 200;

export function startSportsIngestion(): void {
  console.log('[sports] Starting sports ingestion pipeline');

  // Seed team aliases on first run
  seedTeamAliases();

  // Initial fetch (deferred to not block startup)
  setTimeout(() => {
    refreshSportsMarkets().catch((err) =>
      console.error('[sports] Initial refresh failed:', err.message),
    );
  }, 5000);

  // Every 60s: fetch sports markets from Kalshi + Polymarket, normalize, upsert
  marketTimer = setInterval(() => {
    refreshSportsMarkets().catch((err) =>
      console.error('[sports] Market refresh failed:', err.message),
    );
  }, 60_000);

  // Every 30s: scan for arbs across all games with multi-venue coverage
  arbTimer = setInterval(() => {
    try {
      scanSportsArbs();
    } catch (err: any) {
      console.error('[sports] Arb scan failed:', err.message);
    }
  }, 30_000);

  // Every 5min: mark past games as 'final', expire old arbs
  cleanupTimer = setInterval(() => {
    try {
      cleanupSportsData();
    } catch (err: any) {
      console.error('[sports] Cleanup failed:', err.message);
    }
  }, 300_000);
}

export function stopSportsIngestion(): void {
  if (marketTimer) {
    clearInterval(marketTimer);
    marketTimer = null;
  }
  if (arbTimer) {
    clearInterval(arbTimer);
    arbTimer = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  console.log('[sports] Stopped sports ingestion pipeline');
}

/**
 * Fetch sports markets from all venues, normalize, and upsert.
 */
export async function refreshSportsMarkets(): Promise<{
  kalshi: number;
  polymarket: number;
  events: number;
}> {
  const db = getDb();

  // Fetch from both venues in parallel
  const [kalshiResult, pmResult] = await Promise.allSettled([
    fetchKalshiSportsMarkets(),
    fetchPolymarketSportsMarkets(),
  ]);

  const kalshiMarkets =
    kalshiResult.status === 'fulfilled' ? kalshiResult.value : [];
  const pmMarkets = pmResult.status === 'fulfilled' ? pmResult.value : [];

  if (kalshiResult.status === 'rejected') {
    console.error('[sports] Kalshi fetch failed:', kalshiResult.reason?.message);
  }
  if (pmResult.status === 'rejected') {
    console.error('[sports] Polymarket fetch failed:', pmResult.reason?.message);
  }

  const upsertMarket = db.prepare(`
    INSERT INTO sports_markets (id, event_id, venue, venue_market_id, question, bet_type, side, line, yes_price, no_price, url, last_fetched)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(venue, venue_market_id) DO UPDATE SET
      event_id = excluded.event_id,
      question = excluded.question,
      bet_type = excluded.bet_type,
      side = excluded.side,
      line = excluded.line,
      yes_price = excluded.yes_price,
      no_price = excluded.no_price,
      url = excluded.url,
      last_fetched = datetime('now')
  `);

  const runBatch = db.transaction(
    (
      items: Array<{
        venue: string;
        venueMarketId: string;
        sport: string;
        question: string;
        teams: string[];
        betType: string;
        side: string;
        line: number | null;
        yesPrice: number | null;
        noPrice: number | null;
        url: string;
        startTime: number;
      }>,
    ) => {
      for (const m of items) {
        // Resolve team names
        const teamA = resolveTeamName(m.teams[0] || '', m.sport);
        const teamB = m.teams[1] ? resolveTeamName(m.teams[1], m.sport) : null;

        // If we can't resolve at least one team, still store the market but without event linkage
        let eventId: string | null = null;
        if (teamA && teamB) {
          eventId = matchOrCreateEvent(m.sport, teamA, teamB, m.startTime);
        } else if (m.teams.length >= 2) {
          // Log unresolved teams so we can add aliases
          const unresolved = [
            !teamA ? m.teams[0] : null,
            !teamB ? m.teams[1] : null,
          ].filter(Boolean);
          console.log(`[sports] Unresolved teams in ${m.sport}: ${unresolved.join(', ')} (from: "${m.question.slice(0, 80)}")`);
        }

        upsertMarket.run(
          uuid(),
          eventId,
          m.venue,
          m.venueMarketId,
          m.question,
          m.betType,
          m.side,
          m.line,
          m.yesPrice,
          m.noPrice,
          m.url,
        );
      }
    },
  );

  let kalshiCount = 0;
  let pmCount = 0;
  const eventsBefore = (
    db.prepare('SELECT COUNT(*) as cnt FROM sports_events').get() as any
  ).cnt;

  // Process Kalshi markets in batches
  for (let i = 0; i < kalshiMarkets.length; i += BATCH_SIZE) {
    const batch = kalshiMarkets.slice(i, i + BATCH_SIZE);
    runBatch(
      batch.map((m) => ({
        venue: 'KALSHI',
        venueMarketId: m.venueMarketId,
        sport: m.sport,
        question: m.question,
        teams: m.teams,
        betType: m.betType,
        side: m.side,
        line: m.line,
        yesPrice: m.yesPrice,
        noPrice: m.noPrice,
        url: m.url,
        startTime: m.startTime,
      })),
    );
    kalshiCount += batch.length;
    if (i + BATCH_SIZE < kalshiMarkets.length) {
      await new Promise((r) => setImmediate(r));
    }
  }

  // Process Polymarket markets in batches
  for (let i = 0; i < pmMarkets.length; i += BATCH_SIZE) {
    const batch = pmMarkets.slice(i, i + BATCH_SIZE);
    runBatch(
      batch.map((m) => ({
        venue: 'POLYMARKET',
        venueMarketId: m.venueMarketId,
        sport: m.sport,
        question: m.question,
        teams: m.teams,
        betType: m.betType,
        side: m.side,
        line: m.line,
        yesPrice: m.yesPrice,
        noPrice: m.noPrice,
        url: m.url,
        startTime: m.startTime,
      })),
    );
    pmCount += batch.length;
    if (i + BATCH_SIZE < pmMarkets.length) {
      await new Promise((r) => setImmediate(r));
    }
  }

  const eventsAfter = (
    db.prepare('SELECT COUNT(*) as cnt FROM sports_events').get() as any
  ).cnt;
  const newEvents = eventsAfter - eventsBefore;

  console.log(
    `[sports] Refreshed: ${kalshiCount} Kalshi + ${pmCount} Polymarket markets, ${eventsAfter} events (${newEvents} new)`,
  );

  return { kalshi: kalshiCount, polymarket: pmCount, events: eventsAfter };
}

/**
 * Mark past games as 'final' and expire stale arbs.
 */
function cleanupSportsData(): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Mark past events as final (start_time + 4 hours in the past)
  const finalized = db.prepare(`
    UPDATE sports_events
    SET status = 'final', updated_at = datetime('now')
    WHERE status = 'upcoming' AND start_time < ?
  `).run(now - 14400); // 4 hours ago

  // Expire arbs for finalized events
  const expired = db.prepare(`
    UPDATE sports_arbs
    SET status = 'expired', expired_at = datetime('now')
    WHERE status = 'active'
      AND event_id IN (SELECT id FROM sports_events WHERE status = 'final')
  `).run();

  if (finalized.changes > 0 || expired.changes > 0) {
    console.log(
      `[sports/cleanup] Finalized ${finalized.changes} events, expired ${expired.changes} arbs`,
    );
  }
}
