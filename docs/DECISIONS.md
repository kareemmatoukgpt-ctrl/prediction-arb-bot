# Architecture Decisions

## V2 Crypto Auto-Mapping

### D1: Polymarket Gamma API `q=` parameter does not filter by keyword

**Date**: 2026-03-14

**Observed**: The `q=` parameter on both `/markets` and `/events` endpoints has ZERO filtering effect. Verified by comparing identical results for `q=bitcoin`, `q=dogecoin`, and `q=xyznonexistent123`. Tag-based (`tag=Crypto`) filtering is equally non-functional.

**Solution (V2.1)**: Paginate ALL open markets (`/markets?closed=false&active=true&limit=100&offset=N`) and filter client-side using asset/threshold regex. ~10,100 open markets → 100+ pages → finds **99+ crypto price-threshold markets** across BTC, ETH, SOL, XRP, DOGE, ENA.

**Scan time**: ~30-60 seconds for full pagination. Acceptable for manual "Ingest Crypto" clicks and 10-minute background refresh.

**Crypto market types found on Polymarket**:
- "Will Bitcoin hit $150k by March 31?" — TOUCH_BY (resolves via Binance 1m candle high)
- "Will Bitcoin reach $X by Dec 31?" — TOUCH_BY (many thresholds: $80k-$250k)
- "Will Bitcoin dip to $X by Dec 31?" — TOUCH_BY, direction=BELOW
- ETH/SOL/XRP/DOGE/ENA variants of the above

---

### D2: Kalshi `floor_strike` field used directly for predicate_threshold

Kalshi market objects contain `floor_strike: 81249.99` (a numeric float, already precise). No parsing needed. The `subtitle` field ("$81,250 or above") is used for direction detection (metadata-first), with ticker `-T{n}` as a fallback.

**Verified format**:
```json
{ "ticker": "KXBTC-26MAR1417-T81249.99", "floor_strike": 81249.99, "subtitle": "$81,250 or above" }
```

---

### D3: Arb-eligible bucket gates by predicate_type + expiry

**V2.1 Update**: The expiry gate is now type-dependent:
- **CLOSE_AT**: both must expire within 4h (contracts must settle at the same time)
- **TOUCH_BY**: within 24h is acceptable (both "touch by" a similar deadline)

Additionally, arb-eligible requires all of: same asset, same predicate_type, same direction, threshold ≤1%, expiry within type-specific window.

**Implication**: With current data, PM is entirely TOUCH_BY ("hit $X by date"), Kalshi KXBTCD is CLOSE_AT ("price at close"). These are fundamentally different contracts — PM resolves if price EVER touches the target, Kalshi resolves on the price AT a specific time. This means type mismatch blocks arb_eligible even when asset/threshold/direction match. This is correct behavior.

### D3b: Kalshi KXBTCD series (threshold markets)

**Date**: 2026-03-14

**Discovered**: Kalshi has `KXBTCD` (and `KXETHD`, `KXSOLD`) series alongside the original `KXBTC` bracket series.

| Series | Style | Example subtitle | Use for matching |
|--------|-------|-----------------|------------------|
| KXBTC | Bracket/range ("between $X and $Y") | "$64,250 to $64,749.99" | Not ideal — no clear direction |
| KXBTCD | Threshold/directional ("above $X") | "$78,250 or above" | Structurally best for PM matching |

KXBTCD markets have the same hourly resolution as KXBTC (max ~6 days out). Both use CF Benchmarks BRTI 60-second average.

### D3c: TOUCH_BY vs CLOSE_AT — the fundamental cross-venue gap for crypto

**Date**: 2026-03-14

**Analysis**: After scanning all PM and Kalshi crypto markets:
- PM: 100% of crypto price markets are TOUCH_BY (resolve via Binance 1m candle high touching target)
- Kalshi KXBTCD: 100% are CLOSE_AT (resolve on price at a specific hourly close time)

These are NOT the same contract. Example:
- BTC at $79k, both markets for "$80,000 or above"
- If BTC briefly spikes to $80.1k then drops to $78k before close:
  - PM TOUCH_BY: resolves YES (price touched $80k)
  - Kalshi CLOSE_AT: resolves NO (price at close was $78k)

**Decision**: Do NOT fake arb-eligible matches between TOUCH_BY and CLOSE_AT. The Discovery tab shows closest comparable pairs with clear explanations of why they're not arb-eligible.

**When this changes**: If either venue adds contracts matching the other's type (PM adds close-at-time, or Kalshi adds touch-by-date), arb-eligible suggestions will appear automatically on the next generate run.

---

### D4: Polymarket threshold regex handles decimals and suffix notation

Pattern: `\$?(\d[\d,]*\.?\d*)\s*(k|m|b)?`

Handles:
- `$85,000` → 85000
- `$85k` → 85000
- `$81,249.99` → 81249.99
- `81.25k` → 81250
- `$1.2m` → 1200000

Price range guard: values between 0.01 and 10,000,000 are accepted (lowered from 100 to support DOGE/XRP sub-dollar prices).

---

### D5: Suggestion ON CONFLICT only updates `suggested` rows

The upsert for `mapping_suggestions` uses:
```sql
ON CONFLICT DO UPDATE ... WHERE status = 'suggested'
```

This means: once a user approves or rejects a suggestion, re-running `generateSuggestions` will NOT overwrite that status. Approved/rejected suggestions are permanent (the user explicitly acted on them). Only pending `suggested` rows get refreshed with new scores.
