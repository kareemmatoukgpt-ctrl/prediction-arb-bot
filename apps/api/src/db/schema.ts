import Database = require('better-sqlite3');

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS canonical_markets (
  id TEXT PRIMARY KEY,
  venue TEXT NOT NULL CHECK(venue IN ('POLYMARKET', 'KALSHI')),
  venue_market_id TEXT NOT NULL,
  question TEXT NOT NULL,
  outcome_type TEXT NOT NULL DEFAULT 'BINARY',
  yes_token_id TEXT,
  no_token_id TEXT,
  resolves_at TEXT,
  resolution_source TEXT,
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(venue, venue_market_id)
);

CREATE TABLE IF NOT EXISTS orderbook_snapshots (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL REFERENCES canonical_markets(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  best_yes_bid REAL,
  best_yes_ask REAL,
  best_no_bid REAL,
  best_no_ask REAL,
  depth_json TEXT,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_orderbook_market_ts
  ON orderbook_snapshots(market_id, ts DESC);

CREATE TABLE IF NOT EXISTS match_mappings (
  id TEXT PRIMARY KEY,
  polymarket_market_id TEXT NOT NULL,
  kalshi_market_id TEXT NOT NULL,
  label TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 100,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(polymarket_market_id, kalshi_market_id)
);

CREATE TABLE IF NOT EXISTS arb_opportunities (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  mapping_id TEXT NOT NULL REFERENCES match_mappings(id),
  direction TEXT NOT NULL,
  size_usd REAL NOT NULL,
  cost_yes REAL NOT NULL,
  cost_no REAL NOT NULL,
  fees_estimate REAL NOT NULL,
  slippage_estimate REAL NOT NULL,
  buffer_bps INTEGER NOT NULL,
  expected_profit_usd REAL NOT NULL,
  expected_profit_bps INTEGER NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_arb_ts ON arb_opportunities(ts DESC);
CREATE INDEX IF NOT EXISTS idx_arb_mapping ON arb_opportunities(mapping_id);

CREATE TABLE IF NOT EXISTS paper_trades (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES arb_opportunities(id),
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  sim_params TEXT NOT NULL,
  result TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('SIMULATED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_paper_ts ON paper_trades(ts DESC);
CREATE INDEX IF NOT EXISTS idx_paper_opportunity ON paper_trades(opportunity_id);

CREATE TABLE IF NOT EXISTS mapping_suggestions (
  id TEXT PRIMARY KEY,
  polymarket_market_id TEXT NOT NULL,
  kalshi_market_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  reasons_json TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'research' CHECK(bucket IN ('arb_eligible','research')),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK(status IN ('suggested','approved','rejected')),
  expiry_delta_seconds INTEGER,
  threshold_delta_pct REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(polymarket_market_id, kalshi_market_id)
);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON mapping_suggestions(status, bucket);

CREATE TABLE IF NOT EXISTS opportunity_feed (
  id TEXT PRIMARY KEY,
  mapping_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'CRYPTO',
  venue_a TEXT NOT NULL DEFAULT 'POLYMARKET',
  venue_b TEXT NOT NULL DEFAULT 'KALSHI',
  direction TEXT NOT NULL,
  label TEXT NOT NULL,
  pm_yes_ask REAL,
  pm_no_ask REAL,
  kalshi_yes_ask REAL,
  kalshi_no_ask REAL,
  total_cost REAL,
  expected_profit_usd REAL,
  expected_profit_bps INTEGER,
  size_usd REAL NOT NULL DEFAULT 100,
  max_fill_usd REAL,
  liquidity_score INTEGER DEFAULT 0,
  expiry_ts INTEGER,
  mapping_kind TEXT,
  suspect INTEGER NOT NULL DEFAULT 0,
  suspect_reasons TEXT,
  pm_market_url TEXT,
  kalshi_market_url TEXT,
  debug_json TEXT,
  ts_updated TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(mapping_id, direction)
);
CREATE INDEX IF NOT EXISTS idx_feed_category ON opportunity_feed(category);
CREATE INDEX IF NOT EXISTS idx_feed_profit ON opportunity_feed(expected_profit_bps DESC);
CREATE INDEX IF NOT EXISTS idx_feed_suspect ON opportunity_feed(suspect);
`;

let db: any = null;

/**
 * Run migrations that must happen after schema creation.
 * Safe to run multiple times (idempotent).
 */
function runMigrations(database: any): void {
  // Migration: dedupe arb_opportunities so we can add a unique index.
  // Delete older duplicates keeping only the newest per (mapping_id, direction).
  const hasDupes = database.prepare(`
    SELECT COUNT(*) as cnt FROM (
      SELECT mapping_id, direction, COUNT(*) as c
      FROM arb_opportunities
      GROUP BY mapping_id, direction
      HAVING c > 1
    )
  `).get() as any;

  if (hasDupes.cnt > 0) {
    console.log(`[db] Deduplicating ${hasDupes.cnt} arb_opportunity groups...`);
    database.exec(`
      DELETE FROM arb_opportunities WHERE id NOT IN (
        SELECT id FROM (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY mapping_id, direction ORDER BY ts DESC) as rn
          FROM arb_opportunities
        ) WHERE rn = 1
      )
    `);
  }

  // Add unique index for upsert dedupe (idempotent via IF NOT EXISTS)
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_arb_dedupe
      ON arb_opportunities(mapping_id, direction)
  `);

  // Migration: add crypto normalization columns (idempotent)
  const existingCols = (database.pragma('table_info(canonical_markets)') as any[]).map((r: any) => r.name);
  const cryptoCols: Record<string, string> = {
    asset: 'TEXT',
    expiry_ts: 'INTEGER',
    predicate_direction: 'TEXT',
    predicate_threshold: 'REAL',
    predicate_type: 'TEXT',
  };
  for (const [col, type] of Object.entries(cryptoCols)) {
    if (!existingCols.includes(col)) {
      console.log(`[db] Adding column canonical_markets.${col}`);
      database.exec(`ALTER TABLE canonical_markets ADD COLUMN ${col} ${type}`);
    }
  }

  // Migration: add mapping_kind column to match_mappings
  const mappingCols = (database.pragma('table_info(match_mappings)') as any[]).map((r: any) => r.name);
  if (!mappingCols.includes('mapping_kind')) {
    console.log(`[db] Adding column match_mappings.mapping_kind`);
    database.exec(`ALTER TABLE match_mappings ADD COLUMN mapping_kind TEXT NOT NULL DEFAULT 'manual_unverified'`);
  }

  // Migration: add category column to canonical_markets
  if (!existingCols.includes('category')) {
    console.log(`[db] Adding column canonical_markets.category`);
    database.exec(`ALTER TABLE canonical_markets ADD COLUMN category TEXT`);
  }

  // Migration: add type_risk and arb_type columns to opportunity_feed
  const feedCols = (database.pragma('table_info(opportunity_feed)') as any[]).map((r: any) => r.name);
  if (!feedCols.includes('type_risk')) {
    console.log(`[db] Adding column opportunity_feed.type_risk`);
    database.exec(`ALTER TABLE opportunity_feed ADD COLUMN type_risk TEXT`);
  }
  if (!feedCols.includes('arb_type')) {
    console.log(`[db] Adding column opportunity_feed.arb_type`);
    database.exec(`ALTER TABLE opportunity_feed ADD COLUMN arb_type TEXT DEFAULT 'cross_venue'`);
  }

  // Migration: add event_group columns to canonical_markets
  if (!existingCols.includes('event_group')) {
    console.log(`[db] Adding column canonical_markets.event_group`);
    database.exec(`ALTER TABLE canonical_markets ADD COLUMN event_group TEXT`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_markets_event_group ON canonical_markets(event_group)`);
  }
}

export function getDb(): any {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || './prediction-arb-bot.db';
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
    runMigrations(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
