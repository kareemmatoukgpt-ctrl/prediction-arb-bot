# Changelog

## v1.1.0 — Live Exchange Data + Arb Improvements (2026-03-13)

### Changed
- **Exchange service**: replaced dynamic `import('pmxtjs')` with static named import; added `EXCHANGE_MODE=live|mock` env var (default: `live`) — live mode fails fast if pmxt is unreachable instead of silently falling back to mock data
- **Binary orderbooks**: fetch both YES and NO orderbooks per venue per mapping (was only fetching YES side, hardcoding NO as null). Uses `fetchBinaryOrderbook()` with `Promise.all` for parallel fetches
- **Ingestion**: validates all 4 token IDs (PM yes/no, Kalshi yes/no) before fetching orderbooks; selects Kalshi token IDs from DB (was missing)
- **Cost model**: split conflated `bufferBps` into 4 separate params — `arbThresholdBps`, `slippageBps`, `polymarketTakerFeeBps`, `kalshiTakerFeeBps`. New formula: `totalCost = yesAsk*(1+fee+slippage) + noAsk*(1+fee+slippage)`; arb requires profit > threshold
- **Arb dedupe**: unique index on `(mapping_id, direction)` with upsert — at most 1 opportunity row per mapping+direction. Stale opportunities auto-deleted each scan cycle. Hourly cleanup removes rows older than 7 days

### Added
- `npm run smoke:live` — standalone connectivity test that fetches markets + orderbooks from both exchanges and prints normalized quotes
- Startup connectivity check — API exits immediately in live mode if pmxt is unreachable
- `EXCHANGE_MODE`, `ARB_THRESHOLD_BPS`, `SLIPPAGE_BPS`, `PM_TAKER_FEE_BPS`, `KALSHI_TAKER_FEE_BPS` env vars

### Removed
- `BUFFER_BPS` env var (replaced by `ARB_THRESHOLD_BPS` + `SLIPPAGE_BPS`)

---

## v1.0.0 — V1 Scaffold (2026-03-13)

### Added
- **packages/core**: Shared TypeScript library
  - `types.ts`: All domain types (CanonicalMarket, OrderbookSnapshot, MatchMapping, ArbOpportunity, PaperTrade)
  - `arb-math.ts`: `detectArb()`, `checkArbDirection()`, `estimateAllInCost()`, cost model with configurable fee/slippage/buffer knobs
  - `paper-sim.ts`: `simulateExecution()` with configurable latency, slippage model, and fill simulation

- **apps/api**: Express + TypeScript backend
  - SQLite schema (5 tables: canonical_markets, orderbook_snapshots, match_mappings, arb_opportunities, paper_trades)
  - Exchange service: pmxt wrapper for Polymarket + Kalshi with automatic mock data fallback
  - Ingestion service: market refresh (10min) + orderbook polling (5sec) for mapped markets only
  - Arb engine: scans all enabled mappings for both directions on each orderbook update
  - Paper trading: simulates execution with latency/slippage/fill model, persists results
  - REST API: CRUD for mappings, market lookup, opportunity scanning, paper trade execution

- **apps/web**: Next.js 13 dashboard
  - `/` — Dashboard with summary stats and recent opportunities
  - `/mappings` — Add/edit/toggle/delete market mappings
  - `/opportunities` — Live arb feed with "Simulate Execute" button
  - `/paper` — Paper trade history and cumulative PnL stats

- **infra**: `docker-compose.yml` + `Dockerfile.api` + `Dockerfile.web`

- **docs**: `SPEC.md`, `RUNBOOK.md`, `RISK.md`, `.env.example`, `README.md`

### Notes
- V1 is paper trading only — no live order execution
- pmxt sidecar requires `pmxt-core` globally installed for real data; falls back to mock data in dev
- Node.js 18.16+ required (Next.js pinned to 13.5.6 for 18.x compatibility)
