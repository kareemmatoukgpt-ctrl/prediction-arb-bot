/**
 * Pipeline diagnostic script — prints a report showing where
 * the arb detection pipeline breaks down at each stage.
 *
 * Usage: npx tsx src/scripts/diagnose-pipeline.ts
 */

import { getDb, closeDb } from '../db/schema';

function run() {
  const db = getDb();

  console.log('=== PIPELINE DIAGNOSTIC REPORT ===\n');

  // 1. Markets by venue and predicate_type
  console.log('--- MARKETS ---');
  const marketsByVenueType = db.prepare(`
    SELECT venue, predicate_type, COUNT(*) as cnt
    FROM canonical_markets
    WHERE status = 'open'
    GROUP BY venue, predicate_type
    ORDER BY venue, predicate_type
  `).all() as any[];

  for (const row of marketsByVenueType) {
    console.log(`  ${row.venue} | type=${row.predicate_type || 'NULL'} | ${row.cnt} markets`);
  }

  // Markets by category
  console.log('\n  By category:');
  const marketsByCategory = db.prepare(`
    SELECT venue, category, COUNT(*) as cnt
    FROM canonical_markets
    WHERE status = 'open' AND category IS NOT NULL
    GROUP BY venue, category
    ORDER BY venue, category
  `).all() as any[];

  for (const row of marketsByCategory) {
    console.log(`  ${row.venue} | ${row.category} | ${row.cnt} markets`);
  }

  const marketsByVenueAsset = db.prepare(`
    SELECT venue, asset, COUNT(*) as cnt
    FROM canonical_markets
    WHERE asset IS NOT NULL AND status = 'open'
    GROUP BY venue, asset
    ORDER BY venue, asset
  `).all() as any[];

  console.log('\n  By asset:');
  for (const row of marketsByVenueAsset) {
    console.log(`  ${row.venue} | ${row.asset} | ${row.cnt} markets`);
  }

  // Event groups
  console.log('\n--- EVENT GROUPS ---');
  const eventGroups = db.prepare(`
    SELECT venue, event_group, COUNT(*) as cnt
    FROM canonical_markets
    WHERE event_group IS NOT NULL AND status = 'open'
    GROUP BY venue, event_group
    HAVING cnt >= 2
    ORDER BY cnt DESC
    LIMIT 20
  `).all() as any[];

  console.log(`  Groups with 2+ markets: ${eventGroups.length}`);
  for (const row of eventGroups) {
    console.log(`  ${row.venue} | ${row.event_group} | ${row.cnt} outcomes`);
  }

  // 2. Suggestions breakdown
  console.log('\n--- SUGGESTIONS ---');
  const suggestionsByBucket = db.prepare(`
    SELECT bucket, status, COUNT(*) as cnt
    FROM mapping_suggestions
    GROUP BY bucket, status
    ORDER BY bucket, status
  `).all() as any[];

  for (const row of suggestionsByBucket) {
    console.log(`  bucket=${row.bucket} | status=${row.status} | ${row.cnt}`);
  }

  // 3. Analyze WHY suggestions are research-only (parse reasons_json)
  console.log('\n--- GATE ANALYSIS (why pairs are research-only) ---');
  const researchSuggestions = db.prepare(`
    SELECT reasons_json FROM mapping_suggestions WHERE bucket = 'research' LIMIT 5000
  `).all() as any[];

  const gateBlocks: Record<string, number> = {
    type_mismatch: 0,
    expiry_blocked: 0,
    threshold_blocked: 0,
    direction_blocked: 0,
  };

  for (const row of researchSuggestions) {
    try {
      const reasons: string[] = JSON.parse(row.reasons_json);
      const blockLine = reasons.find(r => r.startsWith('Research-only:'));
      if (!blockLine) continue;
      if (blockLine.includes('type mismatch')) gateBlocks.type_mismatch++;
      if (blockLine.includes('expiry>')) gateBlocks.expiry_blocked++;
      if (blockLine.includes('threshold>')) gateBlocks.threshold_blocked++;
      if (blockLine.includes('direction mismatch')) gateBlocks.direction_blocked++;
    } catch { /* skip */ }
  }

  const sampleSize = researchSuggestions.length;
  console.log(`  (sampled ${sampleSize} research suggestions)`);
  for (const [gate, count] of Object.entries(gateBlocks)) {
    const pct = sampleSize > 0 ? ((count / sampleSize) * 100).toFixed(1) : '0';
    console.log(`  ${gate}: ${count} (${pct}%)`);
  }

  // 4. Mappings
  console.log('\n--- MAPPINGS ---');
  const mappingStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled,
      SUM(CASE WHEN mapping_kind = 'auto_approved' THEN 1 ELSE 0 END) as auto_approved,
      SUM(CASE WHEN mapping_kind = 'manual_unverified' THEN 1 ELSE 0 END) as manual
    FROM match_mappings
  `).get() as any;

  console.log(`  total: ${mappingStats.total}, enabled: ${mappingStats.enabled}, auto_approved: ${mappingStats.auto_approved}, manual: ${mappingStats.manual}`);

  // 5. Mappings with orderbook snapshots
  const mappingsWithSnapshots = db.prepare(`
    SELECT COUNT(DISTINCT m.id) as cnt
    FROM match_mappings m
    JOIN canonical_markets pm ON pm.venue = 'POLYMARKET' AND pm.venue_market_id = m.polymarket_market_id
    JOIN canonical_markets k ON k.venue = 'KALSHI' AND k.venue_market_id = m.kalshi_market_id
    WHERE m.enabled = 1
    AND EXISTS (SELECT 1 FROM orderbook_snapshots os WHERE os.market_id = pm.id)
    AND EXISTS (SELECT 1 FROM orderbook_snapshots os WHERE os.market_id = k.id)
  `).get() as any;

  console.log(`  with orderbook snapshots on BOTH sides: ${mappingsWithSnapshots.cnt}`);

  // 6. Opportunities
  console.log('\n--- OPPORTUNITIES ---');
  const oppStats = db.prepare(`
    SELECT COUNT(*) as total FROM arb_opportunities
  `).get() as any;
  const feedStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN suspect = 0 THEN 1 ELSE 0 END) as non_suspect,
      SUM(CASE WHEN suspect = 1 THEN 1 ELSE 0 END) as suspect
    FROM opportunity_feed
  `).get() as any;

  console.log(`  arb_opportunities: ${oppStats.total}`);
  console.log(`  opportunity_feed: total=${feedStats.total}, non_suspect=${feedStats.non_suspect}, suspect=${feedStats.suspect}`);

  // By arb type
  const feedByType = db.prepare(`
    SELECT arb_type, COUNT(*) as cnt
    FROM opportunity_feed
    GROUP BY arb_type
    ORDER BY cnt DESC
  `).all() as any[];

  console.log('\n  By arb type:');
  for (const row of feedByType) {
    console.log(`  ${row.arb_type || 'cross_venue'}: ${row.cnt}`);
  }

  // By category
  const feedByCategory = db.prepare(`
    SELECT category, COUNT(*) as cnt, SUM(CASE WHEN suspect = 0 THEN 1 ELSE 0 END) as non_suspect
    FROM opportunity_feed
    GROUP BY category
    ORDER BY cnt DESC
  `).all() as any[];

  console.log('\n  By category:');
  for (const row of feedByCategory) {
    console.log(`  ${row.category}: ${row.cnt} total, ${row.non_suspect} non-suspect`);
  }

  // 7. Pipeline summary
  console.log('\n=== PIPELINE SUMMARY ===');
  const totalMarkets = db.prepare(`SELECT COUNT(*) as cnt FROM canonical_markets WHERE status = 'open'`).get() as any;
  const totalStructured = db.prepare(`SELECT COUNT(*) as cnt FROM canonical_markets WHERE asset IS NOT NULL AND status = 'open'`).get() as any;
  const totalEvents = db.prepare(`SELECT COUNT(*) as cnt FROM canonical_markets WHERE predicate_type = 'BINARY_EVENT' AND status = 'open'`).get() as any;
  const totalSuggestions = db.prepare(`SELECT COUNT(*) as cnt FROM mapping_suggestions`).get() as any;
  const arbEligible = db.prepare(`SELECT COUNT(*) as cnt FROM mapping_suggestions WHERE bucket = 'arb_eligible'`).get() as any;

  console.log(`  Total open markets: ${totalMarkets.cnt}`);
  console.log(`  Structured (asset set): ${totalStructured.cnt}`);
  console.log(`  Event markets: ${totalEvents.cnt}`);
  console.log(`  Event groups (2+): ${eventGroups.length}`);
  console.log(`  Suggestions: ${totalSuggestions.cnt}`);
  console.log(`  Arb-eligible: ${arbEligible.cnt}`);
  console.log(`  Enabled mappings: ${mappingStats.enabled}`);
  console.log(`  Mappings with snapshots: ${mappingsWithSnapshots.cnt}`);
  console.log(`  Opportunities (feed): ${feedStats.total}`);

  // Bottleneck analysis
  if (arbEligible.cnt === 0 && gateBlocks.type_mismatch > 0) {
    console.log('\n  ** NOTE: Type mismatch gate blocks TOUCH_BY vs CLOSE_AT pairs (by design) **');
    console.log('  These are fundamentally different products. Focus on FED/MACRO (CLOSE_AT on both)');
    console.log('  and EVENT markets (BINARY_EVENT on both).');
  }
  if (totalEvents.cnt > 0 && feedByCategory.every((r: any) => r.category !== 'EVENT')) {
    console.log('\n  ** NOTE: Event markets exist but no EVENT opportunities in feed yet **');
    console.log('  Event suggestions need to be generated and approved as mappings first.');
  }

  closeDb();
}

run();
