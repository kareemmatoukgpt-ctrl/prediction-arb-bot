# Runbook

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/kareemmatoukgpt-ctrl/prediction-arb-bot.git
cd prediction-arb-bot
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env as needed

# 3. Start the API server
npm run dev:api

# 4. In another terminal, start the web dashboard
npm run dev:web

# 5. Open http://localhost:3000
```

## Docker

```bash
cd infra
docker-compose up --build
```

## Adding a Market Mapping

1. Go to http://localhost:3000/mappings
2. Click "+ Add Mapping"
3. Enter the Polymarket market ID (condition ID or slug)
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

## Troubleshooting

### No opportunities appearing
- Verify mappings are enabled at /mappings
- Check that both venues have valid market IDs
- The buffer (default 50 bps) may be filtering real opportunities
- Check API logs for ingestion errors

### API not responding
- Verify `npm run dev:api` is running
- Check port 3001 is not in use
- Review console output for errors

### pmxt connection issues
- pmxt requires Node.js for its sidecar
- If pmxt fails, the system falls back to mock data
- Check npm logs for pmxt installation issues
