const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchApi(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

// Mappings
export const getMappings = () => fetchApi('/api/mappings');
export const createMapping = (data: {
  polymarketMarketId: string;
  kalshiMarketId: string;
  label: string;
}) => fetchApi('/api/mappings', { method: 'POST', body: JSON.stringify(data) });
export const toggleMapping = (id: string) =>
  fetchApi(`/api/mappings/${id}/toggle`, { method: 'POST' });
export const deleteMapping = (id: string) =>
  fetchApi(`/api/mappings/${id}`, { method: 'DELETE' });

// Markets
export const getMarkets = (params?: {
  venue?: string; asset?: string; category?: string; search?: string; limit?: number; structured?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.venue) qs.set('venue', params.venue);
  if (params?.asset) qs.set('asset', params.asset);
  if (params?.category) qs.set('category', params.category);
  if (params?.search) qs.set('search', params.search);
  if (params?.limit != null) qs.set('limit', String(params.limit));
  if (params?.structured) qs.set('structured', params.structured);
  return fetchApi(`/api/markets?${qs}`);
};
export const refreshMarkets = () =>
  fetchApi('/api/markets/refresh', { method: 'POST' });

// Opportunities
export const getOpportunities = (params?: {
  limit?: number;
  minEdgeBps?: number;
  direction?: string;
}) => {
  const search = new URLSearchParams();
  if (params?.limit) search.set('limit', String(params.limit));
  if (params?.minEdgeBps) search.set('minEdgeBps', String(params.minEdgeBps));
  if (params?.direction) search.set('direction', params.direction);
  const qs = search.toString();
  return fetchApi(`/api/opportunities${qs ? `?${qs}` : ''}`);
};
export const scanOpportunities = () =>
  fetchApi('/api/opportunities/scan', { method: 'POST' });

// Demo
export const seedDemo = () => fetchApi('/api/demo/seed', { method: 'POST' });
export const resetDemo = () => fetchApi('/api/demo/reset', { method: 'POST' });

// Paper trades
export const getPaperTrades = (limit?: number) =>
  fetchApi(`/api/paper-trades${limit ? `?limit=${limit}` : ''}`);
export const getPaperStats = () => fetchApi('/api/paper-trades/stats');
export const executePaperTrade = (opportunityId: string) =>
  fetchApi('/api/paper-trades/execute', {
    method: 'POST',
    body: JSON.stringify({ opportunityId }),
  });

// ── Crypto / Suggestions ──────────────────────────────────────────────────────

export const ingestCrypto = () =>
  fetchApi('/api/markets/ingest/crypto', { method: 'POST' });

export const ingestFed = () =>
  fetchApi('/api/markets/ingest/fed', { method: 'POST' });

export const ingestMacro = () =>
  fetchApi('/api/markets/ingest/macro', { method: 'POST' });

export const getSuggestions = (params: {
  asset?: string; minScore?: number; status?: string; bucket?: string; limit?: number;
} = {}) => {
  const qs = new URLSearchParams();
  if (params.asset) qs.set('asset', params.asset);
  if (params.minScore != null) qs.set('minScore', String(params.minScore));
  if (params.status) qs.set('status', params.status);
  if (params.bucket) qs.set('bucket', params.bucket);
  if (params.limit != null) qs.set('limit', String(params.limit));
  return fetchApi(`/api/suggestions?${qs}`);
};

export const generateSuggestions = () =>
  fetchApi('/api/suggestions/generate', { method: 'POST' });

export const runSmartMatch = () =>
  fetchApi('/api/suggestions/smart-match', { method: 'POST' });

export const compareSuggestion = (pmQuestion: string, kalshiQuestion: string) =>
  fetchApi('/api/suggestions/compare', {
    method: 'POST',
    body: JSON.stringify({ pmQuestion, kalshiQuestion }),
  });

export const approveSuggestion = (id: string) =>
  fetchApi(`/api/suggestions/${id}/approve`, { method: 'POST' });

export const rejectSuggestion = (id: string) =>
  fetchApi(`/api/suggestions/${id}/reject`, { method: 'POST' });

// ── Opportunity Feed ──────────────────────────────────────────────────────────

export const getFeed = (params: {
  category?: string; minEdgeBps?: number; minProfitUsd?: number;
  sort?: string; hideSuspect?: boolean; hideUnverified?: boolean; limit?: number;
} = {}) => {
  const qs = new URLSearchParams();
  if (params.category) qs.set('category', params.category);
  if (params.minEdgeBps != null) qs.set('minEdgeBps', String(params.minEdgeBps));
  if (params.minProfitUsd != null) qs.set('minProfitUsd', String(params.minProfitUsd));
  if (params.sort) qs.set('sort', params.sort);
  if (params.hideSuspect != null) qs.set('hideSuspect', String(params.hideSuspect));
  if (params.hideUnverified != null) qs.set('hideUnverified', String(params.hideUnverified));
  if (params.limit != null) qs.set('limit', String(params.limit));
  return fetchApi(`/api/feed?${qs}`);
};

export const getFeedItem = (id: string) => fetchApi(`/api/feed/${id}`);
export const getFeedStats = () => fetchApi('/api/feed/stats');
