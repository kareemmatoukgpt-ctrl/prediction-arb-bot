/**
 * Fetch sports markets from Polymarket's API.
 *
 * Strategy:
 *   1. Paginate through the events endpoint (up to 10 pages).
 *   2. Filter for sports-related markets using keyword / pattern heuristics.
 *   3. Fetch CLOB orderbook prices in batches of 5.
 */

import { fetchJson } from './fetch-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolymarketSportsMarket {
  venueMarketId: string;
  sport: string;
  question: string;
  teams: string[];
  betType: 'MONEYLINE' | 'SPREAD' | 'TOTAL' | 'PROP';
  side: string;
  line: number | null;
  yesPrice: number | null;
  noPrice: number | null;
  yesTokenId: string;
  noTokenId: string;
  url: string;
  startTime: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENTS_BASE = 'https://gamma-api.polymarket.com/events?closed=false&limit=100&offset=';
const MARKETS_BASE = 'https://gamma-api.polymarket.com/markets?closed=false&limit=100&offset=';
const ORDERBOOK_BASE = 'https://clob.polymarket.com/book?token_id=';

const PAGE_LIMIT = 100;
const MAX_PAGES = 10;
const ORDERBOOK_BATCH_SIZE = 5;
const ORDERBOOK_DELAY_MS = 100;

// ---------------------------------------------------------------------------
// Sport detection keywords
// ---------------------------------------------------------------------------

const SPORT_KEYWORDS: [RegExp, string][] = [
  [/\bNBA\b/i, 'NBA'],
  [/\bNFL\b/i, 'NFL'],
  [/\bNHL\b/i, 'NHL'],
  [/\bMLB\b/i, 'MLB'],
  [/\bUFC\b/i, 'UFC'],
  [/\bMMA\b/i, 'UFC'],
  [/\bPremier League\b/i, 'SOCCER'],
  [/\bEPL\b/i, 'SOCCER'],
  [/\bLa Liga\b/i, 'SOCCER'],
  [/\bBundesliga\b/i, 'SOCCER'],
  [/\bSerie A\b/i, 'SOCCER'],
  [/\bLigue 1\b/i, 'SOCCER'],
  [/\bMLS\b/i, 'SOCCER'],
  [/\bChampions League\b/i, 'SOCCER'],
  [/\bEuropa League\b/i, 'SOCCER'],
  [/\bWorld Cup\b/i, 'SOCCER'],
  [/\bPGA\b/i, 'GOLF'],
  [/\bgolf\b/i, 'GOLF'],
  [/\bATP\b/i, 'TENNIS'],
  [/\bWTA\b/i, 'TENNIS'],
  [/\bNCAAB\b/i, 'NCAAB'],
  [/\bMarch Madness\b/i, 'NCAAB'],
  [/\bSuper Bowl\b/i, 'NFL'],
  [/\bWorld Series\b/i, 'MLB'],
  [/\bStanley Cup\b/i, 'NHL'],
  [/\bNBA Finals\b/i, 'NBA'],
];

// Known NBA teams (partial list for matching)
const NBA_TEAMS = [
  'Lakers', 'Celtics', 'Warriors', 'Bucks', 'Nuggets', 'Heat', 'Suns',
  'Sixers', '76ers', 'Nets', 'Knicks', 'Clippers', 'Mavericks', 'Grizzlies',
  'Cavaliers', 'Kings', 'Pelicans', 'Hawks', 'Bulls', 'Raptors', 'Thunder',
  'Timberwolves', 'Trail Blazers', 'Blazers', 'Pacers', 'Jazz', 'Hornets',
  'Wizards', 'Pistons', 'Magic', 'Spurs', 'Rockets',
];

const NFL_TEAMS = [
  'Chiefs', 'Eagles', 'Bills', 'Cowboys', 'Dolphins', '49ers', 'Niners',
  'Bengals', 'Lions', 'Jaguars', 'Ravens', 'Chargers', 'Seahawks', 'Steelers',
  'Vikings', 'Packers', 'Jets', 'Browns', 'Raiders', 'Broncos', 'Texans',
  'Colts', 'Titans', 'Saints', 'Commanders', 'Falcons', 'Buccaneers', 'Bucs',
  'Panthers', 'Bears', 'Giants', 'Cardinals', 'Rams',
];

/** Sports-related patterns for fuzzy matching */
const SPORTS_PATTERNS = [
  /\bvs\.?\b/i,
  /\bv\.\b/i,
  /\bwill win\b/i,
  /\bto win\b/i,
  /\bmoneyline\b/i,
  /\bspread\b/i,
  /\bover\s*\/?\s*under\b/i,
  /\btotal points\b/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectSport(text: string): string | null {
  for (const [re, sport] of SPORT_KEYWORDS) {
    if (re.test(text)) return sport;
  }
  for (const team of NBA_TEAMS) {
    if (new RegExp(`\\b${team}\\b`, 'i').test(text)) return 'NBA';
  }
  for (const team of NFL_TEAMS) {
    if (new RegExp(`\\b${team}\\b`, 'i').test(text)) return 'NFL';
  }
  return null;
}

function isSportsRelated(text: string): boolean {
  if (detectSport(text) !== null) return true;
  for (const re of SPORTS_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Question parsing
// ---------------------------------------------------------------------------

/**
 * Attempt to extract structured bet info from a Polymarket question string.
 * Returns null if we cannot identify at least two teams.
 */
export function parsePolymarketSportsQuestion(
  question: string,
): { teams: string[]; betType: string; side: string | null; line: number | null } | null {
  const q = question.trim();

  // Detect bet type first ------------------------------------------------
  let betType: 'MONEYLINE' | 'SPREAD' | 'TOTAL' | 'PROP' = 'MONEYLINE';
  let side: string | null = null;
  let line: number | null = null;

  // Total / Over-Under
  const totalMatch = q.match(/\b[Oo]ver\s+([\d.]+)\s+total\s+points/i)
    ?? q.match(/\b[Oo]ver\s*\/?\s*[Uu]nder\s+([\d.]+)/i)
    ?? q.match(/\b[Tt]otal\s+(?:points?\s+)?[Oo]ver\s+([\d.]+)/i);
  if (totalMatch) {
    betType = 'TOTAL';
    line = parseFloat(totalMatch[1]);
    side = /over/i.test(q) ? 'OVER' : 'UNDER';
  }

  const underMatch = q.match(/\b[Uu]nder\s+([\d.]+)\s+total\s+points/i)
    ?? q.match(/\b[Tt]otal\s+(?:points?\s+)?[Uu]nder\s+([\d.]+)/i);
  if (underMatch) {
    betType = 'TOTAL';
    line = parseFloat(underMatch[1]);
    side = 'UNDER';
  }

  // Spread
  const spreadMatch = q.match(/([+-]?\d+\.?\d*)\s*(?:point)?\s*spread/i)
    ?? q.match(/spread\s*[:\-]?\s*([+-]?\d+\.?\d*)/i);
  if (spreadMatch) {
    betType = 'SPREAD';
    line = parseFloat(spreadMatch[1]);
  }

  // Prop – anything with "most", "MVP", specific player props
  if (/\bMVP\b/i.test(q) || /\bmost\b/i.test(q) || /\bto score\b/i.test(q)) {
    betType = 'PROP';
  }

  // Extract teams --------------------------------------------------------
  const teams: string[] = [];

  // Pattern: "X vs Y" or "X v. Y"
  const vsMatch = q.match(/^(.+?)\s+vs?\.?\s+(.+?)(?:\s*[:\-–—?]|$)/i);
  if (vsMatch) {
    teams.push(vsMatch[1].replace(/^Will\s+(?:the\s+)?/i, '').trim());
    teams.push(vsMatch[2].replace(/\?.*$/, '').trim());
  }

  // Pattern: "Will the X beat the Y"
  if (teams.length < 2) {
    const beatMatch = q.match(/Will\s+(?:the\s+)?(.+?)\s+beat\s+(?:the\s+)?(.+?)[\s?]/i);
    if (beatMatch) {
      teams.length = 0;
      teams.push(beatMatch[1].trim());
      teams.push(beatMatch[2].replace(/\?.*$/, '').trim());
    }
  }

  // Pattern: "X to win" / "X will win"
  if (teams.length < 2) {
    const winMatch = q.match(/(?:Will\s+(?:the\s+)?)?(.+?)\s+(?:to|will)\s+win/i);
    if (winMatch) {
      teams.push(winMatch[1].trim());
    }
  }

  if (teams.length === 0) return null;

  return { teams, betType, side, line };
}

// ---------------------------------------------------------------------------
// Orderbook price fetching
// ---------------------------------------------------------------------------

interface OrderbookResponse {
  bids?: { price: string; size: string }[];
  asks?: { price: string; size: string }[];
}

async function fetchOrderbookPrice(
  tokenId: string,
): Promise<{ yesPrice: number | null; noPrice: number | null }> {
  try {
    const book: OrderbookResponse = await fetchJson(`${ORDERBOOK_BASE}${tokenId}`);
    const asks = book.asks ?? [];
    const bids = book.bids ?? [];

    let yesPrice: number | null = null;
    let noPrice: number | null = null;

    if (asks.length > 0) {
      // Best (lowest) ask = yes price
      yesPrice = Math.min(...asks.map((a) => parseFloat(a.price)));
    }
    if (bids.length > 0) {
      // Best (highest) bid → no price = 1 - best bid
      const bestBid = Math.max(...bids.map((b) => parseFloat(b.price)));
      noPrice = parseFloat((1 - bestBid).toFixed(4));
    }

    return { yesPrice, noPrice };
  } catch {
    return { yesPrice: null, noPrice: null };
  }
}

// ---------------------------------------------------------------------------
// Main fetch
// ---------------------------------------------------------------------------

interface GammaMarket {
  id?: string;
  condition_id?: string;
  question?: string;
  slug?: string;
  outcomes?: string;
  outcomePrices?: string;
  clobTokenIds?: string;
  startDate?: string;
  endDate?: string;
  closed?: boolean;
}

interface GammaEvent {
  id?: string;
  title?: string;
  slug?: string;
  markets?: GammaMarket[];
  startDate?: string;
}

export async function fetchPolymarketSportsMarkets(): Promise<PolymarketSportsMarket[]> {
  const allMarkets: GammaMarket[] = [];
  let totalFetched = 0;

  // 1. Paginate events endpoint
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_LIMIT;
    try {
      const events: GammaEvent[] = await fetchJson(`${EVENTS_BASE}${offset}`);
      if (!Array.isArray(events) || events.length === 0) break;

      for (const evt of events) {
        if (evt.markets && Array.isArray(evt.markets)) {
          for (const m of evt.markets) {
            allMarkets.push(m);
          }
        }
      }

      totalFetched += events.length;
      if (events.length < PAGE_LIMIT) break;
    } catch (err) {
      console.error(`[sports/polymarket] Error fetching events page ${page}:`, err);
      break;
    }
  }

  // 2. Also paginate individual markets endpoint for any that don't appear in events
  const seenIds = new Set(allMarkets.map((m) => m.id ?? m.condition_id));
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * PAGE_LIMIT;
    try {
      const markets: GammaMarket[] = await fetchJson(`${MARKETS_BASE}${offset}`);
      if (!Array.isArray(markets) || markets.length === 0) break;

      for (const m of markets) {
        const mid = m.id ?? m.condition_id;
        if (mid && !seenIds.has(mid)) {
          seenIds.add(mid);
          allMarkets.push(m);
        }
      }

      totalFetched += markets.length;
      if (markets.length < PAGE_LIMIT) break;
    } catch (err) {
      console.error(`[sports/polymarket] Error fetching markets page ${page}:`, err);
      break;
    }
  }

  // 3. Filter for sports-related
  const sportsRaw = allMarkets.filter((m) => {
    const text = m.question ?? '';
    return isSportsRelated(text);
  });

  // 4. Build structured markets — only keep markets with 2 parseable teams
  const structured: PolymarketSportsMarket[] = [];
  let skippedNoTeams = 0;
  for (const m of sportsRaw) {
    const question = m.question ?? '';
    const sport = detectSport(question) ?? 'OTHER';
    const parsed = parsePolymarketSportsQuestion(question);

    // Skip markets without 2 identifiable teams (futures, qualifiers, props)
    if (!parsed || parsed.teams.length < 2) {
      skippedNoTeams++;
      continue;
    }

    let tokenIds: string[] = [];
    try {
      tokenIds = m.clobTokenIds ? JSON.parse(m.clobTokenIds) : [];
    } catch {
      // ignore parse errors
    }

    const yesTokenId = tokenIds[0] ?? '';
    const noTokenId = tokenIds[1] ?? '';

    const slug = m.slug ?? '';
    const url = slug ? `https://polymarket.com/event/${slug}` : '';

    let startTime = 0;
    if (m.startDate) {
      const ts = new Date(m.startDate).getTime();
      if (!Number.isNaN(ts)) startTime = Math.floor(ts / 1000); // convert ms to unix seconds
    }

    structured.push({
      venueMarketId: m.condition_id ?? m.id ?? '',
      sport,
      question,
      teams: parsed.teams,
      betType: (parsed.betType as PolymarketSportsMarket['betType']) ?? 'MONEYLINE',
      side: parsed.side || 'YES',
      line: parsed.line ?? null,
      yesPrice: null,
      noPrice: null,
      yesTokenId,
      noTokenId,
      url,
      startTime,
    });
  }

  if (skippedNoTeams > 0) {
    console.log(`[sports/polymarket] Skipped ${skippedNoTeams} markets without 2 parseable teams`);
  }

  // 5. Fetch orderbook prices in batches of 5
  for (let i = 0; i < structured.length; i += ORDERBOOK_BATCH_SIZE) {
    const batch = structured.slice(i, i + ORDERBOOK_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((m) => (m.yesTokenId ? fetchOrderbookPrice(m.yesTokenId) : Promise.resolve({ yesPrice: null, noPrice: null }))),
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        batch[j].yesPrice = r.value.yesPrice;
        batch[j].noPrice = r.value.noPrice;
      }
    }

    // Small delay between batches
    if (i + ORDERBOOK_BATCH_SIZE < structured.length) {
      await delay(ORDERBOOK_DELAY_MS);
    }
  }

  console.log(
    `[sports/polymarket] Fetched ${structured.length} sports markets from ${allMarkets.length} total markets`,
  );

  return structured;
}
