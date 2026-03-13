import express = require('express');
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';
import { generateSuggestions } from '../services/crypto-matcher';

const router = express.Router();

// List suggestions
router.get('/', (req: any, res: any) => {
  const db = getDb();
  const { asset, minScore = '0', status = 'suggested', bucket, limit = '100' } = req.query;

  let query = `
    SELECT ms.*,
      pm.question AS pm_question,
      pm.predicate_threshold AS pm_threshold,
      pm.expiry_ts AS pm_expiry_ts,
      k.question AS k_question,
      k.predicate_threshold AS k_threshold,
      k.expiry_ts AS k_expiry_ts
    FROM mapping_suggestions ms
    LEFT JOIN canonical_markets pm ON pm.venue_market_id = ms.polymarket_market_id AND pm.venue = 'POLYMARKET'
    LEFT JOIN canonical_markets k  ON k.venue_market_id  = ms.kalshi_market_id    AND k.venue  = 'KALSHI'
    WHERE ms.status = ?`;
  const params: any[] = [status];

  if (asset) {
    query += ' AND pm.asset = ?';
    params.push((asset as string).toUpperCase());
  }
  if (bucket) {
    query += ' AND ms.bucket = ?';
    params.push(bucket);
  }
  query += ' AND ms.score >= ?';
  params.push(parseInt(minScore as string, 10));
  query += ' ORDER BY ms.score DESC, ms.bucket ASC LIMIT ?';
  params.push(parseInt(limit as string, 10));

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// Get single suggestion
router.get('/:id', (req: any, res: any) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM mapping_suggestions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Suggestion not found' });
  res.json(row);
});

// Generate suggestions
router.post('/generate', (_req: any, res: any) => {
  try {
    const result = generateSuggestions(40);
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[suggestions] generate error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate suggestions' });
  }
});

// Approve suggestion -> create match_mapping (arb_eligible only)
router.post('/:id/approve', (req: any, res: any) => {
  const db = getDb();
  const suggestion = db.prepare('SELECT * FROM mapping_suggestions WHERE id = ?').get(req.params.id) as any;
  if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
  if (suggestion.status !== 'suggested') return res.status(400).json({ error: `Suggestion already ${suggestion.status}` });
  if (suggestion.bucket !== 'arb_eligible') {
    return res.status(400).json({ error: 'Only arb_eligible suggestions can be approved. This suggestion is research-only (expiry/threshold mismatch too large).' });
  }

  // Validate PM market has token IDs
  const pmMarket = db.prepare(`SELECT * FROM canonical_markets WHERE venue = 'POLYMARKET' AND venue_market_id = ?`).get(suggestion.polymarket_market_id) as any;
  if (!pmMarket) return res.status(422).json({ error: 'Polymarket market not found in DB — try ingesting crypto markets first' });
  if (!pmMarket.yes_token_id || !pmMarket.no_token_id) return res.status(422).json({ error: 'Polymarket market missing YES/NO token IDs — cannot create orderbook mapping' });
  if (pmMarket.status !== 'open') return res.status(422).json({ error: 'Polymarket market is not open' });

  // Validate Kalshi market
  const kalshiMarket = db.prepare(`SELECT * FROM canonical_markets WHERE venue = 'KALSHI' AND venue_market_id = ?`).get(suggestion.kalshi_market_id) as any;
  if (!kalshiMarket) return res.status(422).json({ error: 'Kalshi market not found in DB — try ingesting crypto markets first' });
  if (!kalshiMarket.yes_token_id || !kalshiMarket.no_token_id) return res.status(422).json({ error: 'Kalshi market missing outcome IDs' });
  if (kalshiMarket.status !== 'open') return res.status(422).json({ error: 'Kalshi market is not open' });

  const label = `${pmMarket.question.slice(0, 60)} <-> ${kalshiMarket.question.slice(0, 60)}`;
  const mappingId = uuid();

  try {
    db.prepare(`
      INSERT INTO match_mappings (id, polymarket_market_id, kalshi_market_id, label, confidence, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(mappingId, suggestion.polymarket_market_id, suggestion.kalshi_market_id, label, suggestion.score);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'A mapping already exists for this market pair' });
    }
    throw err;
  }

  // Update suggestion status
  db.prepare(`UPDATE mapping_suggestions SET status = 'approved', updated_at = datetime('now') WHERE id = ?`).run(suggestion.id);

  const mapping = db.prepare('SELECT * FROM match_mappings WHERE id = ?').get(mappingId);
  res.status(201).json({ mapping, message: 'Mapping created and enabled — orderbook scanning will begin within 5s' });
});

// Reject suggestion
router.post('/:id/reject', (req: any, res: any) => {
  const db = getDb();
  const suggestion = db.prepare('SELECT * FROM mapping_suggestions WHERE id = ?').get(req.params.id) as any;
  if (!suggestion) return res.status(404).json({ error: 'Suggestion not found' });
  if (suggestion.status !== 'suggested') return res.status(400).json({ error: `Suggestion already ${suggestion.status}` });
  db.prepare(`UPDATE mapping_suggestions SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`).run(suggestion.id);
  res.json({ rejected: true });
});

export default router;
