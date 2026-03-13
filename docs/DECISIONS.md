# Architecture Decisions

## V2 Crypto Auto-Mapping

### D1: Polymarket Gamma API `q=` parameter does not filter by keyword

**Date**: 2026-03-14

**Observed**: When fetching from `gamma-api.polymarket.com/markets?q=bitcoin+above&enableOrderBook=true`, the API returns top-liquidity CLOB markets regardless of the `q=` value. Queries for `q=bitcoin above`, `q=above`, `q=Fed rates` all return the same set of high-liquidity markets (Fed, Iran, soccer, etc.) with only 1 BTC price market in the top 100.

**Raw evidence**:
```
q=bitcoin above (100 results) → 1 market with crypto mention: "Will Bitcoin reach $150,000 in March?"
tag=Crypto → returns "BitBoy convicted?" (celebrity market)
tag=Bitcoin → returns "BitBoy convicted?"
```

**Root cause**: Polymarket's CLOB market category (`enableOrderBook=true`) simply doesn't have many active BTC/ETH price range markets. They have monthly/quarterly targets ("Will BTC reach $X by month Y?") but not the granular hourly price ranges that Kalshi's KXBTC series provides.

**Decision**: Accept this data reality. The Markets Explorer will show:
- 330+ Kalshi KXBTC markets with full structured data (threshold, expiry, direction)
- 1–few Polymarket BTC price CLOB markets currently active

The system is architecturally correct. When Polymarket lists more BTC price prediction CLOB markets, they will be discovered automatically on the next `ingest:crypto` run.

**Future improvement**: Consider fetching Polymarket markets without `enableOrderBook=true` for the explorer view (to show more PM markets), while keeping the CLOB requirement for creating active mappings.

---

### D2: Kalshi `floor_strike` field used directly for predicate_threshold

Kalshi market objects contain `floor_strike: 81249.99` (a numeric float, already precise). No parsing needed. The `subtitle` field ("$81,250 or above") is used for direction detection (metadata-first), with ticker `-T{n}` as a fallback.

**Verified format**:
```json
{ "ticker": "KXBTC-26MAR1417-T81249.99", "floor_strike": 81249.99, "subtitle": "$81,250 or above" }
```

---

### D3: Arb-eligible bucket requires expiry ≤ 4h

The 4-hour threshold was chosen to prevent fake mappings between Kalshi's hourly markets and Polymarket's monthly markets. A pair with expiry delta = 30 days is NOT an arb — they're different contracts entirely. Only `arb_eligible` suggestions can be approved into active `match_mappings`.

**Implication**: With current data (Kalshi hourly KXBTC vs Polymarket monthly BTC), `arb_eligible` suggestions will be 0 until Polymarket lists near-term BTC price markets. This is correct behavior, not a bug.

---

### D4: Polymarket threshold regex handles decimals and suffix notation

Pattern: `\$?(\d[\d,]*\.?\d*)\s*(k|m|b)?`

Handles:
- `$85,000` → 85000
- `$85k` → 85000
- `$81,249.99` → 81249.99
- `81.25k` → 81250
- `$1.2m` → 1200000

Price range guard: only values between 100 and 10,000,000 are accepted as valid crypto price thresholds (filters out things like "100 BPS" or "$1B volume").

---

### D5: Suggestion ON CONFLICT only updates `suggested` rows

The upsert for `mapping_suggestions` uses:
```sql
ON CONFLICT DO UPDATE ... WHERE status = 'suggested'
```

This means: once a user approves or rejects a suggestion, re-running `generateSuggestions` will NOT overwrite that status. Approved/rejected suggestions are permanent (the user explicitly acted on them). Only pending `suggested` rows get refreshed with new scores.
