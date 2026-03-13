// ── Venue ──
export type Venue = 'POLYMARKET' | 'KALSHI';

// ── Market ──
export interface CanonicalMarket {
  id: string;
  venue: Venue;
  venueMarketId: string;
  question: string;
  outcomeType: 'BINARY';
  yesTokenId?: string;
  noTokenId?: string;
  resolvesAt: string | null;
  resolutionSource: string | null;
  url: string;
  status: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
}

// ── Orderbook ──
export interface OrderbookSnapshot {
  id: string;
  marketId: string;
  ts: string;
  bestYesBid: number | null;
  bestYesAsk: number | null;
  bestNoBid: number | null;
  bestNoAsk: number | null;
  depthJson: string | null;
  rawJson: string | null;
}

// ── Mapping ──
export interface MatchMapping {
  id: string;
  polymarketMarketId: string;
  kalshiMarketId: string;
  label: string;
  confidence: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Arb Direction ──
export type ArbDirection =
  | 'BUY_YES_PM_BUY_NO_KALSHI'
  | 'BUY_NO_PM_BUY_YES_KALSHI';

// ── Arb Opportunity ──
export interface ArbOpportunity {
  id: string;
  ts: string;
  mappingId: string;
  direction: ArbDirection;
  sizeUSD: number;
  costYes: number;
  costNo: number;
  feesEstimate: number;
  slippageEstimate: number;
  bufferBps: number;
  expectedProfitUSD: number;
  expectedProfitBps: number;
  notes: string;
}

// ── Paper Trade ──
export type PaperTradeStatus = 'SIMULATED' | 'FAILED';

export interface SimParams {
  latencyMs: number;
  slippageModel: 'fixed_bps' | 'depth_based';
  slippageBps: number;
  fillModel: 'full' | 'partial';
}

export interface PaperTradeResult {
  filledYes: boolean;
  filledNo: boolean;
  avgPriceYes: number;
  avgPriceNo: number;
  pnl: number;
  failureReason: string | null;
}

export interface PaperTrade {
  id: string;
  opportunityId: string;
  ts: string;
  simParams: SimParams;
  result: PaperTradeResult;
  status: PaperTradeStatus;
}

// ── Cost Model Params ──
export interface CostModelParams {
  takerFeeBps: number;
  makerFeeBps: number;
  polymarketGasCost: number;
  kalshiFee: number;
  bufferBps: number;
}

// ── Orderbook for arb calculation ──
export interface OrderbookSide {
  price: number;
  size: number;
}

export interface SimpleOrderbook {
  bids: OrderbookSide[];
  asks: OrderbookSide[];
}
