'use client';

import { useEffect, useState } from 'react';
import { getFeedItem, executePaperTrade } from '@/lib/api';
import Link from 'next/link';
import { useParams } from 'next/navigation';

function formatExpiry(ts: number | null): string {
  if (!ts) return 'N/A';
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff < 0) return 'Expired';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function FeedDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [opp, setOpp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    getFeedItem(id)
      .then(setOpp)
      .catch(() => setOpp(null))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSimulate() {
    setExecuting(true);
    setResult(null);
    try {
      const res = await executePaperTrade(opp.id);
      setResult(res);
    } catch (err: any) {
      setResult({ status: 'FAILED', result: { pnl: 0, failureReason: err.message } });
    }
    setExecuting(false);
  }

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>Loading...</div>;
  if (!opp) return (
    <div className="card empty-state">
      <h2>Opportunity not found</h2>
      <p>It may have been removed (no longer active).</p>
      <Link href="/" style={{ marginTop: '1rem', display: 'inline-block' }}>
        <button className="btn btn-primary">Back to Feed</button>
      </Link>
    </div>
  );

  const isSuspect = opp.suspect === 1;
  const isUnverified = opp.mapping_kind === 'manual_unverified';

  return (
    <>
      <div style={{ marginBottom: '1rem' }}>
        <Link href="/" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>&larr; Back to Feed</Link>
      </div>

      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem' }}>
          <span className="badge badge-purple">{opp.category}</span>
          {isSuspect && <span className="badge badge-yellow">SUSPECT</span>}
          {isUnverified && <span className="badge badge-red">UNVERIFIED</span>}
          {opp.mapping_kind === 'auto_approved' && <span className="badge badge-green">AUTO-APPROVED</span>}
          {opp.mapping_kind === 'crypto_arb_eligible' && <span className="badge badge-green">ARB-ELIGIBLE</span>}
        </div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, lineHeight: 1.3 }}>{opp.label}</h1>
      </div>

      {/* Suspect warning */}
      {isSuspect && (
        <div className="card" style={{ borderColor: 'var(--yellow)', marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--yellow)', marginBottom: '0.3rem' }}>Suspect Opportunity</div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{opp.suspect_reasons}</p>
        </div>
      )}

      {/* Profit + Edge */}
      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="card stat-card">
          <div className="stat-value profit">${opp.expected_profit_usd?.toFixed(2)}</div>
          <div className="stat-label">Profit (${opp.size_usd} size)</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value profit">{opp.expected_profit_bps}</div>
          <div className="stat-label">Edge (bps)</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">${opp.total_cost?.toFixed(3)}</div>
          <div className="stat-label">Total Cost</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{formatExpiry(opp.expiry_ts)}</div>
          <div className="stat-label">Expires</div>
        </div>
      </div>

      {/* Legs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span className="venue-badge venue-pm" style={{ fontSize: '0.75rem' }}>Polymarket</span>
            <span className="badge badge-blue">
              {opp.direction === 'BUY_YES_PM_BUY_NO_KALSHI' ? 'BUY YES' : 'BUY NO'}
            </span>
          </div>
          <div style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>YES Ask</span>
              <span style={{ fontWeight: 600 }}>${opp.pm_yes_ask?.toFixed(4)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>NO Ask</span>
              <span style={{ fontWeight: 600 }}>${opp.pm_no_ask?.toFixed(4)}</span>
            </div>
          </div>
          {opp.pm_market_url && (
            <a href={opp.pm_market_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem' }}>
              Open on Polymarket &rarr;
            </a>
          )}
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span className="venue-badge venue-k" style={{ fontSize: '0.75rem' }}>Kalshi</span>
            <span className="badge badge-yellow">
              {opp.direction === 'BUY_YES_PM_BUY_NO_KALSHI' ? 'BUY NO' : 'BUY YES'}
            </span>
          </div>
          <div style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>YES Ask</span>
              <span style={{ fontWeight: 600 }}>${opp.kalshi_yes_ask?.toFixed(4)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.25rem 0' }}>
              <span style={{ color: 'var(--text-muted)' }}>NO Ask</span>
              <span style={{ fontWeight: 600 }}>${opp.kalshi_no_ask?.toFixed(4)}</span>
            </div>
          </div>
          {opp.kalshi_market_url && (
            <a href={opp.kalshi_market_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem' }}>
              Open on Kalshi &rarr;
            </a>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Details</h3>
        <div style={{ fontSize: '0.82rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem 2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Mapping ID</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>{opp.mapping_id?.slice(0, 8)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Direction</span>
            <span style={{ fontSize: '0.75rem' }}>
              {opp.direction === 'BUY_YES_PM_BUY_NO_KALSHI' ? 'YES PM / NO K' : 'NO PM / YES K'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Size</span>
            <span>${opp.size_usd}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Mapping Kind</span>
            <span>{opp.mapping_kind ?? 'unknown'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Last Updated</span>
            <span>{opp.ts_updated}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>Liquidity Score</span>
            <span>{opp.liquidity_score ?? 0}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        {!isSuspect && !isUnverified && (
          <button className="btn btn-primary" onClick={handleSimulate} disabled={executing}>
            {executing ? 'Simulating...' : 'Simulate Execute'}
          </button>
        )}
        <Link href="/">
          <button className="btn">Back to Feed</button>
        </Link>
      </div>

      {/* Simulation result */}
      {result && (
        <div className="card" style={{ marginTop: '1rem', borderColor: result.status === 'SIMULATED' ? 'var(--green)' : 'var(--red)' }}>
          <h3 style={{ fontSize: '0.88rem', marginBottom: '0.5rem' }}>
            Paper Trade Result: <span className={`badge ${result.status === 'SIMULATED' ? 'badge-green' : 'badge-red'}`}>{result.status}</span>
          </h3>
          <p style={{ fontSize: '0.82rem' }}>
            PnL: <span className={result.result?.pnl >= 0 ? 'profit' : 'loss'}>${result.result?.pnl?.toFixed(4)}</span>
            {result.result?.avgPriceYes != null && <> | YES: ${result.result.avgPriceYes.toFixed(4)}</>}
            {result.result?.avgPriceNo != null && <> | NO: ${result.result.avgPriceNo.toFixed(4)}</>}
            {result.result?.failureReason && <> | {result.result.failureReason}</>}
          </p>
        </div>
      )}
    </>
  );
}
