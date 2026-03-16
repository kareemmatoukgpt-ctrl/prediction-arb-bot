'use client';

import { useEffect, useState } from 'react';
import { getFeedStats } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`${API_BASE}/api/feed/health`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export default function DiagnosticsPage() {
  const [health, setHealth] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [h, s] = await Promise.all([fetchHealth(), getFeedStats()]);
      setHealth(h);
      setStats(s);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to load diagnostics');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); const iv = setInterval(load, 15000); return () => clearInterval(iv); }, []);

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading diagnostics...</div>;

  return (
    <>
      <div className="page-header">
        <h1>Pipeline Diagnostics</h1>
        <button className="btn btn-primary" onClick={() => { setLoading(true); load(); }}>Refresh</button>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--red)', marginBottom: '1rem' }}>{error}</div>}

      {/* Feed Stats */}
      {stats && (
        <>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--text-muted)' }}>Active Opportunities</h2>
          <div className="stats-grid">
            <div className="card stat-card">
              <div className="stat-value profit">${stats.totalProfit?.toFixed(2)}</div>
              <div className="stat-label">Total Profit</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{stats.count}</div>
              <div className="stat-label">Opportunities</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{stats.maxEdgeBps}</div>
              <div className="stat-label">Max Edge (bps)</div>
            </div>
            <div className="card stat-card">
              <div className="stat-value" style={{ color: 'var(--yellow)' }}>{stats.suspectCount}</div>
              <div className="stat-label">Suspect</div>
            </div>
          </div>
        </>
      )}

      {health && (
        <>
          {/* Markets */}
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '1.5rem 0 0.75rem', color: 'var(--text-muted)' }}>Markets Ingested</h2>
          <div className="stats-grid">
            {Object.entries(health.markets || {}).map(([venue, data]: [string, any]) => (
              <div key={venue} className="card stat-card">
                <div className="stat-value">{data.total?.toLocaleString()}</div>
                <div className="stat-label">{venue}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.4rem' }}>
                  {data.close_at > 0 && <span>CLOSE_AT: {data.close_at} </span>}
                  {data.touch_by > 0 && <span>TOUCH_BY: {data.touch_by} </span>}
                  {data.binary_event > 0 && <span>EVENT: {data.binary_event}</span>}
                </div>
              </div>
            ))}
            <div className="card stat-card">
              <div className="stat-value">{health.eventGroups?.toLocaleString()}</div>
              <div className="stat-label">Event Groups</div>
            </div>
          </div>

          {/* By Category */}
          {health.marketsByCategory?.length > 0 && (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '1.5rem 0 0.75rem', color: 'var(--text-muted)' }}>Markets by Category</h2>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table>
                  <thead>
                    <tr><th>Category</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    {health.marketsByCategory.map((c: any) => (
                      <tr key={c.category}>
                        <td><span className="badge badge-purple">{c.category}</span></td>
                        <td>{c.cnt?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Pipeline Status */}
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '1.5rem 0 0.75rem', color: 'var(--text-muted)' }}>Pipeline Status</h2>
          <div className="stats-grid">
            <div className="card stat-card">
              <div className="stat-value">{health.mappings?.total}</div>
              <div className="stat-label">Total Mappings</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                {health.mappings?.enabled} enabled, {health.mappings?.with_snapshots} with snapshots
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{health.suggestions?.arb_eligible}</div>
              <div className="stat-label">Arb-eligible Suggestions</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                {health.suggestions?.total?.toLocaleString()} total
              </div>
            </div>
            <div className="card stat-card">
              <div className="stat-value">{health.opportunities?.total}</div>
              <div className="stat-label">Active Opportunities</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                {health.opportunities?.non_suspect} non-suspect
              </div>
            </div>
          </div>

          {/* Opportunities by Category */}
          {health.opportunities?.byCategory?.length > 0 && (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '1.5rem 0 0.75rem', color: 'var(--text-muted)' }}>Opportunities by Category</h2>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table>
                  <thead>
                    <tr><th>Category</th><th>Total</th><th>Non-suspect</th></tr>
                  </thead>
                  <tbody>
                    {health.opportunities.byCategory.map((c: any) => (
                      <tr key={c.category}>
                        <td><span className="badge badge-purple">{c.category}</span></td>
                        <td>{c.cnt}</td>
                        <td style={{ color: 'var(--green)' }}>{c.non_suspect}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Opportunities by Arb Type */}
          {health.opportunities?.byArbType?.length > 0 && (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '1.5rem 0 0.75rem', color: 'var(--text-muted)' }}>Opportunities by Type</h2>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table>
                  <thead>
                    <tr><th>Arb Type</th><th>Count</th></tr>
                  </thead>
                  <tbody>
                    {health.opportunities.byArbType.map((t: any) => (
                      <tr key={t.arb_type}>
                        <td><span className="badge badge-blue">{t.arb_type}</span></td>
                        <td>{t.cnt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
