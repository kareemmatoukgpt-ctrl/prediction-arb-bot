/**
 * Exchange service — direct REST API clients for Polymarket and Kalshi.
 *
 * Bypasses pmxtjs/pmxt-core sidecar entirely. The sidecar crashes on Node 18+
 * because @polymarket/clob-client is ESM-only and pmxt-core tries to require() it.
 *
 * Uses public, unauthenticated read-only endpoints:
 *   Polymarket markets:    https://gamma-api.polymarket.com/markets
 *   Polymarket orderbook:  https://clob.polymarket.com/book?token_id=...
 *   Kalshi markets+prices: https://api.elections.kalshi.com/trade-api/v2/markets
 *   (Kalshi embeds yes_ask_dollars/no_ask_dollars in the market object — no separate OB call)
 *
 * EXCHANGE_MODE=live|mock (default: live)
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const https = require('https');
const http = require('http');

const PM_GAMMA_URL = (process.env.PM_GAMMA_URL || 'https://gamma-api.polymarket.com').replace(/\/$/, '');
const PM_CLOB_URL = (process.env.PM_CLOB_URL || 'https://clob.polymarket.com').replace(/\/$/, '');
const KALSHI_API_URL = (process.env.KALSHI_API_URL || 'https://api.elections.kalshi.com/trade-api/v2').replace(/\/$/, '');

export function getExchangeMode(): 'live' | 'mock' {
  const mode = (process.env.EXCHANGE_MODE || 'live').toLowerCase();
  if (mode !== 'live' && mode !== 'mock') {
    throw new Error(`Invalid EXCHANGE_MODE: '${mode}'. Must be 'live' or 'mock'.`);
  }
  return mode as 'live' | 'mock';
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function fetchJson(url: string, timeoutMs = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(
      url,
      { headers: { Accept: 'application/json', 'User-Agent': 'prediction-arb-bot/1.2' } },
      (res: any) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return fetchJson(res.headers.location, timeoutMs).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        let data = '';
        res.on('data', (chunk: any) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${url}`)));
    req.on('error', reject);
  });
}

// ── Public interfaces ────────────────────────────────────────────────────────

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

// ── Connectivity check ───────────────────────────────────────────────────────

/**
 * Test live exchange connectivity. Called at startup — throws if both fail.
 */
export async function testExchangeConnectivity(): Promise<void> {
  if (getExchangeMode() === 'mock') {
    console.log('[exchange] EXCHANGE_MODE=mock — skipping connectivity check');
    return;
  }

  let pmOk = false;
  let kalshiOk = false;

  try {
    await fetchJson(`${PM_GAMMA_URL}/markets?limit=1&active=true&closed=false`);
    pmOk = true;
    console.log('[exchange] Polymarket API reachable');
  } catch (err) {
    console.error('[exchange] Polymarket API unreachable:', err);
  }

  try {
    await fetchJson(`${KALSHI_API_URL}/markets?limit=1&status=open`);
    kalshiOk = true;
    console.log('[exchange] Kalshi API reachable');
  } catch (err) {
    console.error('[exchange] Kalshi API unreachable:', err);
  }

  if (!pmOk && !kalshiOk) {
    throw new Error(
      '[exchange] EXCHANGE_MODE=live but both Polymarket and Kalshi APIs are unreachable. ' +
      'Check your network or set EXCHANGE_MODE=mock for development.',
    );
  }
}

// ── Polymarket ───────────────────────────────────────────────────────────────

/**
 * Fetch active Polymarket markets from Gamma API.
 * Returns clobTokenIds[0] as yesTokenId, clobTokenIds[1] as noTokenId.
 */
export async function fetchPolymarketMarkets(
  query?: string,
  limit = 25,
): Promise<NormalizedMarket[]> {
  if (getExchangeMode() === 'mock') return getMockMarkets('POLYMARKET');

  try {
    const params = new URLSearchParams({
      active: 'true',
      closed: 'false',
      enableOrderBook: 'true',  // only CLOB markets have YES/NO tokenIds we can trade
      order: 'liquidityClob',
      ascending: 'false',
      limit: String(limit),
    });
    if (query) params.set('q', query);

    const data = await fetchJson(`${PM_GAMMA_URL}/markets?${params}`);
    const markets: any[] = Array.isArray(data) ? data : data.markets || [];

    return markets
      .map((m: any) => {
        // clobTokenIds arrives as a JSON-encoded string from the Gamma API
        let tokenIds: string[] = [];
        try {
          tokenIds = typeof m.clobTokenIds === 'string'
            ? JSON.parse(m.clobTokenIds)
            : (m.clobTokenIds || []);
        } catch { /* skip malformed */ }
        return { m, tokenIds };
      })
      .filter(({ tokenIds }: any) => tokenIds.length >= 2)
      .map(({ m, tokenIds }: any) => ({
        venueMarketId: m.conditionId || m.id || m.marketId,
        question: m.question || m.title || '',
        url: `https://polymarket.com/event/${m.slug || m.conditionId}`,
        status: m.active ? 'open' : 'closed',
        yesTokenId: tokenIds[0],
        noTokenId: tokenIds[1],
        resolvesAt: m.endDateIso || m.endDate || undefined,
      }));
  } catch (err) {
    console.error('[exchange] Polymarket fetchMarkets error:', err);
    return [];
  }
}

/**
 * Fetch Polymarket orderbook for a single token (YES or NO side).
 * @deprecated Use fetchPolymarketBinaryOrderbook for arb detection.
 */
export async function fetchPolymarketOrderbook(tokenId: string): Promise<NormalizedOrderbook> {
  if (getExchangeMode() === 'mock') return getMockOrderbook();
  return fetchPolymarketBinaryOrderbook(tokenId, tokenId);
}

/**
 * Fetch both YES and NO orderbooks from Polymarket CLOB in parallel.
 * bestYesAsk = best ask on the YES token's book (cost to buy YES)
 * bestNoAsk  = best ask on the NO token's book  (cost to buy NO)
 */
export async function fetchPolymarketBinaryOrderbook(
  yesTokenId: string,
  noTokenId: string,
): Promise<NormalizedOrderbook> {
  if (getExchangeMode() === 'mock') return getMockOrderbook();

  const [yesOb, noOb] = await Promise.all([
    fetchJson(`${PM_CLOB_URL}/book?token_id=${encodeURIComponent(yesTokenId)}`),
    fetchJson(`${PM_CLOB_URL}/book?token_id=${encodeURIComponent(noTokenId)}`),
  ]);

  const yesBids: any[] = yesOb.bids || [];
  const yesAsks: any[] = yesOb.asks || [];
  const noBids: any[]  = noOb.bids  || [];
  const noAsks: any[]  = noOb.asks  || [];

  const bestYesBid = yesBids.length > 0 ? Math.max(...yesBids.map((b: any) => Number(b.price))) : null;
  const bestYesAsk = yesAsks.length > 0 ? Math.min(...yesAsks.map((a: any) => Number(a.price))) : null;
  const bestNoBid  = noBids.length  > 0 ? Math.max(...noBids.map((b: any) => Number(b.price)))  : null;
  const bestNoAsk  = noAsks.length  > 0 ? Math.min(...noAsks.map((a: any) => Number(a.price)))  : null;

  return {
    bestYesBid,
    bestYesAsk,
    bestNoBid,
    bestNoAsk,
    depth: [...yesAsks, ...noBids].map((l: any) => ({ price: Number(l.price), size: Number(l.size) })),
    raw: { yes: yesOb, no: noOb },
  };
}

// ── Kalshi ───────────────────────────────────────────────────────────────────

/**
 * Fetch open Kalshi markets. Kalshi embeds yes/no prices in the market object,
 * so yesTokenId = noTokenId = ticker (used as the "outcome ID" for both sides).
 */
export async function fetchKalshiMarkets(
  query?: string,
  limit = 25,
): Promise<NormalizedMarket[]> {
  if (getExchangeMode() === 'mock') return getMockMarkets('KALSHI');

  try {
    const params = new URLSearchParams({ status: 'open', limit: String(limit) });
    if (query) params.set('series_ticker', query);

    const data = await fetchJson(`${KALSHI_API_URL}/markets?${params}`);
    const markets: any[] = data.markets || [];

    return markets.map((m: any) => ({
      venueMarketId: m.ticker,
      question: m.title || m.question || '',
      url: `https://kalshi.com/markets/${m.ticker}`,
      // Kalshi uses 'active'/'finalized'; normalize to the DB's allowed values
      status: (m.status === 'finalized' || m.status === 'closed') ? 'closed' : 'open',
      yesTokenId: m.ticker,  // Kalshi uses ticker for both YES and NO sides
      noTokenId: m.ticker,
      resolvesAt: m.close_time || m.expiration_time || undefined,
    }));
  } catch (err) {
    console.error('[exchange] Kalshi fetchMarkets error:', err);
    return [];
  }
}

/**
 * Fetch Kalshi binary orderbook.
 * Kalshi embeds yes_ask_dollars/no_ask_dollars directly in the market response — no
 * separate orderbook endpoint needed.
 * @deprecated Use fetchKalshiBinaryOrderbook.
 */
export async function fetchKalshiOrderbook(marketId: string): Promise<NormalizedOrderbook> {
  if (getExchangeMode() === 'mock') return getMockOrderbook();
  return fetchKalshiBinaryOrderbook(marketId, marketId);
}

/**
 * Fetch Kalshi binary orderbook. Both yesOutcomeId and noOutcomeId should be the
 * market ticker (they are the same for Kalshi). Prices are read from the market
 * object's yes_ask_dollars / no_ask_dollars fields.
 */
export async function fetchKalshiBinaryOrderbook(
  yesOutcomeId: string,
  noOutcomeId: string,
): Promise<NormalizedOrderbook> {
  if (getExchangeMode() === 'mock') return getMockOrderbook();

  // Both sides come from the same market — use yesOutcomeId (= ticker)
  const ticker = yesOutcomeId;
  const data = await fetchJson(`${KALSHI_API_URL}/markets/${encodeURIComponent(ticker)}`);
  const m = data.market || data;

  const bestYesAsk = m.yes_ask  != null ? Number(m.yes_ask)  : m.yes_ask_dollars  != null ? Number(m.yes_ask_dollars)  : null;
  const bestYesBid = m.yes_bid  != null ? Number(m.yes_bid)  : m.yes_bid_dollars  != null ? Number(m.yes_bid_dollars)  : null;
  const bestNoAsk  = m.no_ask   != null ? Number(m.no_ask)   : m.no_ask_dollars   != null ? Number(m.no_ask_dollars)   : null;
  const bestNoBid  = m.no_bid   != null ? Number(m.no_bid)   : m.no_bid_dollars   != null ? Number(m.no_bid_dollars)   : null;

  return {
    bestYesBid,
    bestYesAsk,
    bestNoBid,
    bestNoAsk,
    depth: [],  // Kalshi doesn't expose depth levels in this endpoint
    raw: m,
  };
}

// ── Mock data ────────────────────────────────────────────────────────────────

function getMockMarkets(venue: string): NormalizedMarket[] {
  return [
    {
      venueMarketId: venue === 'POLYMARKET' ? 'pm-mock-btc-100k' : 'kalshi-mock-btc-100k',
      question: 'Will Bitcoin reach $100k by end of 2026?',
      url: `https://${venue.toLowerCase()}.com/mock`,
      status: 'open',
      yesTokenId: venue === 'POLYMARKET' ? 'pm-mock-yes-btc' : 'kalshi-mock-btc-100k',
      noTokenId:  venue === 'POLYMARKET' ? 'pm-mock-no-btc'  : 'kalshi-mock-btc-100k',
    },
    {
      venueMarketId: venue === 'POLYMARKET' ? 'pm-mock-fed-rate' : 'kalshi-mock-fed-rate',
      question: 'Will the Fed cut rates in June 2026?',
      url: `https://${venue.toLowerCase()}.com/mock`,
      status: 'open',
      yesTokenId: venue === 'POLYMARKET' ? 'pm-mock-yes-fed' : 'kalshi-mock-fed-rate',
      noTokenId:  venue === 'POLYMARKET' ? 'pm-mock-no-fed'  : 'kalshi-mock-fed-rate',
    },
  ];
}

function getMockOrderbook(): NormalizedOrderbook {
  const yesPrice = 0.4 + Math.random() * 0.2; // 0.40–0.60
  return {
    bestYesBid: +(yesPrice - 0.02).toFixed(4),
    bestYesAsk: +yesPrice.toFixed(4),
    bestNoBid:  +(1 - yesPrice - 0.02).toFixed(4),
    bestNoAsk:  +(1 - yesPrice + 0.01).toFixed(4),
    depth: [
      { price: yesPrice,        size: 500  },
      { price: yesPrice - 0.01, size: 1000 },
      { price: yesPrice - 0.02, size: 2000 },
    ],
    raw: { mock: true },
  };
}
