import {
  ArbDirection,
  ArbOpportunity,
  CostModelParams,
  SimpleOrderbook,
} from './types';

/** Default cost model for V1 paper trading */
export const DEFAULT_COST_PARAMS: CostModelParams = {
  takerFeeBps: 0, // Polymarket: 0 taker fee on CLOB; Kalshi: varies
  makerFeeBps: 0,
  polymarketGasCost: 0, // paper trading: no gas
  kalshiFee: 0, // simplified for paper
  bufferBps: 50,
};

/**
 * Estimate all-in cost for one side of a binary outcome purchase.
 * Returns the effective price including fees.
 */
export function estimateAllInCost(
  rawPrice: number,
  sizeUSD: number,
  params: CostModelParams,
): number {
  const takerFee = rawPrice * (params.takerFeeBps / 10_000);
  const slippageEstimate = rawPrice * (params.bufferBps / 10_000);
  return rawPrice + takerFee + slippageEstimate;
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
 * If total cost < 1 (payout) minus buffer, it's an arb.
 */
export function checkArbDirection(
  yesAsk: number,
  noAsk: number,
  sizeUSD: number,
  costParams: CostModelParams,
  direction: ArbDirection,
): ArbCheckResult {
  const yesCostRaw = yesAsk;
  const noCostRaw = noAsk;

  const yesFee = yesCostRaw * (costParams.takerFeeBps / 10_000);
  const noFee = noCostRaw * (costParams.takerFeeBps / 10_000);
  const feesEstimate = (yesFee + noFee) * sizeUSD;

  const buffer = costParams.bufferBps / 10_000;
  const slippageEstimate = (yesCostRaw + noCostRaw) * buffer * sizeUSD;

  const totalCostPerUnit =
    yesCostRaw + noCostRaw + yesFee + noFee + (yesCostRaw + noCostRaw) * buffer;

  const payout = 1.0; // binary outcome pays $1
  const profitPerUnit = payout - totalCostPerUnit;
  const expectedProfitUSD = profitPerUnit * sizeUSD;
  const expectedProfitBps = Math.round(profitPerUnit * 10_000);

  return {
    isArb: totalCostPerUnit < payout,
    direction,
    costYes: yesCostRaw,
    costNo: noCostRaw,
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
