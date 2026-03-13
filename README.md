# Prediction Arb Bot

Cross-venue prediction market arbitrage detection system for Polymarket and Kalshi.

**V1: Paper Trading Only** — no live orders are placed.

## What It Does

1. Ingests market data and orderbooks from Polymarket and Kalshi via [pmxt](https://github.com/pmxt-dev/pmxt)
2. Matches equivalent markets across venues (manual allowlist)
3. Detects arbitrage when: `YES_price_A + NO_price_B < 1 - fees - buffer`
4. Provides a web dashboard to view opportunities and run paper trades
5. Simulates execution with configurable latency, slippage, and fill models

## Quick Start

```bash
npm install
cp .env.example .env

# Terminal 1: API server
npm run dev:api

# Terminal 2: Web dashboard
npm run dev:web
```

Open http://localhost:3000

## Project Structure

```
prediction-arb-bot/
  apps/
    api/        # Express API: ingestion, arb engine, paper trading
    web/        # Next.js dashboard
  packages/
    core/       # Shared types, arb math, simulation logic
  infra/        # Docker configs
  docs/         # SPEC.md, RUNBOOK.md, RISK.md
```

## Docker

```bash
cd infra && docker-compose up --build
```

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Frontend**: Next.js 14 (App Router)
- **Database**: SQLite (via better-sqlite3)
- **Exchange Connectivity**: pmxt
- **Monorepo**: npm workspaces

## Docs

- [Technical Spec](docs/SPEC.md)
- [Runbook](docs/RUNBOOK.md)
- [Risk Disclosure](docs/RISK.md)
