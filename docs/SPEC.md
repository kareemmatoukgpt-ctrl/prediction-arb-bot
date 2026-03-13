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
4. **Orderbook model**: For each mapped market, fetch **both YES and NO orderbooks** per venue (binary markets have 2 separate outcomes with independent orderbooks)
5. **Detection condition**: `profit_per_unit > arb_threshold`
6. **Paper Simulator** models execution with configurable latency, slippage, and fill rates

## Cost Model

```
yes_all_in = yes_ask * (1 + venue_taker_fee + slippage)
no_all_in  = no_ask  * (1 + venue_taker_fee + slippage)
total_cost = yes_all_in + no_all_in

profit     = 1.0 - total_cost
arb_exists = profit > arb_threshold
profit_usd = profit * size_usd
```

Parameters (all configurable via env):
- `ARB_THRESHOLD_BPS` — minimum edge to flag as arb (default: 50)
- `SLIPPAGE_BPS` — expected execution slippage per side (default: 10)
- `PM_TAKER_FEE_BPS` — Polymarket taker fee (default: 0)
- `KALSHI_TAKER_FEE_BPS` — Kalshi taker fee (default: 0)

## Exchange Mode

`EXCHANGE_MODE=live|mock` (default: `live`)
- **live**: connects to Polymarket and Kalshi via pmxt sidecar. Fails fast if unreachable.
- **mock**: returns fake data. Use for development/CI.

## V1 Constraints

- Paper trading only — no live execution
- Manual market mapping (no auto-matching)
- SQLite database (swappable to Postgres)
- Polling-based ingestion (WebSocket in V2)
