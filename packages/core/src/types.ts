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
  /** Polymarket taker fee in basis points (1 bps = 0.01%) */
  polymarketTakerFeeBps: number;
  /** Kalshi taker fee in basis points */
  kalshiTakerFeeBps: number;
  /** Expected execution slippage per side in basis points */
  slippageBps: number;
  /** Minimum edge required to flag as arb, in basis points */
  arbThresholdBps: number;
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

// ── Market fields ──
export type CryptoAsset = 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'DOGE' | 'ENA' | 'FED_RATE' | 'CPI' | 'GDP';
export type MarketAsset = CryptoAsset | string; // event markets use dynamic asset names

export type PredicateType = 'CLOSE_AT' | 'TOUCH_BY' | 'BINARY_EVENT';

export interface CryptoFields {
  asset: CryptoAsset | string;
  expiryTs: number | null;
  predicateDirection: 'ABOVE' | 'BELOW' | null;
  predicateThreshold: number | null;
  predicateType: PredicateType;
}

// ── Category ──
export type Category = 'CRYPTO' | 'FED' | 'MACRO' | 'EVENT';

// ── Mapping Kind ──
export type MappingKind = 'manual_unverified' | 'crypto_arb_eligible' | 'auto_approved';

// ── Opportunity Feed ──
export interface FeedOpportunity {
  id: string;
  mappingId: string;
  category: Category;
  venueA: string;
  venueB: string;
  direction: ArbDirection;
  label: string;
  pmYesAsk: number | null;
  pmNoAsk: number | null;
  kalshiYesAsk: number | null;
  kalshiNoAsk: number | null;
  totalCost: number | null;
  expectedProfitUsd: number | null;
  expectedProfitBps: number | null;
  sizeUsd: number;
  maxFillUsd: number | null;
  liquidityScore: number;
  expiryTs: number | null;
  mappingKind: MappingKind | null;
  suspect: boolean;
  suspectReasons: string | null;
  pmMarketUrl: string | null;
  kalshiMarketUrl: string | null;
  debugJson: string | null;
  tsUpdated: string;
}

// ── Mapping suggestion ──
export type SuggestionBucket = 'arb_eligible' | 'research';
export type SuggestionStatus = 'suggested' | 'approved' | 'rejected';

export interface MappingSuggestion {
  id: string;
  polymarketMarketId: string;
  kalshiMarketId: string;
  score: number;
  reasonsJson: string;
  bucket: SuggestionBucket;
  status: SuggestionStatus;
  expiryDeltaSeconds: number | null;
  thresholdDeltaPct: number | null;
  createdAt: string;
  updatedAt: string;
}
