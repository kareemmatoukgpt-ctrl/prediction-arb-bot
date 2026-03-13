/**
 * Smoke test: verify live exchange connectivity via direct REST APIs.
 * No pmxtjs/sidecar required — uses public Polymarket + Kalshi HTTP endpoints.
 *
 * Usage: npm run smoke:live
 * Exits non-zero on failure.
 */

import {
  fetchPolymarketMarkets,
  fetchPolymarketBinaryOrderbook,
  fetchKalshiMarkets,
  fetchKalshiBinaryOrderbook,
} from '../services/exchange';

// Force live mode for this script
process.env.EXCHANGE_MODE = 'live';

function fmt(p: number | null): string {
  return p != null ? (p * 100).toFixed(1) + '%' : 'N/A';
}

async function main() {
  console.log('=== Smoke Test: Live Exchange Connectivity (direct REST) ===\n');

  let passed = true;

  // ── Polymarket ──────────────────────────────────────────────────────────────
  console.log('[Polymarket] Fetching markets...');
  const pmMarkets = await fetchPolymarketMarkets(undefined, 3);
  console.log(`  Found ${pmMarkets.length} markets`);

  if (pmMarkets.length === 0) {
    console.error('  ERROR: No Polymarket markets returned');
    passed = false;
  } else {
    for (const m of pmMarkets) {
      console.log(`\n  Market: "${m.question}"`);
      console.log(`  conditionId: ${m.venueMarketId}`);
      console.log(`  YES token: ${m.yesTokenId?.slice(0, 16)}...`);
      console.log(`  NO  token: ${m.noTokenId?.slice(0, 16)}...`);

      if (m.yesTokenId && m.noTokenId) {
        try {
          const ob = await fetchPolymarketBinaryOrderbook(m.yesTokenId, m.noTokenId);
          console.log(`  YES ask: ${fmt(ob.bestYesAsk)}  |  NO ask: ${fmt(ob.bestNoAsk)}`);
          if (ob.bestYesAsk != null && ob.bestNoAsk != null) {
            const total = ob.bestYesAsk + ob.bestNoAsk;
            console.log(`  Combined cost: ${fmt(total)} (${total < 1.0 ? '⚡ ARB POSSIBLE' : 'no arb'})`);
          }
          if (ob.bestYesAsk == null || ob.bestNoAsk == null) {
            console.warn('  WARN: null ask price — thin/empty orderbook');
          }
        } catch (err) {
          console.error(`  ERROR fetching orderbook: ${err}`);
          passed = false;
        }
      }
    }
  }

  // ── Kalshi ──────────────────────────────────────────────────────────────────
  console.log('\n[Kalshi] Fetching markets...');
  const kalshiMarkets = await fetchKalshiMarkets(undefined, 3);
  console.log(`  Found ${kalshiMarkets.length} markets`);

  if (kalshiMarkets.length === 0) {
    console.error('  ERROR: No Kalshi markets returned');
    passed = false;
  } else {
    for (const m of kalshiMarkets) {
      console.log(`\n  Market: "${m.question}"`);
      console.log(`  ticker: ${m.venueMarketId}`);

      try {
        const ob = await fetchKalshiBinaryOrderbook(m.venueMarketId, m.venueMarketId);
        console.log(`  YES ask: ${fmt(ob.bestYesAsk)}  |  NO ask: ${fmt(ob.bestNoAsk)}`);
        if (ob.bestYesAsk != null && ob.bestNoAsk != null) {
          const total = ob.bestYesAsk + ob.bestNoAsk;
          console.log(`  Combined cost: ${fmt(total)} (${total < 1.0 ? '⚡ ARB POSSIBLE' : 'no arb'})`);
        }
        if (ob.bestYesAsk == null || ob.bestNoAsk == null) {
          console.warn('  WARN: null ask price — check Kalshi market field names');
        }
      } catch (err) {
        console.error(`  ERROR fetching orderbook: ${err}`);
        passed = false;
      }
    }
  }

  console.log('\n' + (passed ? '=== Smoke test PASSED ===' : '=== Smoke test FAILED ==='));
  if (!passed) process.exit(1);
}

main().catch((err) => {
  console.error('\n=== Smoke test FAILED ===');
  console.error(err?.message || err);
  process.exit(1);
});
