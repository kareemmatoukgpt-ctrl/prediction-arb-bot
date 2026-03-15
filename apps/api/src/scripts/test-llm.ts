import dotenv from 'dotenv';
dotenv.config();

import Database from 'better-sqlite3';
import { extractMarketEntity, compareEntities } from '../services/llm-extractor';

const db = new Database('../../prediction-arb-bot.db');

async function main() {
  console.log('API Key present:', !!process.env.ANTHROPIC_API_KEY);

  // Find actual matching pairs: same asset, same threshold
  const pairs = db.prepare(`
    SELECT
      pm.question as pm_q, k.question as k_q,
      pm.predicate_threshold as pm_thresh, k.predicate_threshold as k_thresh,
      pm.expiry_ts as pm_exp, k.expiry_ts as k_exp
    FROM canonical_markets pm
    JOIN canonical_markets k ON pm.asset = k.asset
      AND pm.predicate_threshold = k.predicate_threshold
    WHERE pm.venue = 'POLYMARKET' AND k.venue = 'KALSHI'
      AND pm.asset = 'FED_RATE' AND pm.status = 'open' AND k.status = 'open'
    LIMIT 5
  `).all() as any[];

  console.log(`Found ${pairs.length} threshold-matched FED pairs\n`);

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    console.log(`=== Pair ${i + 1} (threshold=${p.pm_thresh}) ===`);
    console.log('PM:', p.pm_q.substring(0, 100));
    console.log('K: ', p.k_q.substring(0, 100));

    const t0 = Date.now();
    const [pmE, kE] = await Promise.all([
      extractMarketEntity(p.pm_q, 'POLYMARKET'),
      extractMarketEntity(p.k_q, 'KALSHI'),
    ]);
    const elapsed = Date.now() - t0;

    const cmp = compareEntities(pmE, kE);
    console.log(`PM: ${pmE.predicate} ${pmE.threshold} (${pmE.date})`);
    console.log(`K:  ${kE.predicate} ${kE.threshold} (${kE.date})`);
    console.log(`Match: ${cmp.match}, Confidence: ${cmp.confidence.toFixed(2)}, Time: ${elapsed}ms`);
    if (cmp.risks.length) console.log('Risks:', cmp.risks.join('; '));
    console.log();
  }

  // Also test crypto pairs
  const cryptoPairs = db.prepare(`
    SELECT
      pm.question as pm_q, k.question as k_q,
      pm.asset, pm.predicate_threshold as pm_thresh, k.predicate_threshold as k_thresh
    FROM canonical_markets pm
    JOIN canonical_markets k ON pm.asset = k.asset
      AND ABS(pm.predicate_threshold - k.predicate_threshold) < 1000
    WHERE pm.venue = 'POLYMARKET' AND k.venue = 'KALSHI'
      AND pm.asset = 'BTC' AND pm.status = 'open' AND k.status = 'open'
      AND pm.predicate_threshold IS NOT NULL AND k.predicate_threshold IS NOT NULL
    LIMIT 3
  `).all() as any[];

  console.log(`\n=== BTC Crypto Pairs (${cryptoPairs.length} found) ===\n`);

  for (let i = 0; i < cryptoPairs.length; i++) {
    const p = cryptoPairs[i];
    console.log(`--- BTC Pair ${i + 1} (PM=$${p.pm_thresh} K=$${p.k_thresh}) ---`);
    console.log('PM:', p.pm_q.substring(0, 100));
    console.log('K: ', p.k_q.substring(0, 100));

    const t0 = Date.now();
    const [pmE, kE] = await Promise.all([
      extractMarketEntity(p.pm_q, 'POLYMARKET'),
      extractMarketEntity(p.k_q, 'KALSHI'),
    ]);
    const elapsed = Date.now() - t0;

    const cmp = compareEntities(pmE, kE);
    console.log(`PM: ${pmE.predicate} $${pmE.threshold} (${pmE.date})`);
    console.log(`K:  ${kE.predicate} $${kE.threshold} (${kE.date})`);
    console.log(`Match: ${cmp.match}, Confidence: ${cmp.confidence.toFixed(2)}, Time: ${elapsed}ms`);
    if (cmp.risks.length) console.log('Risks:', cmp.risks.join('; '));
    console.log();
  }

  // Summary: test the same pair with LLM OFF for comparison
  console.log('\n=== LLM vs Regex Comparison ===\n');
  const testQ = {
    pm: 'Will the upper bound of the target federal funds rate be ≥ 4.5% at the end of 2026?',
    k: 'Will the upper bound of the federal funds rate be above 4.50% following the Feds Dec 9, 2026 meeting?',
  };

  // LLM extraction (already cached from above runs, but let's re-extract)
  const [llmPm, llmK] = await Promise.all([
    extractMarketEntity(testQ.pm, 'POLYMARKET'),
    extractMarketEntity(testQ.k, 'KALSHI'),
  ]);
  const llmCmp = compareEntities(llmPm, llmK);

  console.log('LLM:');
  console.log(`  PM: ${llmPm.predicate} ${llmPm.threshold}% (${llmPm.date})`);
  console.log(`  K:  ${llmK.predicate} ${llmK.threshold}% (${llmK.date})`);
  console.log(`  Match: ${llmCmp.match}, Confidence: ${llmCmp.confidence.toFixed(2)}`);
  if (llmCmp.risks.length) console.log(`  Risks: ${llmCmp.risks.join('; ')}`);
}

main().catch(console.error);
