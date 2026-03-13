'use client';

import { useEffect, useState } from 'react';
import { getPaperTrades, getPaperStats } from '@/lib/api';

export default function PaperTradingPage() {
  const [trades, setTrades] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [tradeData, statsData] = await Promise.all([
        getPaperTrades(100),
        getPaperStats(),
      ]);
      setTrades(tradeData);
      setStats(statsData);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); }, []);

  return (
    <>
      <div className="page-header">
        <h1>Paper Trading</h1>
        <span className="badge badge-yellow">Simulation Only</span>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}>{error}</div>}

      {stats && (
        <div className="stats-grid">
          <div className="card stat-card">
            <div className="stat-value">{stats.totalTrades}</div>
            <div className="stat-label">Total Trades</div>
          </div>
          <div className="card stat-card">
            <div className="stat-value" style={{ color: 'var(--green)' }}>{stats.simulated}</div>
            <div className="stat-label">Successful</div>
          </div>
          <div className="card stat-card">
            <div className="stat-value" style={{ color: 'var(--red)' }}>{stats.failed}</div>
            <div className="stat-label">Failed</div>
          </div>
          <div className="card stat-card">
            <div className={`stat-value ${stats.totalPnl >= 0 ? 'profit' : 'loss'}`}>
              ${stats.totalPnl.toFixed(2)}
            </div>
            <div className="stat-label">Total PnL</div>
          </div>
          <div className="card stat-card">
            <div className={`stat-value ${stats.avgPnl >= 0 ? 'profit' : 'loss'}`}>
              ${stats.avgPnl.toFixed(4)}
            </div>
            <div className="stat-label">Avg PnL per Trade</div>
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Trade History</h2>
        {trades.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No paper trades yet. Go to Opportunities and click &quot;Simulate Execute&quot; to run a paper trade.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Direction</th>
                <th>Status</th>
                <th>YES Price</th>
                <th>NO Price</th>
                <th>PnL</th>
                <th>Latency</th>
                <th>Slippage</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t: any) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 500 }}>{t.mapping_label || '-'}</td>
                  <td>
                    <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
                      {t.direction === 'BUY_YES_PM_BUY_NO_KALSHI' ? 'YES PM / NO K' : 'NO PM / YES K'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${t.status === 'SIMULATED' ? 'badge-green' : 'badge-red'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td>${t.result?.avgPriceYes?.toFixed(4)}</td>
                  <td>${t.result?.avgPriceNo?.toFixed(4)}</td>
                  <td className={t.result?.pnl >= 0 ? 'profit' : 'loss'}>
                    ${t.result?.pnl?.toFixed(4)}
                  </td>
                  <td>{t.sim_params?.latencyMs?.toFixed(0)}ms</td>
                  <td>{t.sim_params?.slippageBps} bps</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {new Date(t.ts).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
