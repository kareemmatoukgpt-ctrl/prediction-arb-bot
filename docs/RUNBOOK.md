# Runbook

## Requirements

- **Node.js 18.16+** (no pmxt sidecar needed — uses direct REST APIs)
- `npm install` from the project root

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/kareemmatoukgpt-ctrl/prediction-arb-bot.git
cd prediction-arb-bot
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env as needed (EXCHANGE_MODE=live is the default)

# 3. Start the API server
npm run dev:api

# 4. In another terminal, start the web dashboard
npm run dev:web

# 5. Open http://localhost:3000
```

## Confirming Live Mode

The dashboard shows a **LIVE** (green) or **MOCK** (yellow) badge in the header.

To confirm from the terminal:

```bash
npm run verify:live
```

Expected output when live:

```
=== verify:live — checking real exchange data ===

  [PASS] Polymarket: market="Will the Fed decrease..." yesAsk=0.2% noAsk=99.9%
  [PASS] Kalshi: market="..." yesAsk=54.0% noAsk=46.0%

=== LIVE MODE VERIFIED — real data confirmed ===
```

Any `[FAIL]` line means something is wrong — see Troubleshooting below.

## Docker

```bash
cd infra
docker-compose up --build
```

## Adding a Market Mapping

1. Go to http://localhost:3000/mappings
2. Click "+ Add Mapping"
3. Enter the Polymarket market ID (condition ID)
4. Enter the Kalshi market ID (ticker)
5. Give it a human-readable label
6. Click "Create Mapping"

The system will start scanning orderbooks for this pair automatically.

## Viewing Opportunities

1. Go to http://localhost:3000/opportunities
2. Set minimum edge filter if desired
3. Click "Scan Now" to force a new scan
4. Click "Simulate Execute" on any opportunity to run a paper trade

## Paper Trading

- All paper trades appear at http://localhost:3000/paper
- PnL is tracked cumulatively
- Simulation parameters are configurable via environment variables

## Exchange Mode

The `EXCHANGE_MODE` environment variable controls whether the bot connects to real exchanges:

| Mode | Behavior |
|------|----------|
| `live` (default) | Calls Polymarket + Kalshi REST APIs directly. No sidecar or credentials needed. Fails fast if both are unreachable. |
| `mock` | Uses hardcoded fake market/orderbook data. No external connections. Use this for local development or CI. |

```bash
# Development (no network required)
EXCHANGE_MODE=mock npm run dev:api

# Production / real data (default)
EXCHANGE_MODE=live npm run dev:api
```

**Note:** pmxtjs is no longer used. The bot talks directly to:
- `https://gamma-api.polymarket.com` (markets)
- `https://clob.polymarket.com` (Polymarket orderbooks)
- `https://api.elections.kalshi.com/trade-api/v2` (Kalshi markets + prices)

No API keys are required — all read endpoints are public.

## Smoke Test

Quickly verify that live exchange connectivity works:

```bash
npm run smoke:live
```

Connects to both Polymarket and Kalshi, fetches a few markets and orderbooks, prints
normalized quotes (YES ask, NO ask, combined cost), and exits non-zero on failure.

## Debug Endpoint

To inspect token IDs stored per mapping:

```bash
curl http://localhost:3001/api/debug/mappings | jq .
```

Returns exchange mode, and per-mapping: PM condition ID + YES/NO token IDs,
Kalshi ticker + YES/NO outcome IDs. Useful to verify that ingestion has populated
real token IDs from the exchanges.

## Troubleshooting

### No opportunities appearing

- Verify mappings are enabled at /mappings
- Check that both venues have valid market IDs
- The buffer (default 50 bps) may be filtering real opportunities
- Check API logs for ingestion errors
- Run `curl http://localhost:3001/api/debug/mappings | jq .` to see token IDs

### API not responding

- Verify `npm run dev:api` is running
- Check port 3001 is not in use
- Review console output for errors

### verify:live shows FAIL for Polymarket

- Polymarket returns markets sorted by `liquidityClob` — if no CLOB markets are active,
  the check returns 0 results
- Try `curl "https://gamma-api.polymarket.com/markets?active=true&closed=false&enableOrderBook=true&limit=3"` to confirm the API is reachable

### verify:live shows FAIL for Kalshi

- Kalshi's parlay markets often have `yes_ask=0` (already resolved or illiquid)
- Try a specific ticker: `curl "https://api.elections.kalshi.com/trade-api/v2/markets/KXFED-27APR-T4.25"` to confirm connectivity
- If you get a redirect, update `KALSHI_API_URL` in your `.env`

### Dashboard shows MOCK badge even with EXCHANGE_MODE=live

- The badge reads from `/health` which reports the server's env var at startup
- Restart the API server after changing `.env`
