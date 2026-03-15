import express = require('express');
import { getDb } from '../db/schema';

const router = express.Router();

// GET /api/feed — primary opportunity feed
router.get('/', (req: any, res: any) => {
  const db = getDb();
  const limit = parseInt(req.query.limit as string || '50', 10);
  const minEdgeBps = parseInt(req.query.minEdgeBps as string || '0', 10);
  const minProfitUsd = parseFloat(req.query.minProfitUsd as string || '0');
  const category = req.query.category as string | undefined;
  const sort = (req.query.sort as string) || 'profit_desc';
  const hideSuspect = req.query.hideSuspect !== 'false'; // default true
  const hideUnverified = req.query.hideUnverified !== 'false'; // default true

  let query = 'SELECT * FROM opportunity_feed WHERE 1=1';
  const params: any[] = [];

  if (hideSuspect) {
    query += ' AND suspect = 0';
  }

  if (hideUnverified) {
    query += " AND (mapping_kind IS NULL OR mapping_kind != 'manual_unverified')";
  }

  if (minEdgeBps > 0) {
    query += ' AND expected_profit_bps >= ?';
    params.push(minEdgeBps);
  }

  if (minProfitUsd > 0) {
    query += ' AND expected_profit_usd >= ?';
    params.push(minProfitUsd);
  }

  if (category) {
    query += ' AND category = ?';
    params.push(category.toUpperCase());
  }

  // Sort
  switch (sort) {
    case 'profit_asc':
      query += ' ORDER BY expected_profit_usd ASC';
      break;
    case 'edge_desc':
      query += ' ORDER BY expected_profit_bps DESC';
      break;
    case 'expiry_asc':
      query += ' ORDER BY expiry_ts ASC NULLS LAST';
      break;
    case 'liquidity_desc':
      query += ' ORDER BY liquidity_score DESC';
      break;
    case 'profit_desc':
    default:
      query += ' ORDER BY expected_profit_usd DESC';
      break;
  }

  query += ' LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/feed/stats — aggregate statistics
router.get('/stats', (_req: any, res: any) => {
  const db = getDb();

  const overall = db.prepare(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(expected_profit_usd), 0) as total_profit,
      MAX(expected_profit_bps) as max_edge_bps
    FROM opportunity_feed
    WHERE suspect = 0 AND (mapping_kind IS NULL OR mapping_kind != 'manual_unverified')
  `).get() as any;

  const byCategory = db.prepare(`
    SELECT
      category,
      COUNT(*) as count,
      COALESCE(SUM(expected_profit_usd), 0) as total_profit,
      MAX(expected_profit_bps) as max_edge_bps
    FROM opportunity_feed
    WHERE suspect = 0 AND (mapping_kind IS NULL OR mapping_kind != 'manual_unverified')
    GROUP BY category
    ORDER BY total_profit DESC
  `).all() as any[];

  const suspectCount = db.prepare(`
    SELECT COUNT(*) as count FROM opportunity_feed WHERE suspect = 1
  `).get() as any;

  res.json({
    totalProfit: overall.total_profit,
    count: overall.count,
    maxEdgeBps: overall.max_edge_bps,
    suspectCount: suspectCount.count,
    byCategory,
  });
});

// GET /api/feed/health — pipeline health diagnostics
router.get('/health', (_req: any, res: any) => {
  const db = getDb();

  // Markets by venue and type
  const marketsByVenue = db.prepare(`
    SELECT venue, COUNT(*) as total,
      SUM(CASE WHEN predicate_type = 'CLOSE_AT' THEN 1 ELSE 0 END) as close_at,
      SUM(CASE WHEN predicate_type = 'TOUCH_BY' THEN 1 ELSE 0 END) as touch_by,
      SUM(CASE WHEN predicate_type = 'BINARY_EVENT' THEN 1 ELSE 0 END) as binary_event,
      SUM(CASE WHEN predicate_type IS NULL THEN 1 ELSE 0 END) as no_type
    FROM canonical_markets WHERE status = 'open'
    GROUP BY venue
  `).all() as any[];

  const markets: Record<string, any> = {};
  for (const row of marketsByVenue) {
    markets[row.venue.toLowerCase()] = { total: row.total, close_at: row.close_at, touch_by: row.touch_by, binary_event: row.binary_event, no_type: row.no_type };
  }

  // Markets by category
  const marketsByCategory = db.prepare(`
    SELECT category, COUNT(*) as cnt
    FROM canonical_markets WHERE status = 'open' AND category IS NOT NULL
    GROUP BY category ORDER BY cnt DESC
  `).all() as any[];

  // Event groups with 2+ outcomes (candidates for conditional arbs)
  const eventGroupCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM (
      SELECT event_group FROM canonical_markets
      WHERE event_group IS NOT NULL AND status = 'open'
      GROUP BY venue, event_group HAVING COUNT(*) >= 2
    )
  `).get() as any;

  // Suggestions
  const suggestions = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN bucket = 'arb_eligible' THEN 1 ELSE 0 END) as arb_eligible,
      SUM(CASE WHEN bucket = 'research' THEN 1 ELSE 0 END) as research
    FROM mapping_suggestions
  `).get() as any;

  // Mappings
  const mappings = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled
    FROM match_mappings
  `).get() as any;

  const withSnapshots = db.prepare(`
    SELECT COUNT(DISTINCT m.id) as cnt
    FROM match_mappings m
    CROSS JOIN canonical_markets pm ON pm.venue = 'POLYMARKET' AND pm.venue_market_id = m.polymarket_market_id
    CROSS JOIN canonical_markets k ON k.venue = 'KALSHI' AND k.venue_market_id = m.kalshi_market_id
    WHERE m.enabled = 1
    AND EXISTS (SELECT 1 FROM orderbook_snapshots os WHERE os.market_id = pm.id)
    AND EXISTS (SELECT 1 FROM orderbook_snapshots os WHERE os.market_id = k.id)
  `).get() as any;

  // Opportunities
  const opportunities = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN suspect = 0 THEN 1 ELSE 0 END) as non_suspect,
      SUM(CASE WHEN type_risk IS NOT NULL THEN 1 ELSE 0 END) as with_type_risk
    FROM opportunity_feed
  `).get() as any;

  // Opportunities by arb type
  const oppsByArbType = db.prepare(`
    SELECT arb_type, COUNT(*) as cnt
    FROM opportunity_feed GROUP BY arb_type
  `).all() as any[];

  // Opportunities by category
  const oppsByCategory = db.prepare(`
    SELECT category, COUNT(*) as cnt, SUM(CASE WHEN suspect = 0 THEN 1 ELSE 0 END) as non_suspect
    FROM opportunity_feed GROUP BY category ORDER BY cnt DESC
  `).all() as any[];

  res.json({
    markets,
    marketsByCategory,
    eventGroups: eventGroupCount.cnt,
    suggestions: { total: suggestions.total, arb_eligible: suggestions.arb_eligible, research: suggestions.research },
    mappings: { total: mappings.total, enabled: mappings.enabled, with_snapshots: withSnapshots.cnt },
    opportunities: {
      total: opportunities.total,
      non_suspect: opportunities.non_suspect,
      with_type_risk: opportunities.with_type_risk,
      byArbType: oppsByArbType,
      byCategory: oppsByCategory,
    },
  });
});

// GET /api/feed/:id — single opportunity detail
router.get('/:id', (req: any, res: any) => {
  const db = getDb();
  const opp = db.prepare('SELECT * FROM opportunity_feed WHERE id = ?').get(req.params.id);

  if (!opp) {
    // Also try looking up by mapping_id (in case the client passes that)
    const byMapping = db.prepare('SELECT * FROM opportunity_feed WHERE mapping_id = ? LIMIT 1').get(req.params.id);
    if (!byMapping) return res.status(404).json({ error: 'Opportunity not found' });
    return res.json(byMapping);
  }

  res.json(opp);
});

export default router;
