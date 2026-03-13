# DEBUG_LIVE — Live Exchange Verification

## Root Cause: pmxtjs sidecar cannot start on Node 18+

The original implementation used `pmxtjs` which spawns a `pmxt-core` sidecar.
That sidecar crashes with `ERR_REQUIRE_ESM` on all Node versions because
`@polymarket/clob-client` (a dependency of pmxt-core) is an ESM-only package,
and pmxt-core uses `require()` (CJS) to load it.

```
Error [ERR_REQUIRE_ESM]: require() of ES Module
  .../node_modules/@polymarket/clob-client/dist/index.js
  from .../pmxt-core/dist/exchanges/polymarket/auth.js not supported.
```

This means `EXCHANGE_MODE=live` always crashed with pmxtjs — it was effectively
always running mock data, even if `EXCHANGE_MODE=live` was set.

## Decision rule

| Evidence | Verdict |
|----------|---------|
| Market IDs contain `pm-mock-` or `kalshi-mock-` | NOT live |
| Logs contain `using mock data` | NOT live |
| `verify:live` exits 0 and shows real % prices | LIVE |

## Fix: Direct REST API clients (no sidecar)

Exchange service was rewritten to call public REST APIs directly:

| Venue | Endpoint | Auth |
|-------|----------|------|
| Polymarket markets | `https://gamma-api.polymarket.com/markets?enableOrderBook=true` | None |
| Polymarket orderbook | `https://clob.polymarket.com/book?token_id=TOKEN_ID` | None |
| Kalshi markets+prices | `https://api.elections.kalshi.com/trade-api/v2/markets` | None |

Kalshi embeds `yes_ask_dollars` / `no_ask_dollars` directly in the market object —
no separate orderbook call needed.

## Verified output — `npm run verify:live` (2026-03-13)

```
=== verify:live — checking real exchange data ===

  [PASS] Polymarket: market="Will the Fed decrease interest rates by 50+ bps af" yesAsk=0.2% noAsk=99.9%
  [PASS] Kalshi: market="yes Phoenix,yes Sam Houston,yes Nebraska" yesAsk=0.0% noAsk=100.0%

=== LIVE MODE VERIFIED — real data confirmed ===
```

## Verified output — `npm run smoke:live` (2026-03-13)

```
=== Smoke Test: Live Exchange Connectivity (direct REST) ===

[Polymarket] Fetching markets...
  Found 3 markets

  Market: "Will the Fed decrease interest rates by 50+ bps after the March 2026 meeting?"
  conditionId: 0xdeb615a52cd114e5aa27d8344ae506a72bea81f6ed13f5915f050b615a193c20
  YES token: 4655345557056451...
  NO  token: 4845807501995709...
  YES ask: 0.2%  |  NO ask: 99.9%
  Combined cost: 100.1% (no arb)

[Kalshi] Fetching markets...
  Found 3 markets

  Market: "yes Phoenix,yes Sam Houston,yes Nebraska"
  ticker: KXMVESPORTSMULTIGAMEEXTENDED-S202608C02B968FB-96A42653FCC
  YES ask: 0.0%  |  NO ask: 100.0%
  Combined cost: 100.0% (no arb)

=== Smoke test PASSED ===
```

## API endpoint notes

### Polymarket Gamma API — `clobTokenIds` is a JSON string

The Gamma API returns `clobTokenIds` as a **JSON-encoded string**, not an array:

```json
"clobTokenIds": "[\"51135...\", \"81473...\"]"
```

The exchange service parses this with `JSON.parse()` before use.
Markets are filtered to `enableOrderBook=true` and sorted by `liquidityClob` descending
to ensure only active CLOB markets are returned.

### Kalshi — single market endpoint

`GET /trade-api/v2/markets/{ticker}` returns the market wrapped in `{ market: {...} }`.
Price fields: `yes_ask`, `yes_bid`, `no_ask`, `no_bid` (plain decimals, e.g. `0.54`).
Some older markets use `yes_ask_dollars` / `no_ask_dollars` — both field names are handled.

### Kalshi — base URL

Kalshi moved their API. The correct base URL is:
```
https://api.elections.kalshi.com/trade-api/v2
```
(Not `https://trading-api.kalshi.com/trade-api/v2` — that redirects.)
