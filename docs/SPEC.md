# Prediction Arb Bot — Technical Specification

## Overview

Cross-venue prediction market arbitrage bot that detects price discrepancies between
Polymarket and Kalshi for identical binary outcomes.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────┐
│  Polymarket  │     │   Kalshi    │     │  Next.js UI  │
│  (via pmxt)  │     │  (via pmxt) │     │  :3000       │
└──────┬───────┘     └──────┬──────┘     └──────┬───────┘
       │                    │                    │
       ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────┐
│                   API Server (:3001)                     │
│  ┌──────────┐  ┌───────────┐  ┌────────────────────┐   │
│  │Ingestion │  │Arb Engine │  │Paper Trade Simulator│   │
│  └──────────┘  └───────────┘  └────────────────────┘   │
│                        │                                 │
│                  ┌─────▼─────┐                          │
│                  │  SQLite   │                          │
│                  └───────────┘                          │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Ingestion** polls both venues for market data and orderbook snapshots
2. **Matching** uses a manual allowlist of equivalent markets across venues
3. **Arb Engine** evaluates both directions of each mapping for arbitrage:
   - Buy YES on Polymarket + Buy NO on Kalshi
   - Buy NO on Polymarket + Buy YES on Kalshi
4. **Detection condition**: `total_cost_per_unit < 1 - buffer`
5. **Paper Simulator** models execution with configurable latency, slippage, and fill rates

## Cost Model

```
total_cost = yes_ask + no_ask + taker_fees + slippage_buffer
arb_exists = total_cost < 1.0 (payout for binary)
profit = (1.0 - total_cost) * size_usd
```

## V1 Constraints

- Paper trading only — no live execution
- Manual market mapping (no auto-matching)
- SQLite database (swappable to Postgres)
- Polling-based ingestion (WebSocket in V2)
