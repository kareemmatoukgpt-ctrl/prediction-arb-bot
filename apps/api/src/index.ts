import dotenv = require('dotenv');
dotenv.config();

import express = require('express');
import cors = require('cors');
import { getDb, closeDb } from './db/schema';
import { startIngestion, stopIngestion } from './services/ingestion';
import { startArbScanner, stopArbScanner } from './services/arb-engine';
import mappingsRouter from './routes/mappings';
import marketsRouter from './routes/markets';
import opportunitiesRouter from './routes/opportunities';
import paperTradesRouter from './routes/paper-trades';
import demoRouter from './routes/demo';

const app = express();
const PORT = parseInt(process.env.API_PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// Routes
app.use('/api/mappings', mappingsRouter);
app.use('/api/markets', marketsRouter);
app.use('/api/opportunities', opportunitiesRouter);
app.use('/api/paper-trades', paperTradesRouter);
app.use('/api/demo', demoRouter);

// Initialize database
getDb();

// Start server
const server = app.listen(PORT, () => {
  console.log(`[api] Server running on http://localhost:${PORT}`);

  // Start background services
  startIngestion();
  startArbScanner();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[api] Shutting down...');
  stopIngestion();
  stopArbScanner();
  server.close();
  closeDb();
});

process.on('SIGINT', () => {
  console.log('[api] Shutting down...');
  stopIngestion();
  stopArbScanner();
  server.close();
  closeDb();
  process.exit(0);
});

export default app;
