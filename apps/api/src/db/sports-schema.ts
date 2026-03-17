/**
 * Sports arbitrage database schema.
 * Called from schema.ts via initSportsSchema(db).
 * Safe to run multiple times (CREATE TABLE IF NOT EXISTS).
 */

const SPORTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sports_events (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  league TEXT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  start_time INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK(status IN ('upcoming', 'live', 'final')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(sport, home_team, away_team, start_time)
);

CREATE INDEX IF NOT EXISTS idx_sports_events_start ON sports_events(start_time);

CREATE TABLE IF NOT EXISTS sports_markets (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES sports_events(id),
  venue TEXT NOT NULL CHECK(venue IN ('POLYMARKET', 'KALSHI')),
  venue_market_id TEXT NOT NULL,
  question TEXT NOT NULL,
  bet_type TEXT NOT NULL CHECK(bet_type IN ('MONEYLINE', 'SPREAD', 'TOTAL', 'PROP')),
  side TEXT NOT NULL CHECK(side IN ('HOME', 'AWAY', 'OVER', 'UNDER', 'DRAW', 'YES', 'NO')),
  line REAL,
  yes_price REAL,
  no_price REAL,
  url TEXT DEFAULT '',
  last_fetched TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(venue, venue_market_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_markets_event ON sports_markets(event_id);

CREATE TABLE IF NOT EXISTS sports_arbs (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES sports_events(id),
  bet_type TEXT NOT NULL,
  side_a TEXT NOT NULL,
  side_b TEXT NOT NULL,
  venue_a TEXT NOT NULL,
  venue_b TEXT NOT NULL,
  market_a_id TEXT REFERENCES sports_markets(id),
  market_b_id TEXT REFERENCES sports_markets(id),
  price_a REAL NOT NULL,
  price_b REAL NOT NULL,
  combined_cost REAL NOT NULL,
  edge_bps INTEGER NOT NULL,
  profit_per_dollar REAL NOT NULL,
  size_usd REAL DEFAULT 100,
  profit_usd REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired')),
  found_at TEXT NOT NULL DEFAULT (datetime('now')),
  expired_at TEXT,
  UNIQUE(market_a_id, market_b_id)
);

CREATE INDEX IF NOT EXISTS idx_sports_arbs_status ON sports_arbs(status, edge_bps DESC);

CREATE TABLE IF NOT EXISTS team_aliases (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  alias TEXT NOT NULL,
  sport TEXT NOT NULL,
  UNIQUE(alias, sport)
);

CREATE INDEX IF NOT EXISTS idx_team_aliases_lookup ON team_aliases(alias, sport);
`;

export function initSportsSchema(db: any): void {
  db.exec(SPORTS_SCHEMA_SQL);
}
