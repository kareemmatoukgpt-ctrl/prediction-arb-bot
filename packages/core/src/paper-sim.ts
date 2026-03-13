import { ArbCheckResult } from './arb-math';
import { PaperTradeResult, SimParams } from './types';

/**
 * Simulate execution of an arb opportunity with configurable
 * latency, slippage, and fill models.
 */
export function simulateExecution(
  arb: ArbCheckResult,
  simParams: SimParams,
): PaperTradeResult {
  // Simulate latency (random within range, though in paper we just note it)
  const latencyMs = simParams.latencyMs;

  // Simulate slippage
  const slippageMult = 1 + simParams.slippageBps / 10_000;
  const adjustedCostYes = arb.costYes * slippageMult;
  const adjustedCostNo = arb.costNo * slippageMult;

  // Simulate partial fills
  const fillSuccess =
    simParams.fillModel === 'full' ? true : Math.random() > 0.15;

  if (!fillSuccess) {
    return {
      filledYes: Math.random() > 0.5,
      filledNo: false,
      avgPriceYes: adjustedCostYes,
      avgPriceNo: adjustedCostNo,
      pnl: 0,
      failureReason: 'Partial fill: one leg failed to execute',
    };
  }

  // Simulate price movement during legging delay
  const priceMovement = (Math.random() - 0.5) * 0.005; // ±0.25% random walk
  const finalCostYes = adjustedCostYes + priceMovement;
  const finalCostNo = adjustedCostNo - priceMovement;

  const totalCost = finalCostYes + finalCostNo;
  const payout = 1.0;
  const pnl = payout - totalCost;

  // Check if slippage + movement killed the arb
  if (pnl <= 0) {
    return {
      filledYes: true,
      filledNo: true,
      avgPriceYes: finalCostYes,
      avgPriceNo: finalCostNo,
      pnl,
      failureReason: `Negative PnL after slippage: ${pnl.toFixed(4)}`,
    };
  }

  return {
    filledYes: true,
    filledNo: true,
    avgPriceYes: finalCostYes,
    avgPriceNo: finalCostNo,
    pnl,
    failureReason: null,
  };
}
