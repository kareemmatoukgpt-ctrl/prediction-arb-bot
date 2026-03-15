import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectArb, checkArbDirection, estimateAllInCost, DEFAULT_COST_PARAMS } from './arb-math';

describe('estimateAllInCost', () => {
  it('returns raw price when no fees or slippage', () => {
    assert.strictEqual(estimateAllInCost(0.5, 0, 0), 0.5);
  });
  it('adds fees and slippage proportionally', () => {
    const result = estimateAllInCost(0.5, 100, 50); // 1% fee + 0.5% slippage
    assert.ok(Math.abs(result - 0.5075) < 0.0001);
  });
});

describe('detectArb', () => {
  it('detects arb when total cost < 1.0', () => {
    const results = detectArb(
      { yesAsk: 0.30, noAsk: 0.70 },
      { yesAsk: 0.70, noAsk: 0.30 },
      100,
      { polymarketTakerFeeBps: 0, kalshiTakerFeeBps: 0, slippageBps: 0, arbThresholdBps: 0 },
    );
    // PM YES 0.30 + K NO 0.30 = 0.60 < 1.0 -> arb
    assert.ok(results.length > 0);
    assert.ok(results[0].isArb);
  });

  it('returns empty when no arb exists', () => {
    const results = detectArb(
      { yesAsk: 0.55, noAsk: 0.55 },
      { yesAsk: 0.55, noAsk: 0.55 },
      100,
      { polymarketTakerFeeBps: 0, kalshiTakerFeeBps: 0, slippageBps: 0, arbThresholdBps: 0 },
    );
    // PM YES 0.55 + K NO 0.55 = 1.10 > 1.0 -> no arb
    assert.strictEqual(results.length, 0);
  });

  it('handles null prices gracefully', () => {
    const results = detectArb(
      { yesAsk: null, noAsk: 0.50 },
      { yesAsk: 0.50, noAsk: null },
      100,
    );
    assert.strictEqual(results.length, 0);
  });

  it('respects threshold', () => {
    const results = detectArb(
      { yesAsk: 0.49, noAsk: 0.51 },
      { yesAsk: 0.51, noAsk: 0.49 },
      100,
      { polymarketTakerFeeBps: 0, kalshiTakerFeeBps: 0, slippageBps: 0, arbThresholdBps: 500 },
    );
    // Total cost: 0.49 + 0.49 = 0.98 -> 200 bps profit, but threshold is 500
    assert.strictEqual(results.length, 0);
  });
});
