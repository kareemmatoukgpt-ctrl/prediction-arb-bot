export interface FeedOpportunity {
  id: string;
  mapping_id: string;
  category: string;
  venue_a: string;
  venue_b: string;
  direction: string;
  label: string;
  pm_yes_ask: number | null;
  pm_no_ask: number | null;
  kalshi_yes_ask: number | null;
  kalshi_no_ask: number | null;
  total_cost: number;
  expected_profit_usd: number;
  expected_profit_bps: number;
  size_usd: number;
  liquidity_score: number;
  expiry_ts: number | null;
  mapping_kind: string | null;
  suspect: number;
  suspect_reasons: string | null;
  arb_type: string | null;
  pm_market_url: string | null;
  kalshi_market_url: string | null;
  type_risk: string | null;
  ts_updated: string;
}

export interface FeedStats {
  totalProfit: number;
  count: number;
  maxEdgeBps: number;
  suspectCount: number;
  byCategory: { category: string; count: number; total_profit: number; max_edge_bps: number }[];
}

export interface PaperTradeResult {
  id: string;
  opportunityId: string;
  status: 'SIMULATED' | 'FAILED';
  simParams: { latencyMs: number; slippageModel: string; slippageBps: number; fillModel: string };
  result: {
    filledYes: boolean;
    filledNo: boolean;
    avgPriceYes: number;
    avgPriceNo: number;
    pnl: number;
    failureReason: string | null;
  };
}

export interface Market {
  id: string;
  venue: 'POLYMARKET' | 'KALSHI';
  venue_market_id: string;
  question: string;
  url: string;
  status: string;
  asset: string | null;
  expiry_ts: number | null;
  predicate_direction: string | null;
  predicate_threshold: number | null;
  predicate_type: string | null;
  category: string | null;
}

export interface Mapping {
  id: string;
  polymarket_market_id: string;
  kalshi_market_id: string;
  label: string;
  confidence: number;
  enabled: number;
  mapping_kind: string | null;
}

export interface PaperTradeStats {
  totalTrades: number;
  simulated: number;
  failed: number;
  totalPnl: number;
  avgPnl: number;
}
