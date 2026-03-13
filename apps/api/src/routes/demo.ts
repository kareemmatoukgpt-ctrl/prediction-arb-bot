/**
 * Demo seed route — pre-populates the DB with realistic mock data
 * so you can see the dashboard working immediately.
 */
import express = require('express');
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';
import { scanForArbs } from '../services/arb-engine';

const router = express.Router();

// Seed demo markets, mappings, orderbooks, and opportunities
router.post('/seed', (_req: any, res: any) => {
  const db = getDb();

  // Check if already seeded
  const existing = db.prepare('SELECT COUNT(*) as count FROM match_mappings').get() as any;
  if (existing.count > 0) {
    return res.json({ message: 'Already seeded', seeded: false });
  }

  // ── Demo market pairs ──
  const pairs = [
    {
      label: 'Will the Fed cut rates in June 2026?',
      pmId: 'pm-fed-rate-june-2026',
      kalshiId: 'FED-25JUN-Y',
      pmYesAsk: 0.42,
      pmNoAsk: 0.60,  // <-- intentional arb: 0.42 + 0.56 < 1
      kalshiYesAsk: 0.44,
      kalshiNoAsk: 0.56,
    },
    {
      label: 'Will Bitcoin exceed $120k by end of 2026?',
      pmId: 'pm-btc-120k-2026',
      kalshiId: 'KXBTC-120K-26',
      pmYesAsk: 0.31,
      pmNoAsk: 0.71,
      kalshiYesAsk: 0.33,
      kalshiNoAsk: 0.68,
    },
    {
      label: 'Will the US enter recession in 2026?',
      pmId: 'pm-us-recession-2026',
      kalshiId: 'RECESSION-26',
      pmYesAsk: 0.23,
      pmNoAsk: 0.79,  // <-- intentional arb: 0.23 + 0.76 < 1
      kalshiYesAsk: 0.24,
      kalshiNoAsk: 0.76,
    },
  ];

  const insertMarket = db.prepare(`
    INSERT OR IGNORE INTO canonical_markets (id, venue, venue_market_id, question, url, status, yes_token_id, no_token_id)
    VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
  `);

  const insertMapping = db.prepare(`
    INSERT OR IGNORE INTO match_mappings (id, polymarket_market_id, kalshi_market_id, label, confidence, enabled)
    VALUES (?, ?, ?, ?, 100, 1)
  `);

  const insertSnapshot = db.prepare(`
    INSERT INTO orderbook_snapshots (id, market_id, ts, best_yes_bid, best_yes_ask, best_no_bid, best_no_ask, depth_json, raw_json)
    VALUES (?, ?, datetime('now'), ?, ?, ?, ?, '[]', '{"mock":true}')
  `);

  const seededMappings = [];

  for (const pair of pairs) {
    const pmId = uuid();
    const kalshiId = uuid();
    const mappingId = uuid();

    // Insert markets
    insertMarket.run(pmId, 'POLYMARKET', pair.pmId, pair.label, `https://polymarket.com/event/${pair.pmId}`, pair.pmId + '-yes', pair.pmId + '-no');
    insertMarket.run(kalshiId, 'KALSHI', pair.kalshiId, pair.label, `https://kalshi.com/markets/${pair.kalshiId}`, pair.kalshiId + '-yes', pair.kalshiId + '-no');

    // Insert mapping
    insertMapping.run(mappingId, pair.pmId, pair.kalshiId, pair.label);

    // Insert fresh orderbook snapshots
    insertSnapshot.run(uuid(), pmId, pair.pmYesAsk - 0.01, pair.pmYesAsk, pair.pmNoAsk - 0.01, pair.pmNoAsk);
    insertSnapshot.run(uuid(), kalshiId, pair.kalshiYesAsk - 0.01, pair.kalshiYesAsk, pair.kalshiNoAsk - 0.01, pair.kalshiNoAsk);

    seededMappings.push(pair.label);
  }

  // Run arb scanner immediately
  const arbResult = scanForArbs();

  res.json({
    seeded: true,
    mappings: seededMappings.length,
    opportunities: arbResult.found,
    message: `Seeded ${seededMappings.length} market pairs. Found ${arbResult.found} arb opportunities.`,
  });
});

// Reset all demo data
router.post('/reset', (_req: any, res: any) => {
  const db = getDb();
  db.exec('DELETE FROM paper_trades');
  db.exec('DELETE FROM arb_opportunities');
  db.exec('DELETE FROM orderbook_snapshots');
  db.exec('DELETE FROM match_mappings');
  db.exec('DELETE FROM canonical_markets');
  res.json({ reset: true });
});

export default router;
