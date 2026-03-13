/**
 * Smoke test: verify live exchange connectivity via pmxt.
 * Connects to both Polymarket and Kalshi, fetches markets + orderbooks,
 * prints normalized quotes, exits non-zero on failure.
 *
 * Usage: npm run smoke:live
 */

import { Polymarket, Kalshi } from 'pmxtjs';

function formatPrice(p: number): string {
  return (p * 100).toFixed(1) + '%';
}

async function main() {
  console.log('=== Smoke Test: Live Exchange Connectivity ===\n');

  const poly = new Polymarket();
  const kalshi = new Kalshi();

  // ── Polymarket ──
  console.log('[Polymarket] Fetching markets...');
  const pmMarkets = await poly.fetchMarkets({ limit: 3, sort: 'volume' });
  console.log(`  Found ${pmMarkets.length} markets`);
  if (pmMarkets.length === 0) throw new Error('No Polymarket markets found');

  for (const market of pmMarkets) {
    console.log(`\n  Market: "${market.title}"`);
    console.log(`  ID: ${market.marketId}`);
    console.log(`  Outcomes: ${market.outcomes.map((o: any) => `${o.label}(${o.outcomeId?.slice(0, 12)}...)`).join(', ')}`);

    if (market.outcomes.length >= 2) {
      const yesId = market.outcomes[0].outcomeId;
      const noId = market.outcomes[1].outcomeId;

      const [yesOb, noOb] = await Promise.all([
        poly.fetchOrderBook(yesId),
        poly.fetchOrderBook(noId),
      ]);

      const yesAsk = yesOb.asks.length > 0 ? Math.min(...yesOb.asks.map((a: any) => a.price)) : null;
      const noAsk = noOb.asks.length > 0 ? Math.min(...noOb.asks.map((a: any) => a.price)) : null;

      console.log(`  YES: ${yesOb.bids.length} bids, ${yesOb.asks.length} asks | best ask: ${yesAsk ? formatPrice(yesAsk) : 'N/A'}`);
      console.log(`  NO:  ${noOb.bids.length} bids, ${noOb.asks.length} asks | best ask: ${noAsk ? formatPrice(noAsk) : 'N/A'}`);

      if (yesAsk && noAsk) {
        const total = yesAsk + noAsk;
        console.log(`  Combined cost: ${formatPrice(total)} (${total < 1.0 ? 'ARB POSSIBLE' : 'no arb'})`);
      }
    }
  }

  // ── Kalshi ──
  console.log('\n[Kalshi] Fetching markets...');
  const kalshiMarkets = await kalshi.fetchMarkets({ limit: 3, sort: 'volume' });
  console.log(`  Found ${kalshiMarkets.length} markets`);
  if (kalshiMarkets.length === 0) throw new Error('No Kalshi markets found');

  for (const market of kalshiMarkets) {
    console.log(`\n  Market: "${market.title}"`);
    console.log(`  ID: ${market.marketId}`);
    console.log(`  Outcomes: ${market.outcomes.map((o: any) => `${o.label}(${o.outcomeId})`).join(', ')}`);

    if (market.outcomes.length >= 2) {
      const yesId = market.outcomes[0].outcomeId;
      const noId = market.outcomes[1].outcomeId;

      const [yesOb, noOb] = await Promise.all([
        kalshi.fetchOrderBook(yesId),
        kalshi.fetchOrderBook(noId),
      ]);

      const yesAsk = yesOb.asks.length > 0 ? Math.min(...yesOb.asks.map((a: any) => a.price)) : null;
      const noAsk = noOb.asks.length > 0 ? Math.min(...noOb.asks.map((a: any) => a.price)) : null;

      console.log(`  YES: ${yesOb.bids.length} bids, ${yesOb.asks.length} asks | best ask: ${yesAsk ? formatPrice(yesAsk) : 'N/A'}`);
      console.log(`  NO:  ${noOb.bids.length} bids, ${noOb.asks.length} asks | best ask: ${noAsk ? formatPrice(noAsk) : 'N/A'}`);

      if (yesAsk && noAsk) {
        const total = yesAsk + noAsk;
        console.log(`  Combined cost: ${formatPrice(total)} (${total < 1.0 ? 'ARB POSSIBLE' : 'no arb'})`);
      }
    }
  }

  console.log('\n=== Smoke test PASSED ===');
}

main().catch((err) => {
  console.error('\n=== Smoke test FAILED ===');
  console.error(err.message || err);
  process.exit(1);
});
