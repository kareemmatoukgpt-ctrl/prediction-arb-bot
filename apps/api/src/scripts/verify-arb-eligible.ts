/**
 * Verify the crypto auto-mapping pipeline produces meaningful results.
 * Run: npm run verify:arb-eligible
 *
 * Asserts:
 *   - Ingestion runs without error
 *   - PM crypto markets in DB (asset NOT NULL) >= 10
 *   - Kalshi crypto markets in DB (asset NOT NULL) >= 100
 *   - Matching engine produces suggestions without error
 *   - If arb_eligible == 0, prints top 10 closest-by-score with reasons
 */
import { refreshCryptoMarkets } from '../services/ingestion';
import { generateSuggestions } from '../services/crypto-matcher';
import { getDb, closeDb } from '../db/schema';

process.env.EXCHANGE_MODE = process.env.EXCHANGE_MODE || 'live';

async function run(): Promise<void> {
  console.log('\n=== Arb-Eligible Verification ===');
  console.log(`EXCHANGE_MODE=${process.env.EXCHANGE_MODE}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  let failed = false;
  const db = getDb();

  // Step 1: Ingest crypto markets
  console.log('Step 1: Ingesting crypto markets (this may take 30-60s for PM pagination)...');
  try {
    const result = await refreshCryptoMarkets();
    console.log(`  Polymarket: ${result.polymarket} markets ingested`);
    console.log(`  Kalshi:     ${result.kalshi} markets ingested`);
  } catch (err) {
    console.error('  FAILED: Ingestion threw an error:', err);
    failed = true;
  }

  // Step 2: Assert DB counts
  console.log('\nStep 2: DB market counts (asset IS NOT NULL)...');
  const pmCount = (db.prepare(`SELECT COUNT(*) as c FROM canonical_markets WHERE venue='POLYMARKET' AND asset IS NOT NULL`).get() as any).c;
  const kCount = (db.prepare(`SELECT COUNT(*) as c FROM canonical_markets WHERE venue='KALSHI' AND asset IS NOT NULL`).get() as any).c;
  console.log(`  Polymarket: ${pmCount}`);
  console.log(`  Kalshi:     ${kCount}`);

  if (pmCount < 10) {
    console.error(`  ASSERT FAIL: PM crypto markets = ${pmCount} (expected >= 10)`);
    failed = true;
  } else {
    console.log(`  OK: PM count ${pmCount} >= 10`);
  }

  if (kCount < 100) {
    console.error(`  ASSERT FAIL: Kalshi crypto markets = ${kCount} (expected >= 100)`);
    failed = true;
  } else {
    console.log(`  OK: Kalshi count ${kCount} >= 100`);
  }

  // Step 2b: Asset breakdown
  console.log('\nStep 2b: Asset breakdown...');
  const assetBreakdown = db.prepare(`
    SELECT venue, asset, COUNT(*) as c
    FROM canonical_markets
    WHERE asset IS NOT NULL
    GROUP BY venue, asset
    ORDER BY venue, asset
  `).all() as any[];
  for (const row of assetBreakdown) {
    console.log(`  ${row.venue} ${row.asset}: ${row.c} markets`);
  }

  // Step 2c: Predicate type breakdown
  console.log('\nStep 2c: Predicate type breakdown...');
  const typeBreakdown = db.prepare(`
    SELECT venue, predicate_type, COUNT(*) as c
    FROM canonical_markets
    WHERE asset IS NOT NULL
    GROUP BY venue, predicate_type
    ORDER BY venue, predicate_type
  `).all() as any[];
  for (const row of typeBreakdown) {
    console.log(`  ${row.venue} ${row.predicate_type || 'NULL'}: ${row.c} markets`);
  }

  // Step 3: Generate suggestions
  console.log('\nStep 3: Generating suggestions...');
  let genResult = { created: 0, updated: 0, arb_eligible: 0, research: 0 };
  try {
    genResult = generateSuggestions(0);
    console.log(`  Total:        ${genResult.created}`);
    console.log(`  Arb-eligible: ${genResult.arb_eligible}`);
    console.log(`  Research:     ${genResult.research}`);
  } catch (err) {
    console.error('  FAILED: Suggestion generation threw an error:', err);
    failed = true;
  }

  // Step 4: Print arb-eligible suggestions
  console.log('\nStep 4: Arb-eligible suggestions...');
  const arbSuggestions = db.prepare(`
    SELECT ms.*, pm.question as pm_q, k.question as k_q,
           pm.predicate_type as pm_type, k.predicate_type as k_type,
           pm.predicate_threshold as pm_thresh, k.predicate_threshold as k_thresh,
           pm.expiry_ts as pm_exp, k.expiry_ts as k_exp
    FROM mapping_suggestions ms
    LEFT JOIN canonical_markets pm ON pm.venue_market_id = ms.polymarket_market_id AND pm.venue = 'POLYMARKET'
    LEFT JOIN canonical_markets k  ON k.venue_market_id  = ms.kalshi_market_id    AND k.venue  = 'KALSHI'
    WHERE ms.bucket = 'arb_eligible'
    ORDER BY ms.score DESC LIMIT 20
  `).all() as any[];

  if (arbSuggestions.length > 0) {
    console.log(`  Found ${arbSuggestions.length} arb-eligible suggestions!`);
    for (const s of arbSuggestions) {
      const reasons: string[] = JSON.parse(s.reasons_json);
      console.log(`\n  Score: ${s.score} [arb_eligible]`);
      console.log(`  PM:     ${(s.pm_q || s.polymarket_market_id).slice(0, 80)}`);
      console.log(`  Kalshi: ${(s.k_q || s.kalshi_market_id).slice(0, 80)}`);
      console.log(`  PM type: ${s.pm_type}  K type: ${s.k_type}`);
      console.log(`  PM thresh: $${s.pm_thresh}  K thresh: $${s.k_thresh}`);
      console.log(`  PM exp: ${s.pm_exp ? new Date(s.pm_exp * 1000).toISOString() : 'null'}  K exp: ${s.k_exp ? new Date(s.k_exp * 1000).toISOString() : 'null'}`);
      for (const r of reasons) console.log(`    - ${r}`);
    }
  } else {
    console.log('  0 arb-eligible suggestions (see top research pairs below for what\'s closest)');
  }

  // Step 5: Print top 10 closest (by score) research suggestions
  console.log('\nStep 5: Top 10 closest research suggestions (showing why they\'re not arb-eligible)...');
  const topResearch = db.prepare(`
    SELECT ms.*, pm.question as pm_q, k.question as k_q,
           pm.predicate_type as pm_type, k.predicate_type as k_type,
           pm.predicate_threshold as pm_thresh, k.predicate_threshold as k_thresh,
           pm.expiry_ts as pm_exp, k.expiry_ts as k_exp
    FROM mapping_suggestions ms
    LEFT JOIN canonical_markets pm ON pm.venue_market_id = ms.polymarket_market_id AND pm.venue = 'POLYMARKET'
    LEFT JOIN canonical_markets k  ON k.venue_market_id  = ms.kalshi_market_id    AND k.venue  = 'KALSHI'
    WHERE ms.bucket = 'research'
    ORDER BY ms.score DESC LIMIT 10
  `).all() as any[];

  for (const s of topResearch) {
    const reasons: string[] = JSON.parse(s.reasons_json);
    console.log(`\n  Score: ${s.score} [research]`);
    console.log(`  PM:     ${(s.pm_q || s.polymarket_market_id).slice(0, 80)}`);
    console.log(`  Kalshi: ${(s.k_q || s.kalshi_market_id).slice(0, 80)}`);
    console.log(`  PM type: ${s.pm_type}  K type: ${s.k_type}`);
    console.log(`  PM thresh: $${s.pm_thresh}  K thresh: $${s.k_thresh}`);
    const expiryInfo = s.pm_exp && s.k_exp
      ? `delta ${Math.abs(s.pm_exp - s.k_exp)}s (${(Math.abs(s.pm_exp - s.k_exp) / 3600).toFixed(1)}h)`
      : 'unknown';
    console.log(`  Expiry: ${expiryInfo}`);
    for (const r of reasons) console.log(`    - ${r}`);
  }

  closeDb();

  console.log('\n=== Result ===');
  if (failed) {
    console.error('FAILED: One or more assertions failed — see errors above');
    process.exit(1);
  } else {
    console.log(`PASSED: Pipeline healthy. Arb-eligible=${genResult.arb_eligible}, Research=${genResult.research}`);
    if (genResult.arb_eligible === 0) {
      console.log('NOTE: 0 arb-eligible is expected when PM/Kalshi contract types don\'t overlap (TOUCH_BY vs CLOSE_AT).');
      console.log('See docs/DECISIONS.md for full analysis.');
    }
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
