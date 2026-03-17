'use client';

import { useEffect, useState } from 'react';
import { sportsApi } from '@/lib/sports-api';
import Link from 'next/link';

function SportBadge({ sport }: { sport: string }) {
  const colors: Record<string, string> = {
    NBA: 'badge-purple',
    NFL: 'badge-green',
    NHL: 'badge-blue',
    MLB: 'badge-red',
    UFC: 'badge-red',
    SOCCER: 'badge-green',
    GOLF: 'badge-green',
    NCAAB: 'badge-yellow',
  };
  return <span className={`badge ${colors[sport] || 'badge-blue'}`}>{sport}</span>;
}

function BetTypeBadge({ betType }: { betType: string }) {
  const colors: Record<string, string> = {
    MONEYLINE: 'badge-purple',
    SPREAD: 'badge-blue',
    TOTAL: 'badge-yellow',
    PROP: 'badge-red',
  };
  return (
    <span className={`badge ${colors[betType] || 'badge-blue'}`} style={{ fontSize: '0.6rem' }}>
      {betType}
    </span>
  );
}

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SportsPage() {
  const [arbs, setArbs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [sport, setSport] = useState('');
  const [betType, setBetType] = useState('');
  const [minEdge, setMinEdge] = useState(0);
  const [loading, setLoading] = useState(true);
  const [apiOk, setApiOk] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const [arbData, statsData] = await Promise.all([
        sportsApi.getArbs({
          sport: sport || undefined,
          bet_type: betType || undefined,
          min_edge: minEdge || undefined,
          limit: 50,
        }),
        sportsApi.getStats(),
      ]);
      setArbs(Array.isArray(arbData) ? arbData : []);
      setStats(statsData);
      setApiOk(true);
    } catch {
      setApiOk(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport, betType, minEdge]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await sportsApi.refresh();
      await load();
    } catch {
      // ignore
    }
    setRefreshing(false);
  }

  return (
    <>
      {/* Header with stats */}
      <div style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>
        <div className="feed-total-label">Sports Arbitrage</div>
        <div className="feed-total profit">
          ${stats?.total_profit_usd?.toFixed(2) ?? '0.00'}
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats?.total_arbs ?? 0}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>active arbs</span>
          </div>
          <div>
            <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats?.total_events ?? 0}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>events</span>
          </div>
          <div>
            <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats?.total_markets ?? 0}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>markets</span>
          </div>
          <div>
            <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats?.best_edge_bps ?? 0}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>best edge (bps)</span>
          </div>
          {stats?.by_sport?.map((s: any) => (
            <div key={s.sport}>
              <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{s.arbs}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>{s.sport}</span>
            </div>
          ))}
        </div>
      </div>

      {/* API down banner */}
      {!apiOk && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: '1rem' }}>
          <strong style={{ color: 'var(--red)' }}>API server is not responding</strong>
          <p style={{ fontSize: '0.82rem', marginTop: '0.3rem', color: 'var(--text-muted)' }}>
            Showing last known data. Make sure the API is running on port 3001.
          </p>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar">
        <select value={sport} onChange={(e) => setSport(e.target.value)}>
          <option value="">All Sports</option>
          <option value="NBA">NBA</option>
          <option value="NFL">NFL</option>
          <option value="NHL">NHL</option>
          <option value="MLB">MLB</option>
          <option value="UFC">UFC</option>
          <option value="SOCCER">Soccer</option>
          <option value="GOLF">Golf</option>
          <option value="NCAAB">NCAAB</option>
        </select>
        <select value={betType} onChange={(e) => setBetType(e.target.value)}>
          <option value="">All Bet Types</option>
          <option value="MONEYLINE">Moneyline</option>
          <option value="SPREAD">Spread</option>
          <option value="TOTAL">Total</option>
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <label style={{ margin: 0, display: 'inline', fontSize: '0.72rem' }}>Min edge:</label>
          <input
            type="number"
            value={minEdge}
            onChange={(e) => setMinEdge(parseInt(e.target.value) || 0)}
            style={{ width: '70px' }}
            placeholder="bps"
          />
        </div>
        <button className="btn btn-sm" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
        <Link href="/sports/events">
          <button className="btn btn-sm btn-ghost">Browse Events</button>
        </Link>
      </div>

      {/* Arb cards */}
      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading sports arbs...</div>
      ) : arbs.length === 0 ? (
        <div className="card empty-state">
          <h2>No sports arbitrage detected</h2>
          <p>
            The scanner checks Kalshi and Polymarket every 30 seconds for cross-venue sports arbs.
            Markets are refreshed every 60 seconds.
          </p>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <button className="btn btn-sm btn-primary" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Force Refresh'}
            </button>
            <Link href="/sports/events">
              <button className="btn btn-sm">Browse Events</button>
            </Link>
          </div>
        </div>
      ) : (
        <div>
          {arbs.map((arb: any) => (
            <Link key={arb.id} href={`/sports/events/${arb.event_id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card card-feed feed-card">
                <div className="feed-card-left">
                  <div className="feed-label">
                    <SportBadge sport={arb.sport} />{' '}
                    <span style={{ marginLeft: '0.4rem' }}>
                      {arb.home_team} vs {arb.away_team}
                    </span>
                  </div>
                  <div className="feed-direction" style={{ marginTop: '0.35rem' }}>
                    <BetTypeBadge betType={arb.bet_type} />
                    <span style={{ marginLeft: '0.5rem' }}>
                      <span className="venue-badge venue-pm">{arb.venue_a === 'POLYMARKET' ? 'PM' : 'K'} {arb.side_a}</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem', margin: '0 0.2rem' }}>/</span>
                      <span className="venue-badge venue-k">{arb.venue_b === 'KALSHI' ? 'K' : 'PM'} {arb.side_b}</span>
                    </span>
                  </div>
                  <div className="feed-meta">
                    <span className="feed-meta-item">{formatTime(arb.event_start_time)}</span>
                    <span className="feed-meta-item">
                      Cost: ${arb.combined_cost?.toFixed(3)} / $1.00
                    </span>
                  </div>
                </div>
                <div className="feed-card-right">
                  <div className="feed-profit">${arb.profit_usd?.toFixed(2)}</div>
                  <div className="feed-edge">{arb.edge_bps} bps</div>
                  <div className="feed-prices">
                    {arb.venue_a}: {(arb.price_a * 100)?.toFixed(1)}¢ / {arb.venue_b}: {(arb.price_b * 100)?.toFixed(1)}¢
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
