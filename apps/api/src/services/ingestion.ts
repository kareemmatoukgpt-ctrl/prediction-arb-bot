import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';
import {
  fetchPolymarketMarkets,
  fetchPolymarketBinaryOrderbook,
  fetchKalshiMarkets,
  fetchKalshiBinaryOrderbook,
  fetchPolymarketCryptoMarkets,
  fetchKalshiCryptoMarkets,
  fetchKalshiFedMarkets,
  fetchKalshiMacroMarkets,
  fetchKalshiEventMarkets,
  fetchPolymarketCategorizedMarkets,
  NormalizedMarket,
} from './exchange';
import { generateSuggestions, autoApproveHighConfidence } from './crypto-matcher';
import { generateEventSuggestions } from './event-matcher';
import { scanForArbs, startCleanupTimer, stopCleanupTimer } from './arb-engine';
import { scanConditionalArbs, upsertConditionalOpportunities } from './conditional-engine';

/**
 * Refresh markets from both venues and upsert into the database.
 */
export async function refreshMarkets(): Promise<{ polymarket: number; kalshi: number }> {
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO canonical_markets (id, venue, venue_market_id, question, url, status, yes_token_id, no_token_id, resolves_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(venue, venue_market_id) DO UPDATE SET
      question = excluded.question,
      url = excluded.url,
      status = excluded.status,
      yes_token_id = excluded.yes_token_id,
      no_token_id = excluded.no_token_id,
      resolves_at = excluded.resolves_at,
      updated_at = datetime('now')
  `);

  const pmMarkets = await fetchPolymarketMarkets();
  for (const m of pmMarkets) {
    upsert.run(
      uuid(), 'POLYMARKET', m.venueMarketId, m.question,
      m.url, m.status, m.yesTokenId || null, m.noTokenId || null,
      m.resolvesAt || null,
    );
  }

  const kalshiMarkets = await fetchKalshiMarkets();
  for (const m of kalshiMarkets) {
    upsert.run(
      uuid(), 'KALSHI', m.venueMarketId, m.question,
      m.url, m.status, m.yesTokenId || null, m.noTokenId || null,
      m.resolvesAt || null,
    );
  }

  console.log(`[ingestion] Refreshed markets: PM=${pmMarkets.length}, Kalshi=${kalshiMarkets.length}`);
  return { polymarket: pmMarkets.length, kalshi: kalshiMarkets.length };
}

/**
 * Refresh crypto markets from both venues, writing normalized crypto fields.
 */
export async function refreshCryptoMarkets(): Promise<{ polymarket: number; kalshi: number }> {
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO canonical_markets (id, venue, venue_market_id, question, url, status, yes_token_id, no_token_id, resolves_at, updated_at,
      asset, expiry_ts, predicate_direction, predicate_threshold, predicate_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
    ON CONFLICT(venue, venue_market_id) DO UPDATE SET
      question = excluded.question,
      url = excluded.url,
      status = excluded.status,
      yes_token_id = excluded.yes_token_id,
      no_token_id = excluded.no_token_id,
      resolves_at = excluded.resolves_at,
      updated_at = datetime('now'),
      asset = excluded.asset,
      expiry_ts = excluded.expiry_ts,
      predicate_direction = excluded.predicate_direction,
      predicate_threshold = excluded.predicate_threshold,
      predicate_type = excluded.predicate_type
  `);

  const pmMarkets = await fetchPolymarketCryptoMarkets();
  for (const m of pmMarkets) {
    const cf = m.cryptoFields;
    upsert.run(
      uuid(), 'POLYMARKET', m.venueMarketId, m.question,
      m.url, m.status, m.yesTokenId || null, m.noTokenId || null,
      m.resolvesAt || null,
      cf?.asset ?? null, cf?.expiryTs ?? null,
      cf?.predicateDirection ?? null, cf?.predicateThreshold ?? null,
      cf?.predicateType ?? null,
    );
  }

  const kalshiMarkets = await fetchKalshiCryptoMarkets();
  for (const m of kalshiMarkets) {
    const cf = m.cryptoFields;
    upsert.run(
      uuid(), 'KALSHI', m.venueMarketId, m.question,
      m.url, m.status, m.yesTokenId || null, m.noTokenId || null,
      m.resolvesAt || null,
      cf?.asset ?? null, cf?.expiryTs ?? null,
      cf?.predicateDirection ?? null, cf?.predicateThreshold ?? null,
      cf?.predicateType ?? null,
    );
  }

  console.log(`[ingestion] Crypto markets refreshed: PM=${pmMarkets.length}, Kalshi=${kalshiMarkets.length}`);
  return { polymarket: pmMarkets.length, kalshi: kalshiMarkets.length };
}

/**
 * Upsert categorized markets into the database with proper category tagging.
 */
function upsertCategorizedMarkets(markets: NormalizedMarket[], venue: string, category: string): number {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO canonical_markets (id, venue, venue_market_id, question, url, status, yes_token_id, no_token_id, resolves_at, updated_at,
      asset, expiry_ts, predicate_direction, predicate_threshold, predicate_type, category, event_group)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(venue, venue_market_id) DO UPDATE SET
      question = excluded.question,
      url = excluded.url,
      status = excluded.status,
      yes_token_id = excluded.yes_token_id,
      no_token_id = excluded.no_token_id,
      resolves_at = excluded.resolves_at,
      updated_at = datetime('now'),
      asset = excluded.asset,
      expiry_ts = excluded.expiry_ts,
      predicate_direction = excluded.predicate_direction,
      predicate_threshold = excluded.predicate_threshold,
      predicate_type = excluded.predicate_type,
      category = excluded.category,
      event_group = excluded.event_group
  `);

  for (const m of markets) {
    const cf = m.cryptoFields;
    upsert.run(
      uuid(), venue, m.venueMarketId, m.question,
      m.url, m.status, m.yesTokenId || null, m.noTokenId || null,
      m.resolvesAt || null,
      cf?.asset ?? null, cf?.expiryTs ?? null,
      cf?.predicateDirection ?? null, cf?.predicateThreshold ?? null,
      cf?.predicateType ?? null,
      category,
      m.eventGroup ?? null,
    );
  }
  return markets.length;
}

/**
 * Refresh FED markets from Kalshi (KXFED series).
 * PM FED markets are captured during the combined categorized scan.
 */
export async function refreshFedMarkets(): Promise<{ kalshi: number }> {
  const kalshiFed = await fetchKalshiFedMarkets();
  upsertCategorizedMarkets(kalshiFed, 'KALSHI', 'FED');
  console.log(`[ingestion] FED markets refreshed: Kalshi=${kalshiFed.length}`);
  return { kalshi: kalshiFed.length };
}

/**
 * Refresh MACRO markets from Kalshi (KXCPI + KXGDP series).
 * PM MACRO markets are captured during the combined categorized scan.
 */
export async function refreshMacroMarkets(): Promise<{ kalshi: number }> {
  const kalshiMacro = await fetchKalshiMacroMarkets();
  upsertCategorizedMarkets(kalshiMacro, 'KALSHI', 'MACRO');
  console.log(`[ingestion] MACRO markets refreshed: Kalshi=${kalshiMacro.length}`);
  return { kalshi: kalshiMacro.length };
}

/**
 * Refresh all category markets using a single Polymarket pagination pass.
 * Kalshi categories use targeted series queries (fast).
 * Also runs generic refreshMarkets() for non-categorized markets.
 */
export async function refreshAllCategories(): Promise<void> {
  const start = Date.now();

  try {
    // Single PM scan for ALL categorized markets (crypto + FED + MACRO)
    const pmCategorized = await fetchPolymarketCategorizedMarkets();
    upsertCategorizedMarkets(pmCategorized.crypto, 'POLYMARKET', 'CRYPTO');
    upsertCategorizedMarkets(pmCategorized.fed, 'POLYMARKET', 'FED');
    upsertCategorizedMarkets(pmCategorized.macro, 'POLYMARKET', 'MACRO');

    // Kalshi crypto (series-targeted, fast)
    const kalshiCrypto = await fetchKalshiCryptoMarkets();
    upsertCategorizedMarkets(kalshiCrypto, 'KALSHI', 'CRYPTO');

    // Kalshi FED (series-targeted, fast)
    const kalshiFed = await fetchKalshiFedMarkets();
    upsertCategorizedMarkets(kalshiFed, 'KALSHI', 'FED');

    // Kalshi MACRO (series-targeted, fast)
    const kalshiMacro = await fetchKalshiMacroMarkets();
    upsertCategorizedMarkets(kalshiMacro, 'KALSHI', 'MACRO');

    // PM events (captured during categorized scan — everything that didn't match crypto/FED/MACRO)
    upsertCategorizedMarkets(pmCategorized.events, 'POLYMARKET', 'EVENT');

    // Kalshi events (everything not in structured series)
    const kalshiEvents = await fetchKalshiEventMarkets();
    upsertCategorizedMarkets(kalshiEvents, 'KALSHI', 'EVENT');

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[ingestion] All categories refreshed in ${elapsed}s (PM: ${pmCategorized.crypto.length} crypto, ${pmCategorized.fed.length} FED, ${pmCategorized.macro.length} MACRO, ${pmCategorized.events.length} events | K: ${kalshiCrypto.length} crypto, ${kalshiFed.length} FED, ${kalshiMacro.length} MACRO, ${kalshiEvents.length} events)`);
  } catch (err) {
    console.error('[ingestion] Categorized market refresh failed:', err);
  }
}

/**
 * Refresh orderbooks for all enabled mappings.
 * Fetches BOTH YES and NO orderbooks per venue to get full binary pricing.
 */
export async function refreshOrderbooks(): Promise<number> {
  const db = getDb();

  const mappings = db.prepare(`
    SELECT m.id as mapping_id, m.polymarket_market_id, m.kalshi_market_id,
           pm.yes_token_id as pm_yes_token, pm.no_token_id as pm_no_token,
           pm.id as pm_id,
           k.yes_token_id as k_yes_token, k.no_token_id as k_no_token,
           k.id as k_id
    FROM match_mappings m
    JOIN canonical_markets pm ON pm.venue = 'POLYMARKET' AND pm.venue_market_id = m.polymarket_market_id
    JOIN canonical_markets k ON k.venue = 'KALSHI' AND k.venue_market_id = m.kalshi_market_id
    WHERE m.enabled = 1
  `).all() as any[];

  const insertSnapshot = db.prepare(`
    INSERT INTO orderbook_snapshots (id, market_id, ts, best_yes_bid, best_yes_ask, best_no_bid, best_no_ask, depth_json, raw_json)
    VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?)
  `);

  let count = 0;

  for (const mapping of mappings) {
    try {
      // Validate Polymarket token IDs
      if (!mapping.pm_yes_token || !mapping.pm_no_token) {
        console.warn(
          `[ingestion] Skipping PM orderbook for mapping ${mapping.mapping_id}: ` +
          `missing token IDs (yes=${mapping.pm_yes_token}, no=${mapping.pm_no_token})`
        );
        continue;
      }

      // Validate Kalshi outcome IDs
      if (!mapping.k_yes_token || !mapping.k_no_token) {
        console.warn(
          `[ingestion] Skipping Kalshi orderbook for mapping ${mapping.mapping_id}: ` +
          `missing outcome IDs (yes=${mapping.k_yes_token}, no=${mapping.k_no_token})`
        );
        continue;
      }

      // Fetch Polymarket binary orderbook (YES + NO)
      const pmOb = await fetchPolymarketBinaryOrderbook(
        mapping.pm_yes_token,
        mapping.pm_no_token,
      );
      insertSnapshot.run(
        uuid(), mapping.pm_id,
        pmOb.bestYesBid, pmOb.bestYesAsk, pmOb.bestNoBid, pmOb.bestNoAsk,
        JSON.stringify(pmOb.depth), JSON.stringify(pmOb.raw),
      );

      // Fetch Kalshi binary orderbook (YES + NO)
      const kalshiOb = await fetchKalshiBinaryOrderbook(
        mapping.k_yes_token,
        mapping.k_no_token,
      );
      insertSnapshot.run(
        uuid(), mapping.k_id,
        kalshiOb.bestYesBid, kalshiOb.bestYesAsk, kalshiOb.bestNoBid, kalshiOb.bestNoAsk,
        JSON.stringify(kalshiOb.depth), JSON.stringify(kalshiOb.raw),
      );

      count += 2;
    } catch (err) {
      console.error(`[ingestion] Orderbook refresh failed for mapping ${mapping.mapping_id}:`, err);
    }
  }

  if (mappings.length > 0) {
    console.log(`[ingestion] Refreshed ${count} orderbook snapshots for ${mappings.length} mappings`);
  }
  return count;
}

// ── Polling loops ──

let marketTimer: NodeJS.Timeout | null = null;
let orderbookTimer: NodeJS.Timeout | null = null;
let matchTimer: NodeJS.Timeout | null = null;
let isMatchRunning = false;
let isOrderbookRunning = false;

/**
 * Run the auto-match pipeline: generate suggestions + auto-approve high-confidence matches.
 * Guarded against concurrent runs.
 */
async function runAutoMatchPipeline(): Promise<void> {
  if (isMatchRunning) {
    console.log('[auto-match] Skipping — previous run still in progress');
    return;
  }
  isMatchRunning = true;
  try {
    const start = Date.now();
    const suggestions = generateSuggestions(40);
    const eventSuggs = generateEventSuggestions(35);
    const approved = autoApproveHighConfidence();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[auto-match] Pipeline done in ${elapsed}s: ${suggestions.arb_eligible} crypto arb-eligible, ${eventSuggs.arb_eligible} event arb-eligible, ${approved} auto-approved`);
  } catch (err) {
    console.error('[auto-match] Pipeline error:', err);
  } finally {
    isMatchRunning = false;
  }
}

export function startIngestion(): void {
  const marketInterval = parseInt(process.env.MARKET_REFRESH_INTERVAL_MS || '600000', 10);
  const orderbookInterval = parseInt(process.env.ORDERBOOK_REFRESH_INTERVAL_MS || '15000', 10);
  const matchInterval = parseInt(process.env.MATCH_INTERVAL_MS || '900000', 10);

  console.log(`[ingestion] Starting market refresh every ${marketInterval}ms`);
  console.log(`[ingestion] Starting orderbook refresh + arb scan every ${orderbookInterval}ms`);
  console.log(`[auto-match] Starting auto-match pipeline every ${matchInterval}ms`);

  // Start hourly cleanup of old opportunities
  startCleanupTimer();

  // Initial fetch: all categories + orderbooks + arb scan
  refreshAllCategories().catch(console.error);
  refreshOrderbooks().then(() => {
    scanForArbs();
    const conditionals = scanConditionalArbs();
    upsertConditionalOpportunities(conditionals);
  }).catch(console.error);

  // After initial ingestion completes, run auto-match pipeline (delayed 30s to let ingestion finish)
  setTimeout(() => {
    runAutoMatchPipeline().catch(console.error);
  }, 30000);

  marketTimer = setInterval(() => {
    refreshAllCategories().catch(console.error);
  }, marketInterval);

  orderbookTimer = setInterval(async () => {
    if (isOrderbookRunning) return;
    isOrderbookRunning = true;
    try {
      await refreshOrderbooks();
      scanForArbs();
      // Also scan for conditional arbs (complement/mutex within same venue)
      const conditionals = scanConditionalArbs();
      upsertConditionalOpportunities(conditionals);
    } catch (err) {
      console.error('[ingestion] Orderbook refresh + arb scan error:', err);
    } finally {
      isOrderbookRunning = false;
    }
  }, orderbookInterval);

  matchTimer = setInterval(() => {
    runAutoMatchPipeline().catch(console.error);
  }, matchInterval);
}

export function stopIngestion(): void {
  if (marketTimer) clearInterval(marketTimer);
  if (orderbookTimer) clearInterval(orderbookTimer);
  if (matchTimer) clearInterval(matchTimer);
  marketTimer = null;
  orderbookTimer = null;
  matchTimer = null;
  stopCleanupTimer();
}
