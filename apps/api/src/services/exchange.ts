/**
 * Exchange service — wraps pmxtjs to provide unified market data access.
 * Controlled by EXCHANGE_MODE env var:
 *   - 'live' (default): uses pmxt sidecar for real data; fails fast if unavailable
 *   - 'mock': returns mock data without contacting exchanges
 */

import { Polymarket, Kalshi } from 'pmxtjs';

type ExchangeMode = 'live' | 'mock';

function getExchangeMode(): ExchangeMode {
  const mode = (process.env.EXCHANGE_MODE || 'live').toLowerCase();
  if (mode !== 'live' && mode !== 'mock') {
    throw new Error(`Invalid EXCHANGE_MODE: '${mode}'. Must be 'live' or 'mock'.`);
  }
  return mode as ExchangeMode;
}

let polymarket: InstanceType<typeof Polymarket> | null = null;
let kalshi: InstanceType<typeof Kalshi> | null = null;
let initAttempted = false;
let initSuccess = false;

async function ensureInit(): Promise<boolean> {
  if (initAttempted) return initSuccess;
  initAttempted = true;

  const mode = getExchangeMode();
  if (mode === 'mock') {
    console.log('[exchange] EXCHANGE_MODE=mock — using mock data');
    return false;
  }

  try {
    polymarket = new Polymarket();
    kalshi = new Kalshi();

    // Test connectivity with a simple call (10s timeout)
    await Promise.race([
      polymarket.fetchMarkets({ limit: 1 }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('pmxt sidecar timeout (10s)')), 10000),
      ),
    ]);

    console.log('[exchange] pmxt connected successfully (live mode)');
    initSuccess = true;
    return true;
  } catch (err) {
    // FAIL FAST in live mode — do not silently fall back to mock
    const msg = `[exchange] EXCHANGE_MODE=live but pmxt sidecar is unreachable. ` +
      `Set EXCHANGE_MODE=mock for development, or ensure pmxt-core is installed. Error: ${err}`;
    console.error(msg);
    polymarket = null;
    kalshi = null;
    throw new Error(msg);
  }
}

/**
 * Test exchange connectivity. Call at startup to fail fast.
 */
export async function testExchangeConnectivity(): Promise<void> {
  await ensureInit();
}

// ── Interfaces ──

export interface NormalizedMarket {
  venueMarketId: string;
  question: string;
  url: string;
  status: string;
  yesTokenId?: string;
  noTokenId?: string;
  resolvesAt?: string;
}

export interface NormalizedOrderbook {
  bestYesBid: number | null;
  bestYesAsk: number | null;
  bestNoBid: number | null;
  bestNoAsk: number | null;
  depth: { price: number; size: number }[];
  raw: any;
}

// ── Polymarket ──

export async function fetchPolymarketMarkets(
  query?: string,
  limit = 25,
): Promise<NormalizedMarket[]> {
  const live = await ensureInit();
  if (!live) return getMockMarkets('POLYMARKET');

  try {
    const markets = await polymarket!.fetchMarkets({
      query,
      limit,
      status: 'open',
    });
    return markets.map((m: any) => ({
      venueMarketId: m.marketId || m.id,
      question: m.title || m.question || '',
      url: m.url || '',
      status: m.status || 'open',
      yesTokenId: m.yes?.outcomeId || m.outcomes?.[0]?.outcomeId,
      noTokenId: m.no?.outcomeId || m.outcomes?.[1]?.outcomeId,
      resolvesAt: m.resolutionDate?.toISOString?.() || m.endDate || m.resolvesAt,
    }));
  } catch (err) {
    console.error('[exchange] Polymarket fetchMarkets error:', err);
    return [];
  }
}

export async function fetchPolymarketOrderbook(
  tokenId: string,
): Promise<NormalizedOrderbook> {
  const live = await ensureInit();
  if (!live) return getMockOrderbook();

  try {
    const ob = await polymarket!.fetchOrderBook(tokenId);
    const bids = ob.bids || [];
    const asks = ob.asks || [];
    return {
      bestYesBid: bids.length > 0 ? Math.max(...bids.map((b: any) => b.price)) : null,
      bestYesAsk: asks.length > 0 ? Math.min(...asks.map((a: any) => a.price)) : null,
      bestNoBid: null,
      bestNoAsk: null,
      depth: [...bids, ...asks].map((l: any) => ({
        price: l.price,
        size: l.size,
      })),
      raw: ob,
    };
  } catch (err) {
    console.error('[exchange] Polymarket orderbook error:', err);
    if (getExchangeMode() === 'live') throw err;
    return getMockOrderbook();
  }
}

// ── Kalshi ──

export async function fetchKalshiMarkets(
  query?: string,
  limit = 25,
): Promise<NormalizedMarket[]> {
  const live = await ensureInit();
  if (!live) return getMockMarkets('KALSHI');

  try {
    const markets = await kalshi!.fetchMarkets({ query, limit, status: 'open' });
    return markets.map((m: any) => ({
      venueMarketId: m.marketId || m.ticker || m.id,
      question: m.title || m.question || '',
      url: m.url || '',
      status: m.status || 'open',
      yesTokenId: m.yes?.outcomeId || m.outcomes?.[0]?.outcomeId,
      noTokenId: m.no?.outcomeId || m.outcomes?.[1]?.outcomeId,
      resolvesAt: m.resolutionDate?.toISOString?.() || m.endDate || m.resolvesAt,
    }));
  } catch (err) {
    console.error('[exchange] Kalshi fetchMarkets error:', err);
    return [];
  }
}

export async function fetchKalshiOrderbook(
  marketId: string,
): Promise<NormalizedOrderbook> {
  const live = await ensureInit();
  if (!live) return getMockOrderbook();

  try {
    const ob = await kalshi!.fetchOrderBook(marketId);
    const bids = ob.bids || [];
    const asks = ob.asks || [];
    return {
      bestYesBid: bids.length > 0 ? Math.max(...bids.map((b: any) => b.price)) : null,
      bestYesAsk: asks.length > 0 ? Math.min(...asks.map((a: any) => a.price)) : null,
      bestNoBid: null,
      bestNoAsk: null,
      depth: [...bids, ...asks].map((l: any) => ({
        price: l.price,
        size: l.size,
      })),
      raw: ob,
    };
  } catch (err) {
    console.error('[exchange] Kalshi orderbook error:', err);
    if (getExchangeMode() === 'live') throw err;
    return getMockOrderbook();
  }
}

// ── Mock data for development ──

function getMockMarkets(venue: string): NormalizedMarket[] {
  return [
    {
      venueMarketId: venue === 'POLYMARKET' ? 'pm-mock-btc-100k' : 'kalshi-mock-btc-100k',
      question: 'Will Bitcoin reach $100k by end of 2026?',
      url: `https://${venue.toLowerCase()}.com/mock`,
      status: 'open',
    },
    {
      venueMarketId: venue === 'POLYMARKET' ? 'pm-mock-fed-rate' : 'kalshi-mock-fed-rate',
      question: 'Will the Fed cut rates in June 2026?',
      url: `https://${venue.toLowerCase()}.com/mock`,
      status: 'open',
    },
  ];
}

function getMockOrderbook(): NormalizedOrderbook {
  const yesPrice = 0.4 + Math.random() * 0.2; // 0.40-0.60
  return {
    bestYesBid: yesPrice - 0.02,
    bestYesAsk: yesPrice,
    bestNoBid: 1 - yesPrice - 0.02,
    bestNoAsk: 1 - yesPrice + 0.01,
    depth: [
      { price: yesPrice, size: 500 },
      { price: yesPrice - 0.01, size: 1000 },
      { price: yesPrice - 0.02, size: 2000 },
    ],
    raw: { mock: true },
  };
}
