import express = require('express');
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/schema';

const router = express.Router();

// List all mappings
router.get('/', (_req: any, res: any) => {
  const db = getDb();
  const mappings = db.prepare('SELECT * FROM match_mappings ORDER BY created_at DESC').all();
  res.json(mappings);
});

// Get single mapping
router.get('/:id', (req: any, res: any) => {
  const db = getDb();
  const mapping = db.prepare('SELECT * FROM match_mappings WHERE id = ?').get(req.params.id);
  if (!mapping) return res.status(404).json({ error: 'Mapping not found' });
  res.json(mapping);
});

// Create mapping
router.post('/', (req: any, res: any) => {
  const db = getDb();
  const { polymarketMarketId, kalshiMarketId, label, confidence = 100 } = req.body;

  if (!polymarketMarketId || !kalshiMarketId || !label) {
    return res.status(400).json({ error: 'polymarketMarketId, kalshiMarketId, and label are required' });
  }

  const id = uuid();
  try {
    db.prepare(`
      INSERT INTO match_mappings (id, polymarket_market_id, kalshi_market_id, label, confidence, enabled)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(id, polymarketMarketId, kalshiMarketId, label, confidence);

    const mapping = db.prepare('SELECT * FROM match_mappings WHERE id = ?').get(id);
    res.status(201).json(mapping);
  } catch (err: any) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Mapping already exists for this pair' });
    }
    throw err;
  }
});

// Update mapping
router.put('/:id', (req: any, res: any) => {
  const db = getDb();
  const { label, confidence, enabled } = req.body;
  const id = req.params.id;

  const existing = db.prepare('SELECT * FROM match_mappings WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Mapping not found' });

  db.prepare(`
    UPDATE match_mappings SET
      label = COALESCE(?, label),
      confidence = COALESCE(?, confidence),
      enabled = COALESCE(?, enabled),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(label ?? null, confidence ?? null, enabled ?? null, id);

  const updated = db.prepare('SELECT * FROM match_mappings WHERE id = ?').get(id);
  res.json(updated);
});

// Delete mapping
router.delete('/:id', (req: any, res: any) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM match_mappings WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Mapping not found' });
  res.json({ deleted: true });
});

// Toggle mapping enabled/disabled
router.post('/:id/toggle', (req: any, res: any) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM match_mappings WHERE id = ?').get(req.params.id) as any;
  if (!existing) return res.status(404).json({ error: 'Mapping not found' });

  db.prepare('UPDATE match_mappings SET enabled = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(existing.enabled ? 0 : 1, req.params.id);

  const updated = db.prepare('SELECT * FROM match_mappings WHERE id = ?').get(req.params.id);
  res.json(updated);
});

export default router;
