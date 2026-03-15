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
  cryptoFields?: CryptoFieldsLocal;
  eventGroup?: string;
}

export interface NormalizedOrderbook {
  bestYesBid: number | null;
  bestYesAsk: number | null;
  bestNoBid: number | null;
  bestNoAsk: number | null;
  depth: { price: number; size: number }[];
  raw: any;
}

export type CryptoAsset = 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'DOGE' | 'ENA' | 'FED_RATE' | 'CPI' | 'GDP';

export interface CryptoFieldsLocal {
  asset: CryptoAsset | string;
  expiryTs: number | null;
  predicateDirection: 'ABOVE' | 'BELOW' | null;
  predicateThreshold: number | null;
  predicateType: 'CLOSE_AT' | 'TOUCH_BY' | 'BINARY_EVENT';
}

// Series prefixes for structured markets (crypto, FED, MACRO) — everything else is an event
const STRUCTURED_SERIES_PREFIXES = ['KXBTC', 'KXBTCD', 'KXETH', 'KXETHD', 'KXSOL', 'KXSOLD', 'KXDOGE', 'KXENA', 'KXXRP', 'KXFED', 'KXCPI', 'KXGDP'];

// ── Crypto field parsing ─────────────────────────────────────────────────────

const ASSET_SERIES: Record<string, CryptoAsset> = {
  KXBTC: 'BTC', KXBTCD: 'BTC',
  KXETH: 'ETH', KXETHD: 'ETH',
  KXSOL: 'SOL', KXSOLD: 'SOL',
};

/** Parse Kalshi crypto fields — metadata-first, ticker-fallback. */
function parseKalshiCryptoFields(m: any): CryptoFieldsLocal | null {
  const seriesPrefix = (m.event_ticker || m.ticker || '').split('-')[0];
  const asset = ASSET_SERIES[seriesPrefix];
  if (!asset) return null;

  const predicateThreshold: number | null = m.floor_strike != null ? Number(m.floor_strike) : null;

  const expiryTs: number | null = m.close_time
    ? Math.floor(new Date(m.close_time).getTime() / 1000)
    : m.expiration_time
    ? Math.floor(new Date(m.expiration_time).getTime() / 1000)
    : null;

  let predicateDirection: 'ABOVE' | 'BELOW' | null = null;
  const subText = (m.subtitle || m.yes_sub_title || m.yes_subtitle || '').toLowerCase();
  if (/or above|and above|>= |greater than or equal|at least/.test(subText)) predicateDirection = 'ABOVE';
  else if (/or below|and below|<= |less than or equal|at most/.test(subText)) predicateDirection = 'BELOW';
  else if (subText.includes('above') || subText.includes('over')) predicateDirection = 'ABOVE';
  else if (subText.includes('below') || subText.includes('under')) predicateDirection = 'BELOW';
  if (!predicateDirection && m.floor_strike != null) predicateDirection = 'ABOVE';

  const allText = ((m.title || '') + ' ' + (m.subtitle || '') + ' ' + (m.rules || '')).toLowerCase();
  const predicateType: 'CLOSE_AT' | 'TOUCH_BY' = /touch|at any point|at any time|ever reach/.test(allText) ? 'TOUCH_BY' : 'CLOSE_AT';

  return { asset, expiryTs, predicateDirection, predicateThreshold, predicateType };
}

/** Parse Kalshi FED fields — KXFED series for federal funds rate markets. */
function parseKalshiFedFields(m: any): CryptoFieldsLocal | null {
  const seriesPrefix = (m.event_ticker || m.ticker || '').split('-')[0];
  if (seriesPrefix !== 'KXFED') return null;

  const predicateThreshold: number | null = m.floor_strike != null ? Number(m.floor_strike) : null;

  const expiryTs: number | null = m.close_time
    ? Math.floor(new Date(m.close_time).getTime() / 1000)
    : m.expiration_time
    ? Math.floor(new Date(m.expiration_time).getTime() / 1000)
    : null;

  // FED markets are always "above X%" — the question is whether rate exceeds threshold
  const predicateDirection: 'ABOVE' = 'ABOVE';
  // FED rate decisions are point-in-time (after the meeting) = CLOSE_AT
  const predicateType: 'CLOSE_AT' = 'CLOSE_AT';

  return { asset: 'FED_RATE', expiryTs, predicateDirection, predicateThreshold, predicateType };
}

// Asset regex patterns for Polymarket question parsing
const PM_ASSET_PATTERNS: [RegExp, CryptoAsset][] = [
  [/bitcoin|\bbtc\b(?!\s*cash)/i, 'BTC'],
  [/ethereum|\beth\b/i, 'ETH'],
  [/\bsolana\b|\bsol\b(?!ar|id|ution|ve)/i, 'SOL'],
  [/\bxrp\b|\bripple\b/i, 'XRP'],
  [/\bdoge(?:coin)?\b/i, 'DOGE'],
  [/\bena\b|\bethena\b/i, 'ENA'],
];

/** Parse Polymarket crypto fields from question text. Exported for testing. */
export function parsePolymarketCryptoFields(question: string, endDate?: string): CryptoFieldsLocal | null {
  let asset: CryptoAsset | null = null;
  for (const [regex, a] of PM_ASSET_PATTERNS) {
    if (regex.test(question)) { asset = a; break; }
  }
  if (!asset) return null;

  // Direction detection
  let predicateDirection: 'ABOVE' | 'BELOW' | null = null;
  if (/above|exceed|surpass|higher than|over|reach|break above|go above|end above|close above|stay above|remain above|hit\s+\$/i.test(question)) {
    predicateDirection = 'ABOVE';
  } else if (/below|under|drop|fall below|less than|go below|end below|close below|dip\s+to/i.test(question)) {
    predicateDirection = 'BELOW';
  }

  // Threshold parsing — handles $81,249.99, 81.25k, 1.2m, $150,000
  let predicateThreshold: number | null = null;
  const threshMatch = question.match(/\$\s*(\d[\d,]*\.?\d*)\s*(k|m|b)?\b/i);
  if (threshMatch) {
    const raw = parseFloat(threshMatch[1].replace(/,/g, ''));
    const suffix = (threshMatch[2] || '').toLowerCase();
    const multiplier = suffix === 'k' ? 1000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
    const val = raw * multiplier;
    if (val >= 0.01 && val <= 10_000_000) predicateThreshold = val;
  }

  // Predicate type: "hit/reach/dip by <date>" = TOUCH_BY (resolves if price ever touches target)
  // "close at/close above" or "end at/end above" = CLOSE_AT (resolves on final price at expiry)
  // PM crypto markets almost always use "hit/reach/dip" → TOUCH_BY (Binance 1m candle high)
  let predicateType: 'CLOSE_AT' | 'TOUCH_BY';
  if (/\b(close|end|settle)\s+(at|above|below|over|under)/i.test(question)) {
    predicateType = 'CLOSE_AT';
  } else if (/\b(hit|reach|dip|touch|exceed|surpass|at any point|at any time|ever|by\b)/i.test(question)) {
    predicateType = 'TOUCH_BY';
  } else {
    predicateType = 'TOUCH_BY'; // default for PM — most crypto markets are "will X reach Y by Z"
  }

  const expiryTs: number | null = endDate ? Math.floor(new Date(endDate).getTime() / 1000) : null;

  return { asset, expiryTs, predicateDirection, predicateThreshold, predicateType };
}

// ── FED field parsing (Polymarket) ──────────────────────────────────────────

const PM_FED_PATTERNS: RegExp[] = [
  /federal\s+funds?\s+rate/i,
  /fed\s+funds?\s+rate/i,
  /\bfomc\b/i,
  /\bfed\b.*\b(cut|hike|raise|lower|hold|pause|rate)\b/i,
  /\b(fed|federal\s+reserve)\b.*\binterest\s+rate/i,
  /\binterest\s+rate\b.*\b(fed|fomc|federal\s+reserve)\b/i,
];

/** Parse Polymarket FED fields from question text. Exported for testing. */
export function parsePolymarketFedFields(question: string, endDate?: string): CryptoFieldsLocal | null {
  let isFed = false;
  for (const pattern of PM_FED_PATTERNS) {
    if (pattern.test(question)) { isFed = true; break; }
  }
  if (!isFed) return null;

  // Direction: "above X%" = ABOVE, "cut/lower/reduce" = BELOW (rate goes down), "hike/raise" = ABOVE
  let predicateDirection: 'ABOVE' | 'BELOW' | null = null;
  if (/above|higher|at\s+least|exceed|hike|raise|increase/i.test(question)) {
    predicateDirection = 'ABOVE';
  } else if (/below|lower|at\s+most|cut|decrease|reduce/i.test(question)) {
    predicateDirection = 'BELOW';
  }

  // Threshold: "above 4.25%" or "425 basis points"
  let predicateThreshold: number | null = null;
  const pctMatch = question.match(/(\d+\.?\d*)\s*%/);
  if (pctMatch) {
    const val = parseFloat(pctMatch[1]);
    if (val >= 0 && val <= 20) predicateThreshold = val;
  }
  if (!predicateThreshold) {
    const bpsMatch = question.match(/(\d+)\s*(?:basis\s+points|bps)/i);
    if (bpsMatch) {
      predicateThreshold = parseInt(bpsMatch[1]) / 100;
    }
  }

  const expiryTs: number | null = endDate ? Math.floor(new Date(endDate).getTime() / 1000) : null;
  const predicateType: 'CLOSE_AT' = 'CLOSE_AT'; // FED decisions are point-in-time

  return { asset: 'FED_RATE', expiryTs, predicateDirection, predicateThreshold, predicateType };
}

// ── MACRO field parsing ─────────────────────────────────────────────────────

const MACRO_SERIES: Record<string, CryptoAsset> = {
  KXCPI: 'CPI',
  KXGDP: 'GDP',
};

/** Parse Kalshi MACRO fields — KXCPI (CPI monthly change) and KXGDP (GDP growth). */
function parseKalshiMacroFields(m: any): CryptoFieldsLocal | null {
  const seriesPrefix = (m.event_ticker || m.ticker || '').split('-')[0];
  const asset = MACRO_SERIES[seriesPrefix];
  if (!asset) return null;

  const predicateThreshold: number | null = m.floor_strike != null ? Number(m.floor_strike) : null;

  const expiryTs: number | null = m.close_time
    ? Math.floor(new Date(m.close_time).getTime() / 1000)
    : m.expiration_time
    ? Math.floor(new Date(m.expiration_time).getTime() / 1000)
    : null;

  // Macro markets are "more than X%" = ABOVE
  const predicateDirection: 'ABOVE' = 'ABOVE';
  // Data releases are point-in-time = CLOSE_AT
  const predicateType: 'CLOSE_AT' = 'CLOSE_AT';

  return { asset, expiryTs, predicateDirection, predicateThreshold, predicateType };
}

const PM_MACRO_CPI_PATTERNS: RegExp[] = [
  /\bcpi\b/i,
  /consumer\s+price\s+index/i,
  /\binflation\s+rate\b/i,
  /\binflation\b.*\bmonthly\b/i,
  /\bmonthly\b.*\binflation\b/i,
];

const PM_MACRO_GDP_PATTERNS: RegExp[] = [
  /\bgdp\b/i,
  /gross\s+domestic\s+product/i,
  /\beconomic\s+growth\b.*\bquarter/i,
  /\breal\s+gdp\b/i,
];

/** Parse Polymarket MACRO fields (CPI or GDP) from question text. Exported for testing. */
export function parsePolymarketMacroFields(question: string, endDate?: string): CryptoFieldsLocal | null {
  let asset: CryptoAsset | null = null;
  for (const pattern of PM_MACRO_CPI_PATTERNS) {
    if (pattern.test(question)) { asset = 'CPI'; break; }
  }
  if (!asset) {
    for (const pattern of PM_MACRO_GDP_PATTERNS) {
      if (pattern.test(question)) { asset = 'GDP'; break; }
    }
  }
  if (!asset) return null;

  // Direction: "more than / above / exceed" = ABOVE, "less than / below" = BELOW
  let predicateDirection: 'ABOVE' | 'BELOW' | null = null;
  if (/above|more\s+than|exceed|higher|increase|rise/i.test(question)) {
    predicateDirection = 'ABOVE';
  } else if (/below|less\s+than|under|lower|decrease|fall|decline/i.test(question)) {
    predicateDirection = 'BELOW';
  }

  // Threshold: "more than 0.3%" or "above 2.5%"
  let predicateThreshold: number | null = null;
  const pctMatch = question.match(/(\d+\.?\d*)\s*%/);
  if (pctMatch) {
    const val = parseFloat(pctMatch[1]);
    if (val >= -5 && val <= 20) predicateThreshold = val;
  }

  const expiryTs: number | null = endDate ? Math.floor(new Date(endDate).getTime() / 1000) : null;
  const predicateType: 'CLOSE_AT' = 'CLOSE_AT'; // data releases are point-in-time

  return { asset, expiryTs, predicateDirection, predicateThreshold, predicateType };
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
      .map(({ m, tokenIds }: any) => {
        const question = m.question || m.title || '';
        // Combine all text fields for asset/threshold detection (slug often has "bitcoin-above-85k")
        const parseContext = [question, m.slug || '', m.groupItemTitle || '', m.description || ''].join(' ');
        return {
          venueMarketId: m.conditionId || m.id || m.marketId,
          question,
          url: `https://polymarket.com/event/${m.events?.[0]?.slug || m.slug || m.conditionId}`,
          status: m.active ? 'open' : 'closed',
          yesTokenId: tokenIds[0],
          noTokenId: tokenIds[1],
          resolvesAt: m.endDateIso || m.endDate || undefined,
          cryptoFields: parsePolymarketCryptoFields(parseContext, m.endDateIso || m.endDate) || undefined,
        };
      });
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
      question: (m.title || m.question || '').replace(/\*\*/g, ''),
      url: `https://kalshi.com/markets/${m.ticker}`,
      // Kalshi uses 'active'/'finalized'; normalize to the DB's allowed values
      status: (m.status === 'finalized' || m.status === 'closed') ? 'closed' : 'open',
      yesTokenId: m.ticker,  // Kalshi uses ticker for both YES and NO sides
      noTokenId: m.ticker,
      resolvesAt: m.close_time || m.expiration_time || undefined,
      cryptoFields: parseKalshiCryptoFields(m) || undefined,
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

// ── Crypto-specific fetch helpers ────────────────────────────────────────────

/**
 * Fetch Polymarket crypto price markets by paginating ALL open markets
 * and filtering client-side.
 *
 * The Gamma API `q=` parameter does not actually filter results (see docs/DECISIONS.md D1).
 * So we must paginate through all open markets and apply asset/threshold regex client-side.
 */
export async function fetchPolymarketCryptoMarkets(): Promise<NormalizedMarket[]> {
  if (getExchangeMode() === 'mock') return getMockMarkets('POLYMARKET');

  const PAGE_SIZE = 100;
  const MAX_PAGES = 120; // up to 12,000 markets — API has ~10k open
  const seenIds = new Set<string>();
  const results: NormalizedMarket[] = [];
  let totalScanned = 0;

  console.log('[exchange] PM crypto scan: paginating all open markets...');

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        active: 'true',
        closed: 'false',
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });

      const data = await fetchJson(`${PM_GAMMA_URL}/markets?${params}`, 30000);
      const markets: any[] = Array.isArray(data) ? data : data.markets || [];

      if (markets.length === 0) break; // no more results
      totalScanned += markets.length;

      for (const m of markets) {
        let tokenIds: string[] = [];
        try {
          tokenIds = typeof m.clobTokenIds === 'string'
            ? JSON.parse(m.clobTokenIds)
            : (m.clobTokenIds || []);
        } catch { continue; }
        if (tokenIds.length < 2) continue;

        const conditionId = m.conditionId || m.id;
        if (seenIds.has(conditionId)) continue;

        const question = m.question || m.title || '';
        // Combine multiple text fields — slug often has "bitcoin-above-85k"
        const parseContext = [question, m.slug || '', m.groupItemTitle || '', (m.description || '').slice(0, 500)].join(' ');
        const cryptoFields = parsePolymarketCryptoFields(parseContext, m.endDateIso || m.endDate);

        if (!cryptoFields) continue; // not a crypto market

        seenIds.add(conditionId);
        results.push({
          venueMarketId: conditionId,
          question,
          url: `https://polymarket.com/event/${m.events?.[0]?.slug || m.slug || conditionId}`,
          status: m.active ? 'open' : 'closed',
          yesTokenId: tokenIds[0],
          noTokenId: tokenIds[1],
          resolvesAt: m.endDateIso || m.endDate || undefined,
          cryptoFields,
        });
      }

      // Stop if we got a partial page (last page)
      if (markets.length < PAGE_SIZE) break;

      // Small delay between pages to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.warn(`[exchange] PM crypto page ${page} failed:`, err);
      // Continue to next page on error
    }
  }

  console.log(`[exchange] PM crypto scan complete: ${results.length} crypto markets found in ${totalScanned} total scanned`);
  return results;
}

/**
 * Fetch Kalshi crypto markets for all known crypto series.
 * Includes both bracket (KXBTC) and threshold (KXBTCD) series.
 * KXBTCD/KXETHD/KXSOLD are threshold-style ("$X or above") — better for matching with PM.
 */
export async function fetchKalshiCryptoMarkets(limitPerSeries = 200): Promise<NormalizedMarket[]> {
  if (getExchangeMode() === 'mock') return getMockMarkets('KALSHI');

  // Threshold series (KXBTCD etc.) are structurally better for cross-venue matching
  const cryptoSeries = ['KXBTC', 'KXBTCD', 'KXETH', 'KXETHD', 'KXSOL', 'KXSOLD'];
  const results: NormalizedMarket[] = [];

  for (const s of cryptoSeries) {
    try {
      const markets = await fetchKalshiMarkets(s, limitPerSeries);
      results.push(...markets);
      if (markets.length > 0) {
        console.log(`[exchange] Kalshi ${s}: ${markets.length} markets`);
      }
    } catch (err) {
      console.warn(`[exchange] Kalshi crypto fetch failed for series ${s}:`, err);
    }
  }

  return results;
}

// ── FED-specific fetch helpers ────────────────────────────────────────────

/**
 * Fetch Kalshi FED rate markets (KXFED series).
 * Each FOMC meeting has ~18 strike levels (0.00% to 4.25%) for rate thresholds.
 */
export async function fetchKalshiFedMarkets(limit = 200): Promise<NormalizedMarket[]> {
  if (getExchangeMode() === 'mock') return getMockMarkets('KALSHI');

  const fedSeries = ['KXFED'];
  const results: NormalizedMarket[] = [];

  for (const s of fedSeries) {
    try {
      const params = new URLSearchParams({ status: 'open', limit: String(limit), series_ticker: s });
      const data = await fetchJson(`${KALSHI_API_URL}/markets?${params}`);
      const markets: any[] = data.markets || [];

      for (const m of markets) {
        const fedFields = parseKalshiFedFields(m);
        if (!fedFields) continue;

        results.push({
          venueMarketId: m.ticker,
          question: m.title || m.question || '',
          url: `https://kalshi.com/markets/${m.ticker}`,
          status: (m.status === 'finalized' || m.status === 'closed') ? 'closed' : 'open',
          yesTokenId: m.ticker,
          noTokenId: m.ticker,
          resolvesAt: m.close_time || m.expiration_time || undefined,
          cryptoFields: fedFields,
        });
      }

      if (results.length > 0) {
        console.log(`[exchange] Kalshi ${s}: ${results.length} FED markets`);
      }
    } catch (err) {
      console.warn(`[exchange] Kalshi FED fetch failed for series ${s}:`, err);
    }
  }

  return results;
}

// ── MACRO-specific fetch helpers ──────────────────────────────────────────

/**
 * Fetch Kalshi MACRO markets (KXCPI + KXGDP series).
 */
export async function fetchKalshiMacroMarkets(limit = 200): Promise<NormalizedMarket[]> {
  if (getExchangeMode() === 'mock') return getMockMarkets('KALSHI');

  const macroSeries = Object.keys(MACRO_SERIES);
  const results: NormalizedMarket[] = [];

  for (const s of macroSeries) {
    try {
      const params = new URLSearchParams({ status: 'open', limit: String(limit), series_ticker: s });
      const data = await fetchJson(`${KALSHI_API_URL}/markets?${params}`);
      const markets: any[] = data.markets || [];

      for (const m of markets) {
        const macroFields = parseKalshiMacroFields(m);
        if (!macroFields) continue;

        results.push({
          venueMarketId: m.ticker,
          question: m.title || m.question || '',
          url: `https://kalshi.com/markets/${m.ticker}`,
          status: (m.status === 'finalized' || m.status === 'closed') ? 'closed' : 'open',
          yesTokenId: m.ticker,
          noTokenId: m.ticker,
          resolvesAt: m.close_time || m.expiration_time || undefined,
          cryptoFields: macroFields,
        });
      }

      if (markets.length > 0) {
        console.log(`[exchange] Kalshi ${s}: ${markets.length} MACRO markets`);
      }
    } catch (err) {
      console.warn(`[exchange] Kalshi MACRO fetch failed for series ${s}:`, err);
    }
  }

  return results;
}

// ── Combined categorized fetch ────────────────────────────────────────────

export interface CategorizedPMMarkets {
  crypto: NormalizedMarket[];
  fed: NormalizedMarket[];
  macro: NormalizedMarket[];
  events: NormalizedMarket[];
}

/**
 * Single-pass Polymarket paginator that categorizes markets into crypto, FED, and MACRO.
 * Avoids doubling the 30-60s full scan by applying all parsers in one pass.
 */
export async function fetchPolymarketCategorizedMarkets(): Promise<CategorizedPMMarkets> {
  if (getExchangeMode() === 'mock') {
    return { crypto: getMockMarkets('POLYMARKET'), fed: [], macro: [], events: [] };
  }

  const PAGE_SIZE = 100;
  const MAX_PAGES = 120;
  const seenIds = new Set<string>();
  const crypto: NormalizedMarket[] = [];
  const fed: NormalizedMarket[] = [];
  const macro: NormalizedMarket[] = [];
  const events: NormalizedMarket[] = [];
  let totalScanned = 0;

  console.log('[exchange] PM categorized scan: paginating all open markets...');

  for (let page = 0; page < MAX_PAGES; page++) {
    try {
      const params = new URLSearchParams({
        active: 'true',
        closed: 'false',
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });

      const data = await fetchJson(`${PM_GAMMA_URL}/markets?${params}`, 30000);
      const markets: any[] = Array.isArray(data) ? data : data.markets || [];

      if (markets.length === 0) break;
      totalScanned += markets.length;

      for (const m of markets) {
        let tokenIds: string[] = [];
        try {
          tokenIds = typeof m.clobTokenIds === 'string'
            ? JSON.parse(m.clobTokenIds)
            : (m.clobTokenIds || []);
        } catch { continue; }
        if (tokenIds.length < 2) continue;

        const conditionId = m.conditionId || m.id;
        if (seenIds.has(conditionId)) continue;

        const question = m.question || m.title || '';
        const parseContext = [question, m.slug || '', m.groupItemTitle || '', (m.description || '').slice(0, 500)].join(' ');
        const endDate = m.endDateIso || m.endDate;

        const market: NormalizedMarket = {
          venueMarketId: conditionId,
          question,
          url: `https://polymarket.com/event/${m.events?.[0]?.slug || m.slug || conditionId}`,
          status: m.active ? 'open' : 'closed',
          yesTokenId: tokenIds[0],
          noTokenId: tokenIds[1],
          resolvesAt: endDate || undefined,
        };

        // Try crypto first (most common)
        const cryptoFields = parsePolymarketCryptoFields(parseContext, endDate);
        if (cryptoFields) {
          seenIds.add(conditionId);
          crypto.push({ ...market, cryptoFields });
          continue;
        }

        // Try FED
        const fedFields = parsePolymarketFedFields(parseContext, endDate);
        if (fedFields) {
          seenIds.add(conditionId);
          fed.push({ ...market, cryptoFields: fedFields });
          continue;
        }

        // Try MACRO (CPI, GDP)
        const macroFields = parsePolymarketMacroFields(parseContext, endDate);
        if (macroFields) {
          seenIds.add(conditionId);
          macro.push({ ...market, cryptoFields: macroFields });
          continue;
        }

        // Everything else is an event market (binary YES/NO on an outcome)
        seenIds.add(conditionId);
        const slug = m.slug || '';
        // Use condition_id as the event group (PM groups related markets under same condition)
        const eventGroup = m.conditionId || m.groupSlug || slug;
        events.push({
          ...market,
          cryptoFields: {
            asset: slug || conditionId,
            expiryTs: endDate ? Math.floor(new Date(endDate).getTime() / 1000) : null,
            predicateDirection: null,
            predicateThreshold: null,
            predicateType: 'BINARY_EVENT' as const,
          },
          eventGroup,
        });
      }

      if (markets.length < PAGE_SIZE) break;
      await new Promise(r => setTimeout(r, 100));
    } catch (err) {
      console.warn(`[exchange] PM categorized page ${page} failed:`, err);
    }
  }

  console.log(`[exchange] PM categorized scan complete: ${crypto.length} crypto, ${fed.length} FED, ${macro.length} MACRO, ${events.length} events in ${totalScanned} total`);
  return { crypto, fed, macro, events };
}

// ── Event market fetch helpers ──────────────────────────────────────────────

/**
 * Fetch Kalshi event markets — everything NOT in structured series (crypto/FED/MACRO).
 * These are political, sports, cultural, and other binary outcome markets.
 */
export async function fetchKalshiEventMarkets(limit = 200): Promise<NormalizedMarket[]> {
  if (getExchangeMode() === 'mock') return [];

  const results: NormalizedMarket[] = [];
  let cursor: string | undefined;

  try {
    // Paginate through all open Kalshi markets
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams({ status: 'open', limit: String(limit) });
      if (cursor) params.set('cursor', cursor);

      const data = await fetchJson(`${KALSHI_API_URL}/markets?${params}`);
      const markets: any[] = data.markets || [];
      if (markets.length === 0) break;

      for (const m of markets) {
        const seriesPrefix = (m.event_ticker || m.ticker || '').split('-')[0];

        // Skip structured series — these are handled by dedicated fetchers
        if (STRUCTURED_SERIES_PREFIXES.some(p => seriesPrefix.startsWith(p))) continue;

        const expiryTs = m.close_time
          ? Math.floor(new Date(m.close_time).getTime() / 1000)
          : m.expiration_time
          ? Math.floor(new Date(m.expiration_time).getTime() / 1000)
          : null;

        results.push({
          venueMarketId: m.ticker,
          question: m.title || m.question || '',
          url: `https://kalshi.com/markets/${m.ticker}`,
          status: (m.status === 'finalized' || m.status === 'closed') ? 'closed' : 'open',
          yesTokenId: m.ticker,
          noTokenId: m.ticker,
          resolvesAt: m.close_time || m.expiration_time || undefined,
          cryptoFields: {
            asset: seriesPrefix || m.ticker,
            expiryTs,
            predicateDirection: null,
            predicateThreshold: null,
            predicateType: 'BINARY_EVENT' as const,
          },
          eventGroup: m.event_ticker || seriesPrefix,
        });
      }

      cursor = data.cursor;
      if (!cursor) break;
      await new Promise(r => setTimeout(r, 100));
    }
  } catch (err) {
    console.error('[exchange] Kalshi event markets fetch error:', err);
  }

  console.log(`[exchange] Kalshi event markets: ${results.length} found`);
  return results;
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
