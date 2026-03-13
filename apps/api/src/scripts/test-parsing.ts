/**
 * Tests for parsePolymarketCryptoFields with real market titles.
 * Run: npm run test:parsing
 */
import { parsePolymarketCryptoFields } from '../services/exchange';

interface TestCase {
  title: string;
  endDate?: string;
  expected: {
    asset: string;
    direction: 'ABOVE' | 'BELOW' | null;
    threshold: number | null;
    type: 'CLOSE_AT' | 'TOUCH_BY';
  } | null; // null = should NOT parse as crypto
}

const cases: TestCase[] = [
  // ── BTC above/hit/reach ──
  {
    title: 'Will Bitcoin hit $150k by March 31, 2026?',
    endDate: '2026-04-01T04:00:00Z',
    expected: { asset: 'BTC', direction: 'ABOVE', threshold: 150000, type: 'TOUCH_BY' },
  },
  {
    title: 'Will Bitcoin reach $250,000 by December 31, 2026?',
    endDate: '2026-12-31T23:59:59Z',
    expected: { asset: 'BTC', direction: 'ABOVE', threshold: 250000, type: 'TOUCH_BY' },
  },
  {
    title: 'Will Bitcoin reach $100,000 by December 31, 2026?',
    expected: { asset: 'BTC', direction: 'ABOVE', threshold: 100000, type: 'TOUCH_BY' },
  },
  {
    title: 'Will BTC hit $80k by end of March?',
    expected: { asset: 'BTC', direction: 'ABOVE', threshold: 80000, type: 'TOUCH_BY' },
  },
  {
    title: 'Will Bitcoin reach $90,000 by December 31, 2026?',
    expected: { asset: 'BTC', direction: 'ABOVE', threshold: 90000, type: 'TOUCH_BY' },
  },

  // ── BTC dip/below ──
  {
    title: 'Will Bitcoin dip to $55,000 by Dec 31, 2026?',
    expected: { asset: 'BTC', direction: 'BELOW', threshold: 55000, type: 'TOUCH_BY' },
  },
  {
    title: 'Will Bitcoin dip to $35,000 by Dec 31, 2026?',
    expected: { asset: 'BTC', direction: 'BELOW', threshold: 35000, type: 'TOUCH_BY' },
  },

  // ── ETH ──
  {
    title: 'Will Ethereum reach $3,500 by December 31, 2026?',
    expected: { asset: 'ETH', direction: 'ABOVE', threshold: 3500, type: 'TOUCH_BY' },
  },
  {
    title: 'Will Ethereum reach $10,000 by December 31, 2026?',
    expected: { asset: 'ETH', direction: 'ABOVE', threshold: 10000, type: 'TOUCH_BY' },
  },
  {
    title: 'Will Ethereum dip to $1,000 by Dec 31, 2026?',
    expected: { asset: 'ETH', direction: 'BELOW', threshold: 1000, type: 'TOUCH_BY' },
  },

  // ── SOL ──
  {
    title: 'Will Solana reach $600 by December 31, 2026?',
    expected: { asset: 'SOL', direction: 'ABOVE', threshold: 600, type: 'TOUCH_BY' },
  },
  {
    title: 'Will Solana dip to $60 by Dec 31, 2026?',
    expected: { asset: 'SOL', direction: 'BELOW', threshold: 60, type: 'TOUCH_BY' },
  },

  // ── XRP ──
  {
    title: 'Will XRP reach $5.00 by December 31, 2026?',
    expected: { asset: 'XRP', direction: 'ABOVE', threshold: 5.00, type: 'TOUCH_BY' },
  },
  {
    title: 'Will XRP dip to $1.00 by Dec 31, 2026?',
    expected: { asset: 'XRP', direction: 'BELOW', threshold: 1.00, type: 'TOUCH_BY' },
  },

  // ── DOGE ──
  {
    title: 'Will Dogecoin reach $0.52 by December 31, 2026?',
    expected: { asset: 'DOGE', direction: 'ABOVE', threshold: 0.52, type: 'TOUCH_BY' },
  },

  // ── Suffix multipliers ──
  {
    title: 'Will Bitcoin hit $1.2m by 2030?',
    expected: { asset: 'BTC', direction: 'ABOVE', threshold: 1200000, type: 'TOUCH_BY' },
  },

  // ── Close-at type ──
  {
    title: 'Will Bitcoin close above $80,000 on March 31?',
    expected: { asset: 'BTC', direction: 'ABOVE', threshold: 80000, type: 'CLOSE_AT' },
  },

  // ── Non-crypto markets (should return null) ──
  {
    title: 'Will the Fed cut rates in June 2026?',
    expected: null,
  },
  {
    title: 'Will Iran agree to nuclear deal by April?',
    expected: null,
  },
  {
    title: 'Will solar energy exceed 30% of US grid?',
    expected: null, // "solar" should not match SOL
  },
];

let passed = 0;
let failed = 0;

for (const tc of cases) {
  const result = parsePolymarketCryptoFields(tc.title, tc.endDate);

  if (tc.expected === null) {
    if (result === null) {
      passed++;
    } else {
      failed++;
      console.error(`FAIL: "${tc.title}"\n  Expected: null\n  Got: asset=${result.asset}`);
    }
    continue;
  }

  if (result === null) {
    failed++;
    console.error(`FAIL: "${tc.title}"\n  Expected: asset=${tc.expected.asset}\n  Got: null`);
    continue;
  }

  const errors: string[] = [];
  if (result.asset !== tc.expected.asset) errors.push(`asset: ${result.asset} != ${tc.expected.asset}`);
  if (result.predicateDirection !== tc.expected.direction) errors.push(`direction: ${result.predicateDirection} != ${tc.expected.direction}`);
  if (result.predicateThreshold !== tc.expected.threshold) errors.push(`threshold: ${result.predicateThreshold} != ${tc.expected.threshold}`);
  if (result.predicateType !== tc.expected.type) errors.push(`type: ${result.predicateType} != ${tc.expected.type}`);

  if (errors.length > 0) {
    failed++;
    console.error(`FAIL: "${tc.title}"\n  ${errors.join('\n  ')}`);
  } else {
    passed++;
  }
}

console.log(`\n=== Parsing Tests: ${passed} passed, ${failed} failed out of ${cases.length} ===`);
process.exit(failed > 0 ? 1 : 0);
