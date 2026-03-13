'use client';
import { useEffect, useState } from 'react';
import { getSuggestions, generateSuggestions, approveSuggestion, rejectSuggestion } from '@/lib/api';

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 90 ? 'badge-green' : score >= 70 ? 'badge-yellow' : 'badge-red';
  return <span className={`badge ${cls}`}>{score}</span>;
}

function formatExpiry(ts: number | null): string {
  if (!ts) return '—';
  const diff = ts - Math.floor(Date.now() / 1000);
  if (diff < 0) return 'expired';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

function parseReasons(json: string): string[] {
  try { return JSON.parse(json); } catch { return []; }
}

function ReasonChip({ reason }: { reason: string }) {
  const isGood = reason.includes('✅');
  const isWarn = reason.includes('⚠️');
  const isBad = reason.includes('❌');
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

export default function SuggestionsPage() {
  const [tab, setTab] = useState<'arb_eligible' | 'research'>('arb_eligible');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [asset, setAsset] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const [actionMsg, setActionMsg] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const data = await getSuggestions({ bucket: tab, status: 'suggested', asset: asset || undefined, limit: 100 });
      setSuggestions(Array.isArray(data) ? data : []);
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, asset]);

  async function handleGenerate() {
    setGenerating(true);
    setGenMsg('');
    try {
      const result = await generateSuggestions();
      setGenMsg(`✅ ${result.arb_eligible ?? 0} arb-eligible, ${result.research ?? 0} research suggestions generated`);
      await load();
    } catch (err: any) {
      setGenMsg(`❌ ${err.message}`);
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
          </select>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate Suggestions'}
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
      </div>

      {tab === 'research' && (
        <div className="card" style={{ marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--yellow)', borderColor: 'var(--yellow)' }}>
          ⚠️ Research suggestions have expiry mismatch &gt;4h or threshold mismatch &gt;1%. They cannot be approved into active mappings.
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem 0' }}>Loading…</div>
      ) : suggestions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <p>No {tab === 'arb_eligible' ? 'arb-eligible' : 'research'} suggestions found.</p>
          {tab === 'arb_eligible' && (
            <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Try: Markets page → Ingest Crypto, then click &ldquo;Generate Suggestions&rdquo; above.
              <br />Arb-eligible pairs require matching asset, expiry ≤4h, threshold ≤1%, same type.
            </p>
          )}
        </div>
      ) : (
        <div>
          {suggestions.map((s: any) => {
            const reasons = parseReasons(s.reasons_json);
            const isActioned = actionMsg?.id === s.id;
            return (
              <div key={s.id} className="card" style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', marginBottom: '0.75rem' }}>
                  {/* PM side */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                      <span className="badge badge-blue">PM</span>
                    </div>
                    <div style={{ fontSize: '0.85rem' }}>{s.pm_question || s.polymarket_market_id}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                      Expires: {formatExpiry(s.pm_expiry_ts)}
                      {s.pm_threshold != null && ` · $${Number(s.pm_threshold).toLocaleString()}`}
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
                      {s.k_threshold != null && ` · $${Number(s.k_threshold).toLocaleString()}`}
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
                  <button className="btn btn-sm btn-danger" onClick={() => handleReject(s.id)}>Reject</button>
                  {tab === 'arb_eligible' ? (
                    <button className="btn btn-sm btn-primary" onClick={() => handleApprove(s.id)}>Approve</button>
                  ) : (
                    <button
                      className="btn btn-sm"
                      disabled
                      title="Research-only — expiry or threshold mismatch too large"
                      style={{ opacity: 0.4, cursor: 'not-allowed' }}
                    >
                      Approve
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
