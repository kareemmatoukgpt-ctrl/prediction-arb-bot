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
export const getMarkets = (venue?: string) =>
  fetchApi(`/api/markets${venue ? `?venue=${venue}` : ''}`);
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
