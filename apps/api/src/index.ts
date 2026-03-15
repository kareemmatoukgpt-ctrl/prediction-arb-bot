import dotenv = require('dotenv');
dotenv.config();

import express = require('express');
import cors = require('cors');
import { getDb, closeDb } from './db/schema';
import { startIngestion, stopIngestion } from './services/ingestion';
// Arb scanning is now chained after orderbook refresh in ingestion.ts
import { testExchangeConnectivity } from './services/exchange';
import mappingsRouter from './routes/mappings';
import marketsRouter from './routes/markets';
import opportunitiesRouter from './routes/opportunities';
import paperTradesRouter from './routes/paper-trades';
import demoRouter from './routes/demo';
import suggestionsRouter from './routes/suggestions';
import feedRouter from './routes/feed';

const app = express();
const PORT = parseInt(process.env.API_PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ts: new Date().toISOString(),
    exchangeMode: process.env.EXCHANGE_MODE || 'live',
  });
});

// Debug: show token IDs per mapping (useful to verify live data is loaded)
app.get('/api/debug/mappings', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      mm.id, mm.label, mm.enabled,
      pm.venue_market_id  AS pm_market_id,
      pm.yes_token_id     AS pm_yes_token,
      pm.no_token_id      AS pm_no_token,
      k.venue_market_id   AS k_market_id,
      k.yes_token_id      AS k_yes_token,
      k.no_token_id       AS k_no_token
    FROM match_mappings mm
    JOIN canonical_markets pm ON mm.polymarket_market_id = pm.venue_market_id AND pm.venue = 'POLYMARKET'
    JOIN canonical_markets k  ON mm.kalshi_market_id    = k.venue_market_id  AND k.venue  = 'KALSHI'
    ORDER BY mm.id
  `).all();
  res.json({ exchangeMode: process.env.EXCHANGE_MODE || 'live', mappings: rows });
});

// Routes
app.use('/api/mappings', mappingsRouter);
app.use('/api/markets', marketsRouter);
app.use('/api/opportunities', opportunitiesRouter);
app.use('/api/paper-trades', paperTradesRouter);
app.use('/api/demo', demoRouter);
app.use('/api/suggestions', suggestionsRouter);
app.use('/api/feed', feedRouter);

// Initialize database
getDb();

// Start server
const exchangeMode = process.env.EXCHANGE_MODE || 'live';
console.log(`[api] Exchange mode: ${exchangeMode}`);

const server = app.listen(PORT, () => {
  console.log(`[api] Server running on http://localhost:${PORT}`);

  // Eagerly test exchange connectivity — fail fast in live mode
  testExchangeConnectivity()
    .then(() => {
      console.log('[api] Exchange connectivity OK');
    })
    .catch((err) => {
      console.error('[api] Exchange connectivity FAILED:', err.message);
      if (exchangeMode === 'live') {
        console.error('[api] Exiting — set EXCHANGE_MODE=mock for development');
        process.exit(1);
      }
    });

  // Start background services (arb scanning is chained after orderbook refresh)
  startIngestion();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[api] Shutting down...');
  stopIngestion();
  // cleanup timer is stopped via stopIngestion()
  server.close();
  closeDb();
});

process.on('SIGINT', () => {
  console.log('[api] Shutting down...');
  stopIngestion();
  // cleanup timer is stopped via stopIngestion()
  server.close();
  closeDb();
  process.exit(0);
});

export default app;
