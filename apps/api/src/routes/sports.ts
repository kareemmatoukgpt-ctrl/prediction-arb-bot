import express = require('express');
import { getDb } from '../db/schema';
import {
  refreshSportsMarkets,
} from '../services/sports/sports-ingestion';
import { scanSportsArbs } from '../services/sports/sports-arb-engine';

const router = express.Router();

// GET /api/sports/events — upcoming games
router.get('/events', (req: any, res: any) => {
  const db = getDb();
  const sport = req.query.sport as string | undefined;
  const league = req.query.league as string | undefined;
  const date = req.query.date as string | undefined;
  const limit = parseInt(req.query.limit as string || '50', 10);

  let query = `
    SELECT
      e.*,
      COUNT(DISTINCT CASE WHEN sm.venue = 'POLYMARKET' THEN sm.id END) as pm_markets,
      COUNT(DISTINCT CASE WHEN sm.venue = 'KALSHI' THEN sm.id END) as kalshi_markets,
      COUNT(DISTINCT sm.id) as total_markets
    FROM sports_events e
    LEFT JOIN sports_markets sm ON sm.event_id = e.id
    WHERE e.status = 'upcoming'
  `;
  const params: any[] = [];

  if (sport) {
    query += ' AND e.sport = ?';
    params.push(sport.toUpperCase());
  }
  if (league) {
    query += ' AND e.league = ?';
    params.push(league);
  }
  if (date) {
    // Filter by date (YYYY-MM-DD) — convert to unix timestamp range
    const dayStart = Math.floor(new Date(date + 'T00:00:00Z').getTime() / 1000);
    const dayEnd = dayStart + 86400;
    query += ' AND e.start_time >= ? AND e.start_time < ?';
    params.push(dayStart, dayEnd);
  }

  query += ' GROUP BY e.id ORDER BY e.start_time ASC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/sports/events/:id — single game with all venue odds
router.get('/events/:id', (req: any, res: any) => {
  const db = getDb();
  const event = db.prepare('SELECT * FROM sports_events WHERE id = ?').get(req.params.id) as any;
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const markets = db.prepare(`
    SELECT * FROM sports_markets WHERE event_id = ? ORDER BY bet_type, venue, side
  `).all(req.params.id) as any[];

  // Group by bet_type
  const grouped: Record<string, any[]> = {};
  for (const m of markets) {
    if (!grouped[m.bet_type]) grouped[m.bet_type] = [];
    grouped[m.bet_type].push(m);
  }

  // Find arbs for this event
  const arbs = db.prepare(`
    SELECT * FROM sports_arbs WHERE event_id = ? AND status = 'active' ORDER BY edge_bps DESC
  `).all(req.params.id) as any[];

  res.json({ event, markets: grouped, arbs });
});

// GET /api/sports/arbs — active arb opportunities
router.get('/arbs', (req: any, res: any) => {
  const db = getDb();
  const sport = req.query.sport as string | undefined;
  const betType = req.query.bet_type as string | undefined;
  const minEdge = parseInt(req.query.min_edge as string || '0', 10);
  const limit = parseInt(req.query.limit as string || '50', 10);

  let query = `
    SELECT
      a.*,
      e.sport, e.league, e.home_team, e.away_team, e.start_time as event_start_time,
      ma.question as question_a, ma.url as url_a, ma.venue as venue_a_check,
      mb.question as question_b, mb.url as url_b, mb.venue as venue_b_check
    FROM sports_arbs a
    CROSS JOIN sports_events e ON e.id = a.event_id
    LEFT JOIN sports_markets ma ON ma.id = a.market_a_id
    LEFT JOIN sports_markets mb ON mb.id = a.market_b_id
    WHERE a.status = 'active'
  `;
  const params: any[] = [];

  if (sport) {
    query += ' AND e.sport = ?';
    params.push(sport.toUpperCase());
  }
  if (betType) {
    query += ' AND a.bet_type = ?';
    params.push(betType.toUpperCase());
  }
  if (minEdge > 0) {
    query += ' AND a.edge_bps >= ?';
    params.push(minEdge);
  }

  query += ' ORDER BY a.edge_bps DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET /api/sports/arbs/:id — single arb detail
router.get('/arbs/:id', (req: any, res: any) => {
  const db = getDb();
  const arb = db.prepare(`
    SELECT
      a.*,
      e.sport, e.league, e.home_team, e.away_team, e.start_time as event_start_time,
      ma.question as question_a, ma.url as url_a, ma.yes_price as current_price_a,
      mb.question as question_b, mb.url as url_b, mb.yes_price as current_price_b
    FROM sports_arbs a
    CROSS JOIN sports_events e ON e.id = a.event_id
    LEFT JOIN sports_markets ma ON ma.id = a.market_a_id
    LEFT JOIN sports_markets mb ON mb.id = a.market_b_id
    WHERE a.id = ?
  `).get(req.params.id) as any;

  if (!arb) return res.status(404).json({ error: 'Arb not found' });
  res.json(arb);
});

// GET /api/sports/stats — summary dashboard data
router.get('/stats', (_req: any, res: any) => {
  const db = getDb();

  const totalArbs = (db.prepare(
    "SELECT COUNT(*) as cnt FROM sports_arbs WHERE status = 'active'",
  ).get() as any).cnt;

  const totalEvents = (db.prepare(
    "SELECT COUNT(*) as cnt FROM sports_events WHERE status = 'upcoming'",
  ).get() as any).cnt;

  const totalMarkets = (db.prepare(
    'SELECT COUNT(*) as cnt FROM sports_markets',
  ).get() as any).cnt;

  const bySport = db.prepare(`
    SELECT e.sport, COUNT(DISTINCT a.id) as arbs, COUNT(DISTINCT e.id) as events
    FROM sports_events e
    LEFT JOIN sports_arbs a ON a.event_id = e.id AND a.status = 'active'
    WHERE e.status = 'upcoming'
    GROUP BY e.sport
    ORDER BY arbs DESC
  `).all() as any[];

  const byVenue = db.prepare(`
    SELECT venue, COUNT(*) as count FROM sports_markets GROUP BY venue
  `).all() as any[];

  const edgeStats = db.prepare(`
    SELECT MAX(edge_bps) as best_edge_bps, AVG(edge_bps) as avg_edge_bps
    FROM sports_arbs WHERE status = 'active'
  `).get() as any;

  const totalProfitUsd = (db.prepare(
    "SELECT COALESCE(SUM(profit_usd), 0) as total FROM sports_arbs WHERE status = 'active'",
  ).get() as any).total;

  res.json({
    total_arbs: totalArbs,
    total_events: totalEvents,
    total_markets: totalMarkets,
    total_profit_usd: totalProfitUsd,
    by_sport: bySport,
    by_venue: byVenue,
    best_edge_bps: edgeStats?.best_edge_bps || 0,
    avg_edge_bps: Math.round(edgeStats?.avg_edge_bps || 0),
  });
});

// POST /api/sports/refresh — force refresh
router.post('/refresh', async (_req: any, res: any) => {
  try {
    const result = await refreshSportsMarkets();
    const arbCount = scanSportsArbs();
    res.json({
      markets_refreshed: result.kalshi + result.polymarket,
      events: result.events,
      arbs_found: arbCount,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sports/health — pipeline health check
router.get('/health', (_req: any, res: any) => {
  const db = getDb();

  const kalshiStats = db.prepare(`
    SELECT COUNT(*) as markets, MAX(last_fetched) as last_fetch
    FROM sports_markets WHERE venue = 'KALSHI'
  `).get() as any;

  const pmStats = db.prepare(`
    SELECT COUNT(*) as markets, MAX(last_fetched) as last_fetch
    FROM sports_markets WHERE venue = 'POLYMARKET'
  `).get() as any;

  const eventCount = (db.prepare(
    "SELECT COUNT(*) as cnt FROM sports_events WHERE status = 'upcoming'",
  ).get() as any).cnt;

  const activeArbs = (db.prepare(
    "SELECT COUNT(*) as cnt FROM sports_arbs WHERE status = 'active'",
  ).get() as any).cnt;

  res.json({
    status: 'ok',
    venues: {
      kalshi: { markets: kalshiStats.markets, last_fetch: kalshiStats.last_fetch },
      polymarket: { markets: pmStats.markets, last_fetch: pmStats.last_fetch },
    },
    events: eventCount,
    arbs: activeArbs,
  });
});

export default router;
