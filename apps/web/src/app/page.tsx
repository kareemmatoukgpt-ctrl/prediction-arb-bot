'use client';

import { useEffect, useState } from 'react';
import { getMappings, getOpportunities, getPaperStats } from '@/lib/api';
import Link from 'next/link';

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [mappingCount, setMappingCount] = useState(0);
  const [recentOpps, setRecentOpps] = useState<any[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [mappings, opps, paperStats] = await Promise.all([
          getMappings().catch(() => []),
          getOpportunities({ limit: 5 }).catch(() => []),
          getPaperStats().catch(() => null),
        ]);
        setMappingCount(mappings.length);
        setRecentOpps(opps);
        setStats(paperStats);
      } catch (err: any) {
        setError(err.message);
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div className="page-header">
        <h1>Dashboard</h1>
        <span className="badge badge-yellow">V1 Paper Trading</span>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}>{error}</div>}

      <div className="stats-grid">
        <div className="card stat-card">
          <div className="stat-value">{mappingCount}</div>
          <div className="stat-label">Active Mappings</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{recentOpps.length}</div>
          <div className="stat-label">Recent Opportunities</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{stats?.totalTrades || 0}</div>
          <div className="stat-label">Paper Trades</div>
        </div>
        <div className="card stat-card">
          <div className={`stat-value ${(stats?.totalPnl || 0) >= 0 ? 'profit' : 'loss'}`}>
            ${(stats?.totalPnl || 0).toFixed(2)}
          </div>
          <div className="stat-label">Total Paper PnL</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>Recent Opportunities</h2>
        {recentOpps.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No opportunities yet. <Link href="/mappings">Add a mapping</Link> to start scanning.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Direction</th>
                <th>Edge (bps)</th>
                <th>Profit (USD)</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {recentOpps.map((opp: any) => (
                <tr key={opp.id}>
                  <td>{opp.mapping_label}</td>
                  <td>
                    <span className="badge badge-blue" style={{ fontSize: '0.7rem' }}>
                      {opp.direction === 'BUY_YES_PM_BUY_NO_KALSHI' ? 'YES PM / NO K' : 'NO PM / YES K'}
                    </span>
                  </td>
                  <td className="profit">{opp.expected_profit_bps}</td>
                  <td className="profit">${opp.expected_profit_usd?.toFixed(2)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{new Date(opp.ts).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
