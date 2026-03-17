const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
}

function toQuery(params?: Record<string, any>): string {
  if (!params) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const sportsApi = {
  getEvents: (params?: { sport?: string; league?: string; date?: string; limit?: number }) =>
    fetchApi<any[]>('/api/sports/events' + toQuery(params)),

  getEvent: (id: string) =>
    fetchApi<any>(`/api/sports/events/${id}`),

  getArbs: (params?: { sport?: string; bet_type?: string; min_edge?: number; limit?: number }) =>
    fetchApi<any[]>('/api/sports/arbs' + toQuery(params)),

  getArb: (id: string) =>
    fetchApi<any>(`/api/sports/arbs/${id}`),

  getStats: () =>
    fetchApi<any>('/api/sports/stats'),

  refresh: () =>
    fetchApi<any>('/api/sports/refresh', { method: 'POST' }),

  getHealth: () =>
    fetchApi<any>('/api/sports/health'),
};
