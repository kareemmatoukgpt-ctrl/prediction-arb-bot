import express = require('express');
import { executePaperTrade, getPaperTrades, getPaperTradingStats } from '../services/paper-trading';

const router = express.Router();

// List paper trades
router.get('/', (req: any, res: any) => {
  const limit = parseInt(req.query.limit as string || '50', 10);
  const trades = getPaperTrades(limit);
  res.json(trades);
});

// Get paper trading stats
router.get('/stats', (_req: any, res: any) => {
  const stats = getPaperTradingStats();
  res.json(stats);
});

// Execute a paper trade for an opportunity
router.post('/execute', (req: any, res: any) => {
  const { opportunityId } = req.body;
  if (!opportunityId) {
    return res.status(400).json({ error: 'opportunityId is required' });
  }

  try {
    const result = executePaperTrade(opportunityId);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
