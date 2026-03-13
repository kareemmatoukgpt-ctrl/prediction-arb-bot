import {
  ArbDirection,
  CostModelParams,
  SimpleOrderbook,
} from './types';

/** Default cost model for V1 paper trading */
export const DEFAULT_COST_PARAMS: CostModelParams = {
  polymarketTakerFeeBps: 0,   // Polymarket: 0 taker fee on CLOB
  kalshiTakerFeeBps: 0,       // Kalshi: varies by market, 0 for paper
  slippageBps: 10,            // 10 bps expected slippage per side
  arbThresholdBps: 50,        // require 50 bps minimum edge
};

/**
 * Estimate all-in cost for one side of a binary outcome purchase.
 * Returns the effective price including fees and slippage.
 */
export function estimateAllInCost(
  rawPrice: number,
  feeBps: number,
  slippageBps: number,
): number {
  const fee = rawPrice * (feeBps / 10_000);
  const slippage = rawPrice * (slippageBps / 10_000);
  return rawPrice + fee + slippage;
}

/**
 * Get the best ask price from an orderbook, or null if empty.
 */
function bestAsk(ob: SimpleOrderbook): number | null {
  if (ob.asks.length === 0) return null;
  return Math.min(...ob.asks.map((a) => a.price));
}

/**
 * Compute the VWAP for a given side/size from orderbook depth.
 * Returns null if insufficient liquidity.
 */
export function vwapForSize(
  levels: { price: number; size: number }[],
  sizeUSD: number,
): number | null {
  let remaining = sizeUSD;
  let totalCost = 0;

  // Sort asks ascending by price
  const sorted = [...levels].sort((a, b) => a.price - b.price);

  for (const level of sorted) {
    const available = level.price * level.size;
    const fill = Math.min(remaining, available);
    totalCost += fill;
    remaining -= fill;
    if (remaining <= 0) break;
  }

  if (remaining > 0) return null; // insufficient liquidity
  return totalCost / sizeUSD;
}

export interface ArbCheckResult {
  isArb: boolean;
  direction: ArbDirection;
  costYes: number;
  costNo: number;
  totalCost: number;
  feesEstimate: number;
  slippageEstimate: number;
  expectedProfitUSD: number;
  expectedProfitBps: number;
}

/**
 * Check for arbitrage in one direction.
 * Buy YES on venue A at ask + Buy NO on venue B at ask.
 *
 * Cost model:
 *   yesAllIn = yesAsk * (1 + venueFee + slippage)
 *   noAllIn  = noAsk  * (1 + venueFee + slippage)
 *   totalCost = yesAllIn + noAllIn
 *   isArb = (1 - totalCost) > arbThreshold
 */
export function checkArbDirection(
  yesAsk: number,
  noAsk: number,
  sizeUSD: number,
  costParams: CostModelParams,
  direction: ArbDirection,
): ArbCheckResult {
  // Determine per-venue fees based on direction
  const yesVenueFeeBps = direction === 'BUY_YES_PM_BUY_NO_KALSHI'
    ? costParams.polymarketTakerFeeBps
    : costParams.kalshiTakerFeeBps;
  const noVenueFeeBps = direction === 'BUY_YES_PM_BUY_NO_KALSHI'
    ? costParams.kalshiTakerFeeBps
    : costParams.polymarketTakerFeeBps;

  const slippage = costParams.slippageBps / 10_000;
  const yesFeeRate = yesVenueFeeBps / 10_000;
  const noFeeRate = noVenueFeeBps / 10_000;

  const yesAllIn = yesAsk * (1 + yesFeeRate + slippage);
  const noAllIn = noAsk * (1 + noFeeRate + slippage);
  const totalCostPerUnit = yesAllIn + noAllIn;

  const feesEstimate = (yesAsk * yesFeeRate + noAsk * noFeeRate) * sizeUSD;
  const slippageEstimate = (yesAsk + noAsk) * slippage * sizeUSD;

  const payout = 1.0; // binary outcome pays $1
  const threshold = costParams.arbThresholdBps / 10_000;
  const profitPerUnit = payout - totalCostPerUnit;
  const expectedProfitUSD = profitPerUnit * sizeUSD;
  const expectedProfitBps = Math.round(profitPerUnit * 10_000);

  return {
    isArb: profitPerUnit > threshold,
    direction,
    costYes: yesAsk,
    costNo: noAsk,
    totalCost: totalCostPerUnit * sizeUSD,
    feesEstimate,
    slippageEstimate,
    expectedProfitUSD,
    expectedProfitBps,
  };
}

/**
 * Detect arbitrage opportunities across two venues for a mapped market.
 * Evaluates both directions and returns any profitable opportunities.
 */
export function detectArb(
  pmOrderbook: { yesAsk: number | null; noAsk: number | null },
  kalshiOrderbook: { yesAsk: number | null; noAsk: number | null },
  sizeUSD: number,
  costParams: CostModelParams = DEFAULT_COST_PARAMS,
): ArbCheckResult[] {
  const results: ArbCheckResult[] = [];

  // Direction A: Buy YES on PM + Buy NO on Kalshi
  if (pmOrderbook.yesAsk !== null && kalshiOrderbook.noAsk !== null) {
    const resultA = checkArbDirection(
      pmOrderbook.yesAsk,
      kalshiOrderbook.noAsk,
      sizeUSD,
      costParams,
      'BUY_YES_PM_BUY_NO_KALSHI',
    );
    if (resultA.isArb) results.push(resultA);
  }

  // Direction B: Buy NO on PM + Buy YES on Kalshi
  if (pmOrderbook.noAsk !== null && kalshiOrderbook.yesAsk !== null) {
    const resultB = checkArbDirection(
      kalshiOrderbook.yesAsk,
      pmOrderbook.noAsk,
      sizeUSD,
      costParams,
      'BUY_NO_PM_BUY_YES_KALSHI',
    );
    if (resultB.isArb) results.push(resultB);
  }

  return results;
}
