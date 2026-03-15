'use client';

import { useEffect, useState, useRef } from 'react';
import { getFeed, getFeedStats, executePaperTrade } from '@/lib/api';
import Link from 'next/link';

function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, '');
}

function formatExpiry(ts: number | null): string {
  if (!ts) return '';
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff < 0) return 'expired';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function DirectionBadge({ direction }: { direction: string }) {
  if (direction === 'BUY_YES_PM_BUY_NO_KALSHI') {
    return (
      <span style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
        <span className="venue-badge venue-pm">PM YES</span>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>/</span>
        <span className="venue-badge venue-k">K NO</span>
      </span>
    );
  }
  return (
    <span style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
      <span className="venue-badge venue-pm">PM NO</span>
      <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem' }}>/</span>
      <span className="venue-badge venue-k">K YES</span>
    </span>
  );
}

export default function FeedPage() {
  const [opps, setOpps] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [category, setCategory] = useState('');
  const [minEdge, setMinEdge] = useState(0);
  const [sort, setSort] = useState('profit_desc');
  const [showSuspect, setShowSuspect] = useState(false);
  const [apiOk, setApiOk] = useState(true);
  const [executing, setExecuting] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const loadingRef = useRef(false);

  async function load() {
    // Prevent overlapping fetches
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      // Fetch feed and stats independently so one failure doesn't kill both
      const feedPromise = getFeed({
        category: category || undefined,
        minEdgeBps: minEdge || undefined,
        sort,
        hideSuspect: !showSuspect,
        limit: 50,
      });
      const statsPromise = getFeedStats();

      const feed = await feedPromise.catch(() => null);
      const feedStats = await statsPromise.catch(() => null);

      // Only update state if we got valid data — never clear on failure
      if (feed !== null) {
        setOpps(Array.isArray(feed) ? feed : []);
        setApiOk(true);
      }
      if (feedStats !== null) {
        setStats(feedStats);
        setApiOk(true);
      }
      if (feed === null && feedStats === null) {
        setApiOk(false);
      }
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, minEdge, sort, showSuspect]);

  async function handleSimulate(oppId: string) {
    setExecuting(oppId);
    setResult(null);
    try {
      const res = await executePaperTrade(oppId);
      setResult(res);
    } catch (err: any) {
      setResult({ status: 'FAILED', result: { pnl: 0, failureReason: err.message } });
    }
    setExecuting(null);
  }

  return (
    <>
      {/* Header banner */}
      <div style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>
        <div className="feed-total-label">Available Profit</div>
        <div className="feed-total profit">
          ${stats?.totalProfit?.toFixed(2) ?? '0.00'}
        </div>
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem' }}>
          <div>
            <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats?.count ?? 0}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>opportunities</span>
          </div>
          <div>
            <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{stats?.maxEdgeBps ?? 0}</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>max edge (bps)</span>
          </div>
          {stats?.byCategory?.length > 0 && stats.byCategory.map((c: any) => (
            <div key={c.category}>
              <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>{c.count}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>{c.category}</span>
            </div>
          ))}
          {stats?.suspectCount > 0 && (
            <div>
              <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--yellow)' }}>{stats.suspectCount}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.3rem' }}>suspect (hidden)</span>
            </div>
          )}
        </div>
      </div>

      {/* API down banner */}
      {!apiOk && (
        <div className="card" style={{ borderColor: 'var(--red)', marginBottom: '1rem' }}>
          <strong style={{ color: 'var(--red)' }}>API server is not responding</strong>
          <p style={{ fontSize: '0.82rem', marginTop: '0.3rem', color: 'var(--text-muted)' }}>
            Showing last known data. Run <code style={{ background: 'var(--bg-surface)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>npm run dev:api</code> from the project root.
          </p>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar">
        <select value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">All Categories</option>
          <option value="CRYPTO">Crypto</option>
          <option value="FED">FED</option>
          <option value="MACRO">Macro</option>
          <option value="EVENT">Event</option>
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <label style={{ margin: 0, display: 'inline', fontSize: '0.72rem' }}>Min edge:</label>
          <input
            type="number"
            value={minEdge}
            onChange={e => setMinEdge(parseInt(e.target.value) || 0)}
            style={{ width: '70px' }}
            placeholder="bps"
          />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="profit_desc">Profit (high to low)</option>
          <option value="profit_asc">Profit (low to high)</option>
          <option value="edge_desc">Edge (high to low)</option>
          <option value="expiry_asc">Expiry (soonest)</option>
          <option value="liquidity_desc">Liquidity (highest)</option>
        </select>
        <label style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.72rem' }}>
          <input type="checkbox" checked={showSuspect} onChange={e => setShowSuspect(e.target.checked)} />
          Show suspect
        </label>
      </div>

      {/* Paper trade result */}
      {result && (
        <div className="card" style={{ borderColor: result.status === 'SIMULATED' ? 'var(--green)' : 'var(--red)', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>
              Paper Trade: <span className={`badge ${result.status === 'SIMULATED' ? 'badge-green' : 'badge-red'}`}>{result.status}</span>
            </span>
            <span className={result.result?.pnl >= 0 ? 'profit' : 'loss'} style={{ fontSize: '1rem' }}>
              ${result.result?.pnl?.toFixed(4) ?? '0'}
            </span>
          </div>
          {result.result?.failureReason && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>{result.result.failureReason}</p>
          )}
        </div>
      )}

      {/* Feed cards */}
      {opps.length === 0 ? (
        <div className="card empty-state">
          <h2>No opportunities detected</h2>
          <p>
            The scanner runs every 5 seconds across all enabled mappings.
            {stats?.suspectCount > 0
              ? ` There are ${stats.suspectCount} suspect opportunities hidden — enable "Show suspect" to see them.`
              : ' Try going to Markets and clicking "Ingest Crypto" to discover markets, then Suggestions to generate matches.'}
          </p>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <Link href="/markets"><button className="btn btn-sm">Markets</button></Link>
            <Link href="/suggestions"><button className="btn btn-sm">Suggestions</button></Link>
            <Link href="/mappings"><button className="btn btn-sm">Mappings</button></Link>
          </div>
        </div>
      ) : (
        <div>
          {opps.map((opp: any) => {
            const isSuspect = opp.suspect === 1;
            return (
              <div
                key={opp.id}
                className="card card-feed feed-card"
                style={isSuspect ? { borderColor: 'var(--yellow)', opacity: 0.7 } : {}}
              >
                <div className="feed-card-left">
                  <div className="feed-label">
                    {isSuspect && <span className="badge badge-yellow" style={{ marginRight: '0.4rem', fontSize: '0.6rem' }}>SUSPECT</span>}
                    {opp.mapping_kind === 'manual_unverified' && (
                      <span className="badge badge-red" style={{ marginRight: '0.4rem', fontSize: '0.6rem' }}>UNVERIFIED</span>
                    )}
                    {stripMarkdown(opp.label)}
                  </div>
                  <div className="feed-direction" style={{ marginTop: '0.35rem' }}>
                    <DirectionBadge direction={opp.direction} />
                  </div>
                  <div className="feed-meta">
                    <span className="feed-meta-item">
                      <span className="badge badge-purple" style={{ fontSize: '0.6rem' }}>{opp.category}</span>
                    </span>
                    {opp.arb_type && opp.arb_type !== 'cross_venue' && (
                      <span className="feed-meta-item">
                        <span className="badge badge-yellow" style={{ fontSize: '0.6rem' }}>{opp.arb_type.toUpperCase()}</span>
                      </span>
                    )}
                    {opp.expiry_ts && (
                      <span className="feed-meta-item">Expires: {formatExpiry(opp.expiry_ts)}</span>
                    )}
                    <span className="feed-meta-item">
                      Cost: ${opp.total_cost?.toFixed(3)} / $1.00
                    </span>
                    {opp.liquidity_score > 0 && (
                      <span className="feed-meta-item">Liq: {opp.liquidity_score}</span>
                    )}
                  </div>
                </div>
                <div className="feed-card-right">
                  <div className="feed-profit">${opp.expected_profit_usd?.toFixed(2)}</div>
                  <div className="feed-edge">{opp.expected_profit_bps} bps</div>
                  <div className="feed-prices">
                    {opp.direction === 'BUY_YES_PM_BUY_NO_KALSHI'
                      ? `PM: ${opp.pm_yes_ask?.toFixed(3)}c / K: ${opp.kalshi_no_ask?.toFixed(3)}c`
                      : `PM: ${opp.pm_no_ask?.toFixed(3)}c / K: ${opp.kalshi_yes_ask?.toFixed(3)}c`
                    }
                  </div>
                  <div className="feed-actions">
                    <Link href={`/feed/${opp.id}`}>
                      <button className="btn btn-sm btn-ghost">Details</button>
                    </Link>
                    {!isSuspect && opp.mapping_kind !== 'manual_unverified' && (
                      <button
                        className="btn btn-sm btn-primary"
                        onClick={() => handleSimulate(opp.id)}
                        disabled={executing === opp.id}
                      >
                        {executing === opp.id ? 'Simulating...' : 'Simulate'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
