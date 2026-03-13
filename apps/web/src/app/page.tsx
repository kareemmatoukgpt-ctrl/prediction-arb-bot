'use client';

import { useEffect, useState } from 'react';
import { getMappings, getOpportunities, getPaperStats, seedDemo } from '@/lib/api';
import Link from 'next/link';

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [mappingCount, setMappingCount] = useState<number | null>(null);
  const [recentOpps, setRecentOpps] = useState<any[]>([]);
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'down'>('checking');
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState('');

  async function load() {
    try {
      const [mappings, opps, paperStats] = await Promise.all([
        getMappings(),
        getOpportunities({ limit: 5 }),
        getPaperStats(),
      ]);
      setMappingCount(mappings.length);
      setRecentOpps(opps);
      setStats(paperStats);
      setApiStatus('ok');
    } catch {
      setApiStatus('down');
    }
  }

  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, []);

  async function handleSeedDemo() {
    setSeeding(true);
    setSeedMsg('');
    try {
      const result = await seedDemo();
      setSeedMsg(result.message);
      await load();
    } catch (err: any) {
      setSeedMsg('Error: ' + err.message);
    }
    setSeeding(false);
  }

  return (
    <>
      <div className="page-header">
        <h1>Prediction Arb Bot</h1>
        <span className="badge badge-yellow">V1 — Paper Trading</span>
      </div>

      {/* API Status Banner */}
      {apiStatus === 'down' && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: '1rem' }}>
          <strong style={{ color: 'var(--red)' }}>API server is not running</strong>
          <p style={{ fontSize: '0.85rem', marginTop: '0.4rem', color: 'var(--text-muted)' }}>
            Start it in a terminal:{' '}
            <code style={{ background: '#1a1a1a', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
              npm run dev:api
            </code>{' '}
            from the project root. Then refresh this page.
          </p>
        </div>
      )}

      {/* How it works + demo seed */}
      {apiStatus === 'ok' && mappingCount === 0 && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--accent)' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>How this works</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.7' }}>
            <strong style={{ color: 'var(--text)' }}>Polymarket</strong> and{' '}
            <strong style={{ color: 'var(--text)' }}>Kalshi</strong> are two separate prediction market
            platforms. The same real-world question exists on both — e.g. &quot;Will the Fed cut rates in
            June?&quot; — but at slightly different prices.
            <br /><br />
            A <strong style={{ color: 'var(--text)' }}>mapping</strong> tells the bot which market on
            Polymarket equals which market on Kalshi. Once mapped, the bot watches both orderbooks and
            detects <strong style={{ color: 'var(--text)' }}>arbitrage</strong>: if buying YES on one side
            + NO on the other costs less than $1 total, that&apos;s a risk-free profit (since exactly one
            side always pays out $1).
          </p>
          <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button className="btn btn-primary" onClick={handleSeedDemo} disabled={seeding}>
              {seeding ? 'Loading...' : 'Load Demo Data (3 market pairs)'}
            </button>
            {seedMsg && (
              <span style={{ fontSize: '0.85rem', color: 'var(--green)' }}>{seedMsg}</span>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      {apiStatus === 'ok' && (
        <div className="stats-grid">
          <div className="card stat-card">
            <div className="stat-value">{mappingCount ?? '—'}</div>
            <div className="stat-label">Mapped Market Pairs</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Polymarket ↔ Kalshi
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-value">{recentOpps.length}</div>
            <div className="stat-label">Active Opportunities</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Arb detected right now
            </div>
          </div>
          <div className="card stat-card">
            <div className="stat-value">{stats?.totalTrades ?? 0}</div>
            <div className="stat-label">Paper Trades Run</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Simulated executions
            </div>
          </div>
          <div className="card stat-card">
            <div className={`stat-value ${(stats?.totalPnl || 0) >= 0 ? 'profit' : 'loss'}`}>
              ${(stats?.totalPnl || 0).toFixed(2)}
            </div>
            <div className="stat-label">Simulated PnL</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Paper trading only
            </div>
          </div>
        </div>
      )}

      {/* Live opportunities table */}
      {apiStatus === 'ok' && recentOpps.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1rem' }}>Live Arb Opportunities</h2>
            <Link href="/opportunities" style={{ fontSize: '0.8rem' }}>View all →</Link>
          </div>
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Strategy</th>
                <th title="sum of YES + NO ask prices; must be < $1.00 for arb">Total Cost</th>
                <th>Edge (bps)</th>
                <th>Profit ($100 size)</th>
                <th>Detected</th>
              </tr>
            </thead>
            <tbody>
              {recentOpps.map((opp: any) => (
                <tr key={opp.id}>
                  <td style={{ fontWeight: 500 }}>{opp.mapping_label}</td>
                  <td>
                    <span className="badge badge-blue" style={{ fontSize: '0.68rem' }}>
                      {opp.direction === 'BUY_YES_PM_BUY_NO_KALSHI'
                        ? 'YES on Poly / NO on Kalshi'
                        : 'NO on Poly / YES on Kalshi'}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>
                    ${(opp.cost_yes + opp.cost_no).toFixed(3)}
                    <span style={{ color: 'var(--text-muted)' }}> / $1.00</span>
                  </td>
                  <td className="profit">{opp.expected_profit_bps}</td>
                  <td className="profit">${opp.expected_profit_usd?.toFixed(2)}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {new Date(opp.ts).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            Go to <Link href="/opportunities">Opportunities</Link> → click &quot;Simulate Execute&quot; to run a paper trade.
          </p>
        </div>
      )}

      {apiStatus === 'ok' && mappingCount !== null && mappingCount > 0 && recentOpps.length === 0 && (
        <div className="card">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No arb opportunities detected yet. The scanner runs every 5 seconds.{' '}
            Go to <Link href="/opportunities">Opportunities</Link> and click &quot;Scan Now&quot; to force a check.
          </p>
        </div>
      )}

      {/* Nav cards */}
      {apiStatus === 'ok' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '0.5rem' }}>
          {[
            { href: '/mappings', icon: '🗺', title: 'Mappings', sub: 'Configure which markets to watch' },
            { href: '/opportunities', icon: '⚡', title: 'Opportunities', sub: 'Live arb feed + simulate execute' },
            { href: '/paper', icon: '📊', title: 'Paper Trading', sub: 'Simulated trade history & PnL' },
          ].map((card) => (
            <Link key={card.href} href={card.href} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ textAlign: 'center', cursor: 'pointer' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.3rem' }}>{card.icon}</div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{card.title}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{card.sub}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
