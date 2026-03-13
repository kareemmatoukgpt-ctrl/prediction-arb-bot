import express = require('express');
import { getDb } from '../db/schema';
import { scanForArbs } from '../services/arb-engine';

const router = express.Router();

// List recent arb opportunities
router.get('/', (req: any, res: any) => {
  const db = getDb();
  const limit = parseInt(req.query.limit as string || '50', 10);
  const minEdgeBps = parseInt(req.query.minEdgeBps as string || '0', 10);
  const direction = req.query.direction as string | undefined;

  let query = `
    SELECT ao.*, mm.label as mapping_label,
           mm.polymarket_market_id, mm.kalshi_market_id,
           mm.mapping_kind
    FROM arb_opportunities ao
    JOIN match_mappings mm ON mm.id = ao.mapping_id
    WHERE ao.expected_profit_bps >= ?
  `;
  const params: any[] = [minEdgeBps];

  if (direction) {
    query += ' AND ao.direction = ?';
    params.push(direction);
  }

  query += ' ORDER BY ao.ts DESC LIMIT ?';
  params.push(limit);

  const opportunities = db.prepare(query).all(...params);
  res.json(opportunities);
});

// Force a new arb scan
router.post('/scan', (_req: any, res: any) => {
  try {
    const result = scanForArbs();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Scan failed' });
  }
});

// Get a single opportunity with full details
router.get('/:id', (req: any, res: any) => {
  const db = getDb();
  const opp = db.prepare(`
    SELECT ao.*, mm.label as mapping_label,
           mm.polymarket_market_id, mm.kalshi_market_id,
           mm.mapping_kind
    FROM arb_opportunities ao
    JOIN match_mappings mm ON mm.id = ao.mapping_id
    WHERE ao.id = ?
  `).get(req.params.id);

  if (!opp) return res.status(404).json({ error: 'Opportunity not found' });
  res.json(opp);
});

export default router;
