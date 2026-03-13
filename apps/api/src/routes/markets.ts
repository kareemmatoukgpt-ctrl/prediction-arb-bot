import express = require('express');
import { getDb } from '../db/schema';
import { refreshMarkets, refreshCryptoMarkets } from '../services/ingestion';

const router = express.Router();

// List markets with optional venue filter
router.get('/', (req: any, res: any) => {
  const db = getDb();
  const venue = req.query.venue as string | undefined;
  const search = req.query.search as string | undefined;
  const limit = parseInt(req.query.limit as string || '100', 10);

  let query = 'SELECT * FROM canonical_markets WHERE 1=1';
  const params: any[] = [];

  if (venue) {
    query += ' AND venue = ?';
    params.push(venue.toUpperCase());
  }

  if (search) {
    query += ' AND question LIKE ?';
    params.push(`%${search}%`);
  }

  const asset = req.query.asset as string | undefined;
  if (asset) {
    query += ' AND asset = ?';
    params.push(asset.toUpperCase());
  }

  query += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  const markets = db.prepare(query).all(...params);
  res.json(markets);
});

// Force refresh markets
router.post('/refresh', async (_req: any, res: any) => {
  try {
    const result = await refreshMarkets();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh markets' });
  }
});

// Get latest orderbook for a market
router.get('/:id/orderbook', (req: any, res: any) => {
  const db = getDb();
  const snapshot = db.prepare(`
    SELECT * FROM orderbook_snapshots
    WHERE market_id = ?
    ORDER BY ts DESC
    LIMIT 1
  `).get(req.params.id);

  if (!snapshot) return res.status(404).json({ error: 'No orderbook data' });
  res.json(snapshot);
});

// Ingest crypto markets from both venues
router.post('/ingest/crypto', async (_req: any, res: any) => {
  try {
    const result = await refreshCryptoMarkets();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[markets] ingest/crypto error:', err);
    res.status(500).json({ error: 'Failed to ingest crypto markets' });
  }
});

export default router;
