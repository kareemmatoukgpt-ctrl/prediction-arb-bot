'use client';
import { useEffect, useState } from 'react';
import { getSuggestions, generateSuggestions, approveSuggestion, rejectSuggestion } from '@/lib/api';

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 90 ? 'badge-green' : score >= 70 ? 'badge-yellow' : 'badge-red';
  return <span className={`badge ${cls}`}>{score}</span>;
}

function formatExpiry(ts: number | null): string {
  if (!ts) return '\u2014';
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff < 0) return 'expired';
  const d = Math.floor(diff / 86400);
  const h = Math.floor((diff % 86400) / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (d > 0) return `in ${d}d ${h}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function parseReasons(json: string): string[] {
  try { return JSON.parse(json); } catch { return []; }
}

function ReasonChip({ reason }: { reason: string }) {
  const isGood = reason.includes('\u2705');
  const isWarn = reason.includes('\u26a0\ufe0f');
  const isBad = reason.includes('\u274c');
  const color = isGood ? 'var(--green)' : isWarn ? 'var(--yellow)' : isBad ? 'var(--red)' : 'var(--text-muted)';
  return (
    <span style={{
      display: 'inline-block',
      fontSize: '0.72rem',
      padding: '0.1rem 0.4rem',
      margin: '0.15rem',
      borderRadius: '4px',
      border: `1px solid ${color}`,
      color,
    }}>{reason}</span>
  );
}

function SuggestionCard({ s, tab, onApprove, onReject, actionMsg }: {
  s: any; tab: string; onApprove: (id: string) => void; onReject: (id: string) => void;
  actionMsg: { id: string; msg: string; ok: boolean } | null;
}) {
  const reasons = parseReasons(s.reasons_json);
  const isActioned = actionMsg?.id === s.id;
  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '0.75rem' }}>
        {/* PM side */}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            <span className="badge badge-blue">PM</span>
          </div>
          <div style={{ fontSize: '0.85rem' }}>{s.pm_question || s.polymarket_market_id}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Expires: {formatExpiry(s.pm_expiry_ts)}
            {s.pm_threshold != null && ` \u00b7 $${Number(s.pm_threshold).toLocaleString()}`}
          </div>
        </div>
        {/* Score */}
        <div style={{ textAlign: 'center', minWidth: '80px' }}>
          <ScoreBadge score={s.score} />
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>score</div>
        </div>
        {/* Kalshi side */}
        <div style={{ flex: 1, textAlign: 'right' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
            <span className="badge badge-yellow">K</span>
          </div>
          <div style={{ fontSize: '0.85rem' }}>{s.k_question || s.kalshi_market_id}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Expires: {formatExpiry(s.k_expiry_ts)}
            {s.k_threshold != null && ` \u00b7 $${Number(s.k_threshold).toLocaleString()}`}
          </div>
        </div>
      </div>
      {/* Reasons */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginBottom: '0.5rem' }}>
        {reasons.map((r, i) => <ReasonChip key={i} reason={r} />)}
      </div>
      {/* Actions */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end' }}>
        {isActioned && (
          <span style={{ fontSize: '0.8rem', color: actionMsg!.ok ? 'var(--green)' : 'var(--red)', marginRight: 'auto' }}>
            {actionMsg!.msg}
          </span>
        )}
        {s.status === 'approved' ? (
          <span className="badge badge-green" style={{ marginRight: 'auto' }}>Approved</span>
        ) : s.status === 'rejected' ? (
          <span className="badge badge-red" style={{ marginRight: 'auto' }}>Rejected</span>
        ) : (
          <>
            <button className="btn btn-sm btn-danger" onClick={() => onReject(s.id)}>Reject</button>
            {tab === 'arb_eligible' ? (
              <button className="btn btn-sm btn-primary" onClick={() => onApprove(s.id)}>Approve</button>
            ) : (
              <button className="btn btn-sm" disabled title="Research-only \u2014 expiry or threshold mismatch too large" style={{ opacity: 0.4, cursor: 'not-allowed' }}>
                Approve
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function SuggestionsPage() {
  const [tab, setTab] = useState<'arb_eligible' | 'research' | 'discovery'>('arb_eligible');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [discoverySuggestions, setDiscoverySuggestions] = useState<any[]>([]);
  const [asset, setAsset] = useState('');
  const [showApproved, setShowApproved] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [actionMsg, setActionMsg] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const status = showApproved ? undefined : 'suggested';
      if (tab === 'discovery') {
        const data = await getSuggestions({ bucket: 'research', status: 'suggested', asset: asset || undefined, minScore: 40, limit: 20 });
        setDiscoverySuggestions(Array.isArray(data) ? data : []);
      } else {
        const data = await getSuggestions({ bucket: tab, status, asset: asset || undefined, limit: 100 });
        setSuggestions(Array.isArray(data) ? data : []);
      }
    } catch {
      setSuggestions([]);
      setDiscoverySuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, asset, showApproved]);

  async function handleGenerate() {
    setGenerating(true);
    setGenMsg('');
    try {
      const result = await generateSuggestions();
      setGenMsg(`${result.arb_eligible ?? 0} arb-eligible, ${result.research ?? 0} research suggestions generated`);
      await load();
    } catch (err: any) {
      setGenMsg(`Error: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleApprove(id: string) {
    try {
      const result = await approveSuggestion(id);
      setActionMsg({ id, msg: result.message || 'Mapping created!', ok: true });
      await load();
    } catch (err: any) {
      setActionMsg({ id, msg: err.message || 'Approval failed', ok: false });
    }
  }

  async function handleReject(id: string) {
    try {
      await rejectSuggestion(id);
      setActionMsg({ id, msg: 'Rejected', ok: true });
      await load();
    } catch (err: any) {
      setActionMsg({ id, msg: err.message || 'Reject failed', ok: false });
    }
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '0.5rem 1rem',
    cursor: 'pointer',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    background: 'none',
    border: 'none',
    fontSize: '0.9rem',
  });

  return (
    <>
      <div className="page-header">
        <h1>Suggested Mappings</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <select value={asset} onChange={e => setAsset(e.target.value)}>
            <option value="">All assets</option>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
            <option value="SOL">SOL</option>
            <option value="XRP">XRP</option>
            <option value="DOGE">DOGE</option>
            <option value="FED_RATE">FED Rate</option>
            <option value="GDP">GDP</option>
            <option value="CPI">CPI</option>
          </select>
          <label style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.72rem', textTransform: 'none' }}>
            <input type="checkbox" checked={showApproved} onChange={e => setShowApproved(e.target.checked)} />
            Show approved
          </label>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating\u2026' : 'Generate Suggestions'}
          </button>
        </div>
      </div>

      {genMsg && (
        <div className="card" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>{genMsg}</div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <button style={tabStyle(tab === 'arb_eligible')} onClick={() => setTab('arb_eligible')}>
          Arb-eligible
        </button>
        <button style={tabStyle(tab === 'research')} onClick={() => setTab('research')}>
          Research
        </button>
        <button style={tabStyle(tab === 'discovery')} onClick={() => setTab('discovery')}>
          Discovery
        </button>
      </div>

      {tab === 'research' && (
        <div className="card" style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--yellow)', borderColor: 'var(--yellow)' }}>
          Research suggestions have expiry or type mismatch. They cannot be approved into active mappings.
        </div>
      )}

      {tab === 'discovery' && (
        <div className="card" style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--accent)', borderColor: 'var(--accent)' }}>
          <strong>Closest comparable pairs</strong> &mdash; NOT arb-eligible. Shows why true cross-venue arbs are rare.
          Common blockers: PM uses TOUCH_BY (any-time-touch), Kalshi uses CLOSE_AT (price at expiry).
          <br />When contract types align, arb-eligible suggestions will appear automatically.
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem 0' }}>Loading\u2026</div>
      ) : tab === 'discovery' ? (
        discoverySuggestions.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
            <p>No comparable pairs found. Try ingesting crypto markets first.</p>
          </div>
        ) : (
          <div>
            {discoverySuggestions.map((s: any) => {
              const reasons = parseReasons(s.reasons_json);
              // Find the "Research-only" reason which tells us why it's not arb-eligible
              const blockReason = reasons.find(r => r.startsWith('Research-only:'));
              return (
                <div key={s.id} className="card" style={{ marginBottom: '1rem', borderColor: 'var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '0.5rem' }}>
                    <div style={{ flex: 1 }}>
                      <span className="badge badge-blue" style={{ marginRight: '0.3rem' }}>PM</span>
                      <span style={{ fontSize: '0.85rem' }}>{s.pm_question || s.polymarket_market_id}</span>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        Expires: {formatExpiry(s.pm_expiry_ts)}
                        {s.pm_threshold != null && ` \u00b7 $${Number(s.pm_threshold).toLocaleString()}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', minWidth: '60px' }}>
                      <ScoreBadge score={s.score} />
                    </div>
                    <div style={{ flex: 1, textAlign: 'right' }}>
                      <span className="badge badge-yellow" style={{ marginRight: '0.3rem' }}>K</span>
                      <span style={{ fontSize: '0.85rem' }}>{s.k_question || s.kalshi_market_id}</span>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        Expires: {formatExpiry(s.k_expiry_ts)}
                        {s.k_threshold != null && ` \u00b7 $${Number(s.k_threshold).toLocaleString()}`}
                      </div>
                    </div>
                  </div>
                  {blockReason && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--red)', padding: '0.3rem 0.5rem', background: 'rgba(239,68,68,0.08)', borderRadius: '4px', marginBottom: '0.4rem' }}>
                      {blockReason}
                    </div>
                  )}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.4rem' }}>
                    {reasons.filter(r => !r.startsWith('Research-only:')).map((r, i) => <ReasonChip key={i} reason={r} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : suggestions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <p>No {tab === 'arb_eligible' ? 'arb-eligible' : 'research'} suggestions found.</p>
          {tab === 'arb_eligible' && (
            <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Try: Markets page &rarr; Ingest Crypto, then click &ldquo;Generate Suggestions&rdquo; above.
              <br />Arb-eligible pairs require matching asset, expiry, threshold, direction, AND contract type.
              <br />Check the Discovery tab to see what&apos;s closest and why.
            </p>
          )}
        </div>
      ) : (
        <div>
          {suggestions.map((s: any) => (
            <SuggestionCard
              key={s.id}
              s={s}
              tab={tab}
              onApprove={handleApprove}
              onReject={handleReject}
              actionMsg={actionMsg}
            />
          ))}
        </div>
      )}
    </>
  );
}
