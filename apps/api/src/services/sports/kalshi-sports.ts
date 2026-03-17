/**
 * Kalshi sports market fetcher.
 * Fetches open markets from Kalshi's API across multiple sports series
 * and normalises them into a common KalshiSportsMarket shape.
 */

import { fetchJson } from './fetch-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KalshiSportsMarket {
  venueMarketId: string;
  sport: string;
  question: string;
  teams: string[];
  betType: 'MONEYLINE' | 'SPREAD' | 'TOTAL' | 'PROP';
  side: string;
  line: number | null;
  yesPrice: number | null;
  noPrice: number | null;
  url: string;
  startTime: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2/markets';

const SERIES_PREFIXES: Record<string, string> = {
  KXNBA: 'NBA',
  KXNFL: 'NFL',
  KXNHL: 'NHL',
  KXMLB: 'MLB',
  KXNCAAMB: 'NCAAMB',
  KXUFC: 'UFC',
  KXPGATOU: 'PGA',
  KXEPLGAME: 'EPL',
  KXEPLSPREAD: 'EPL',
  KXEPLTOTAL: 'EPL',
};

// ---------------------------------------------------------------------------
// Title parsing
// ---------------------------------------------------------------------------

/**
 * Attempt to extract structured bet info from a Kalshi market title.
 * Returns null when the title cannot be meaningfully parsed (expected for
 * many prop / exotic markets).
 */
export function parseKalshiSportsTitle(
  title: string,
): { teams: string[]; betType: string; side: string | null; line: number | null } | null {
  if (!title) return null;

  const clean = title.trim();

  // --- TOTAL patterns ---------------------------------------------------
  // "Total Points Over 215.5", "Over 215.5", "Under 215.5"
  const totalMatch = clean.match(
    /(?:total\s+(?:points|goals|runs|score)?\s*)?(?<side>over|under)\s+(?<line>[+-]?\d+(?:\.\d+)?)/i,
  );
  if (totalMatch?.groups) {
    const side = totalMatch.groups.side.toUpperCase();
    const line = parseFloat(totalMatch.groups.line);
    // Try to pull teams from surrounding text: "TeamA vs TeamB: Over …"
    const teams = extractTeams(clean);
    return { teams, betType: 'TOTAL', side, line };
  }

  // --- SPREAD patterns ---------------------------------------------------
  // "Lakers vs Celtics: Spread -4.5"
  const spreadExplicit = clean.match(
    /spread\s+(?<line>[+-]?\d+(?:\.\d+)?)/i,
  );
  if (spreadExplicit?.groups) {
    const line = parseFloat(spreadExplicit.groups.line);
    const teams = extractTeams(clean);
    return { teams, betType: 'SPREAD', side: null, line };
  }

  // "Lakers (-4.5)" style
  const spreadParen = clean.match(
    /(?<team>[A-Za-z\s]+?)\s*\(\s*(?<line>[+-]\d+(?:\.\d+)?)\s*\)/,
  );
  if (spreadParen?.groups) {
    const line = parseFloat(spreadParen.groups.line);
    const teams = extractTeams(clean);
    const side = spreadParen.groups.team.trim();
    return { teams, betType: 'SPREAD', side, line };
  }

  // --- MONEYLINE patterns ------------------------------------------------
  // "Lakers vs Celtics" or "Will the Lakers beat the Celtics?"
  const teams = extractTeams(clean);
  if (teams.length >= 2) {
    return { teams, betType: 'MONEYLINE', side: null, line: null };
  }

  // Could not parse — likely a prop or non-standard title.
  return null;
}

/**
 * Pull two team names out of common title shapes.
 */
function extractTeams(text: string): string[] {
  // "TeamA vs TeamB" / "TeamA vs. TeamB"
  const vsMatch = text.match(
    /(?:^|[:\-])\s*(?:(?:the|will)\s+)?(.+?)\s+vs\.?\s+(?:the\s+)?(.+?)(?:\s*[:\-\(?]|$)/i,
  );
  if (vsMatch) {
    return [vsMatch[1].trim(), vsMatch[2].trim()];
  }

  // "Will the Lakers beat the Celtics?"
  const beatMatch = text.match(
    /(?:will\s+)?(?:the\s+)?(.+?)\s+beat\s+(?:the\s+)?(.+?)(?:\?|$)/i,
  );
  if (beatMatch) {
    return [beatMatch[1].trim(), beatMatch[2].trim()];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Fetch all open markets for a single series ticker using cursor pagination.
 */
async function fetchSeriesMarkets(
  seriesTicker: string,
  sport: string,
): Promise<KalshiSportsMarket[]> {
  const markets: KalshiSportsMarket[] = [];
  let cursor: string | undefined;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let url = `${BASE_URL}?series_ticker=${seriesTicker}&status=open&limit=200`;
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    const data = await fetchJson(url);
    const rawMarkets: any[] = data?.markets ?? [];
    if (rawMarkets.length === 0) break;

    for (const m of rawMarkets) {
      const titleText: string = m.subtitle || m.title || '';
      const parsed = parseKalshiSportsTitle(titleText);

      // Skip markets we cannot meaningfully parse into teams
      if (!parsed || parsed.teams.length < 2) continue;

      // Kalshi API: prefer yes_ask (decimal 0-1), fall back to yes_ask_dollars.
      // Consistent with exchange.ts line 543 — do NOT divide by 100.
      const yesPrice = m.yes_ask != null ? Number(m.yes_ask)
        : m.yes_ask_dollars != null ? Number(m.yes_ask_dollars) : null;
      const noPrice = m.no_ask != null ? Number(m.no_ask)
        : m.no_ask_dollars != null ? Number(m.no_ask_dollars) : null;

      const eventTicker: string = (m.event_ticker ?? '').toLowerCase();
      const url = `https://kalshi.com/markets/${eventTicker}`;

      const startTime = m.close_time
        ? Math.floor(new Date(m.close_time).getTime() / 1000)
        : 0;

      markets.push({
        venueMarketId: m.ticker ?? '',
        sport,
        question: titleText,
        teams: parsed.teams,
        betType: parsed.betType as KalshiSportsMarket['betType'],
        side: parsed.side || 'YES',
        line: parsed.line,
        yesPrice,
        noPrice,
        url,
        startTime,
      });
    }

    cursor = data.cursor;
    if (!cursor) break;
  }

  return markets;
}

/**
 * Fetch sports markets across all Kalshi sports series in parallel.
 */
export async function fetchKalshiSportsMarkets(): Promise<KalshiSportsMarket[]> {
  const entries = Object.entries(SERIES_PREFIXES);

  const results = await Promise.allSettled(
    entries.map(([prefix, sport]) => fetchSeriesMarkets(prefix, sport)),
  );

  const allMarkets: KalshiSportsMarket[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      allMarkets.push(...result.value);
    } else {
      console.error(
        `[sports/kalshi] Error fetching series ${entries[i][0]}:`,
        result.reason,
      );
    }
  }

  console.log(
    `[sports/kalshi] Fetched ${allMarkets.length} markets across ${entries.length} series`,
  );

  return allMarkets;
}
