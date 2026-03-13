/**
 * verify-live: assert that both exchanges return real, non-null binary orderbook data.
 * Exits 0 on success, non-zero on any failure.
 *
 * Usage: npm run verify:live
 *
 * Checks:
 *   1. Polymarket: fetches first market, asserts bestYesAsk != null AND bestNoAsk != null
 *   2. Kalshi: fetches first market, asserts bestYesAsk != null AND bestNoAsk != null
 *   3. Neither market ID starts with "mock"
 */

import {
  fetchPolymarketMarkets,
  fetchPolymarketBinaryOrderbook,
  fetchKalshiMarkets,
  fetchKalshiBinaryOrderbook,
} from '../services/exchange';

process.env.EXCHANGE_MODE = 'live';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkPolymarket(): Promise<CheckResult> {
  const markets = await fetchPolymarketMarkets(undefined, 1);
  if (markets.length === 0) return { name: 'Polymarket', ok: false, detail: 'No markets returned' };

  const m = markets[0];
  if (!m.yesTokenId || !m.noTokenId) {
    return { name: 'Polymarket', ok: false, detail: `Missing token IDs: yes=${m.yesTokenId} no=${m.noTokenId}` };
  }
  if (m.venueMarketId.includes('mock')) {
    return { name: 'Polymarket', ok: false, detail: `Mock market ID detected: ${m.venueMarketId}` };
  }

  const ob = await fetchPolymarketBinaryOrderbook(m.yesTokenId, m.noTokenId);
  if (ob.bestYesAsk == null || ob.bestNoAsk == null) {
    return {
      name: 'Polymarket',
      ok: false,
      detail: `Null ask: bestYesAsk=${ob.bestYesAsk} bestNoAsk=${ob.bestNoAsk} (empty orderbook?)`,
    };
  }

  return {
    name: 'Polymarket',
    ok: true,
    detail: `market="${m.question.slice(0, 50)}" yesAsk=${(ob.bestYesAsk * 100).toFixed(1)}% noAsk=${(ob.bestNoAsk * 100).toFixed(1)}%`,
  };
}

async function checkKalshi(): Promise<CheckResult> {
  const markets = await fetchKalshiMarkets(undefined, 1);
  if (markets.length === 0) return { name: 'Kalshi', ok: false, detail: 'No markets returned' };

  const m = markets[0];
  if (m.venueMarketId.includes('mock')) {
    return { name: 'Kalshi', ok: false, detail: `Mock market ID detected: ${m.venueMarketId}` };
  }

  const ob = await fetchKalshiBinaryOrderbook(m.venueMarketId, m.venueMarketId);
  if (ob.bestYesAsk == null || ob.bestNoAsk == null) {
    return {
      name: 'Kalshi',
      ok: false,
      detail: `Null ask: bestYesAsk=${ob.bestYesAsk} bestNoAsk=${ob.bestNoAsk} (check Kalshi market field names)`,
    };
  }

  return {
    name: 'Kalshi',
    ok: true,
    detail: `market="${m.question.slice(0, 50)}" yesAsk=${(ob.bestYesAsk * 100).toFixed(1)}% noAsk=${(ob.bestNoAsk * 100).toFixed(1)}%`,
  };
}

async function main() {
  console.log('=== verify:live — checking real exchange data ===\n');

  const results = await Promise.allSettled([checkPolymarket(), checkKalshi()]);
  let allOk = true;

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`  FAIL (exception): ${result.reason?.message || result.reason}`);
      allOk = false;
      continue;
    }
    const { name, ok, detail } = result.value;
    const icon = ok ? 'PASS' : 'FAIL';
    console.log(`  [${icon}] ${name}: ${detail}`);
    if (!ok) allOk = false;
  }

  console.log('\n' + (allOk
    ? '=== LIVE MODE VERIFIED — real data confirmed ==='
    : '=== VERIFICATION FAILED — check logs above ==='));

  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('Unhandled error:', err?.message || err);
  process.exit(1);
});
