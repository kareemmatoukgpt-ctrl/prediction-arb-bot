/**
 * Verify crypto market ingestion and suggestion generation.
 * Run: npm run verify:crypto-mapping
 *
 * Design: never fails on "no suggestions" — sparse results expected.
 * Only fails if ingestion throws or suggestion logic has bugs.
 */
import { refreshCryptoMarkets } from '../services/ingestion';
import { generateSuggestions } from '../services/crypto-matcher';
import { getDb, closeDb } from '../db/schema';

process.env.EXCHANGE_MODE = process.env.EXCHANGE_MODE || 'live';

async function run(): Promise<void> {
  console.log('\n=== Crypto Mapping Verification ===');
  console.log(`EXCHANGE_MODE=${process.env.EXCHANGE_MODE}\n`);

  let failed = false;

  // Step 1: Ingest
  console.log('Step 1: Ingesting crypto markets...');
  try {
    const result = await refreshCryptoMarkets();
    console.log(`  Polymarket: ${result.polymarket} markets`);
    console.log(`  Kalshi:     ${result.kalshi} markets`);
    if (result.polymarket === 0) {
      console.warn('  WARNING: 0 Polymarket crypto markets -- keyword search may need tuning');
    }
    if (result.kalshi === 0) {
      console.warn('  WARNING: 0 Kalshi crypto markets -- KXBTC/KXETH/KXSOL may be empty');
    }
  } catch (err) {
    console.error('  FAILED: Ingestion failed:', err);
    failed = true;
  }

  // Step 2: Check DB counts
  console.log('\nStep 2: DB market counts...');
  const db = getDb();
  const pmCount = (db.prepare(`SELECT COUNT(*) as c FROM canonical_markets WHERE venue='POLYMARKET' AND asset IS NOT NULL`).get() as any).c;
  const kCount  = (db.prepare(`SELECT COUNT(*) as c FROM canonical_markets WHERE venue='KALSHI' AND asset IS NOT NULL`).get() as any).c;
  console.log(`  Polymarket crypto markets in DB: ${pmCount}`);
  console.log(`  Kalshi crypto markets in DB:     ${kCount}`);

  // Step 3: Generate suggestions
  console.log('\nStep 3: Generating suggestions (minScore=0)...');
  let genResult = { created: 0, updated: 0, arb_eligible: 0, research: 0 };
  try {
    genResult = generateSuggestions(0);
    console.log(`  Total upserted: ${genResult.created}`);
    console.log(`  Arb-eligible:   ${genResult.arb_eligible}`);
    console.log(`  Research:       ${genResult.research}`);
  } catch (err) {
    console.error('  FAILED: Suggestion generation failed:', err);
    failed = true;
  }

  // Step 4: Validate existing suggestions
  console.log('\nStep 4: Validating suggestions...');
  const allSuggestions = db.prepare(`SELECT * FROM mapping_suggestions ORDER BY score DESC LIMIT 50`).all() as any[];
  if (allSuggestions.length > 0) {
    let assetMatchFail = 0;
    for (const s of allSuggestions) {
      const reasons: string[] = JSON.parse(s.reasons_json);
      const hasAssetMatch = reasons.some(r => r.includes('Asset:') && r.includes('match'));
      if (!hasAssetMatch && s.score > 0) assetMatchFail++;
    }
    if (assetMatchFail > 0) {
      console.error(`  FAILED: ${assetMatchFail} suggestions missing asset match reason`);
      failed = true;
    } else {
      console.log(`  OK: All ${allSuggestions.length} suggestions have asset match`);
    }
  } else {
    console.log('  INFO: No suggestions found (expected if PM and Kalshi have no overlapping crypto contracts today)');
  }

  // Step 5: Print top 10
  console.log('\nStep 5: Top 10 suggestions by score:');
  const top10 = db.prepare(`
    SELECT ms.*, pm.question as pm_q, k.question as k_q
    FROM mapping_suggestions ms
    LEFT JOIN canonical_markets pm ON pm.venue_market_id = ms.polymarket_market_id AND pm.venue = 'POLYMARKET'
    LEFT JOIN canonical_markets k  ON k.venue_market_id  = ms.kalshi_market_id    AND k.venue  = 'KALSHI'
    ORDER BY ms.score DESC LIMIT 10
  `).all() as any[];

  if (top10.length === 0) {
    console.log('  (none)');
  } else {
    for (const s of top10) {
      const reasons: string[] = JSON.parse(s.reasons_json);
      console.log(`\n  Score: ${s.score} [${s.bucket}]`);
      console.log(`  PM:     ${(s.pm_q || s.polymarket_market_id).slice(0, 80)}`);
      console.log(`  Kalshi: ${(s.k_q  || s.kalshi_market_id).slice(0, 80)}`);
      for (const r of reasons) console.log(`    - ${r}`);
    }
  }

  closeDb();

  console.log('\n=== Result ===');
  if (failed) {
    console.error('FAILED: Verification FAILED -- see errors above');
    process.exit(1);
  } else {
    console.log('PASSED: Verification PASSED');
    process.exit(0);
  }
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
