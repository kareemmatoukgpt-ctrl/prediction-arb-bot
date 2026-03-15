'use client';
import { useEffect, useState } from 'react';
import { ingestCrypto, ingestFed, ingestMacro } from '@/lib/api';

function formatExpiry(expiryTs: number | null): string {
  if (!expiryTs) return '—';
  const diff = expiryTs - Math.floor(Date.now() / 1000);
  if (diff < 0) return 'expired';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 24 * 7) return `${Math.floor(h / 24)}d`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function MarketsPage() {
  const [markets, setMarkets] = useState<any[]>([]);
  const [venue, setVenue] = useState('');
  const [asset, setAsset] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const params: Record<string, string> = { limit: '200' };
      if (venue) params.venue = venue;
      if (asset) params.asset = asset;
      if (category) params.category = category;
      if (search) params.search = search;
      const qs = new URLSearchParams(params);
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const data = await fetch(`${API_BASE}/api/markets?${qs}`).then(r => r.json());
      setMarkets(Array.isArray(data) ? data : []);
    } catch {
      setMarkets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue, asset, category, search]);

  async function handleIngest() {
    setIngesting(true);
    setIngestMsg('');
    try {
      const result = await ingestCrypto();
      setIngestMsg(`✅ Ingested ${result.polymarket} PM + ${result.kalshi} Kalshi crypto markets`);
      await load();
    } catch (err: any) {
      setIngestMsg(`❌ Error: ${err.message}`);
    } finally {
      setIngesting(false);
    }
  }

  const cryptoMarkets = markets.filter(m => m.asset);
  const pmCount = markets.filter(m => m.venue === 'POLYMARKET').length;
  const kCount = markets.filter(m => m.venue === 'KALSHI').length;

  return (
    <>
      <div className="page-header">
        <h1>Markets Explorer</h1>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-sm" onClick={handleIngest} disabled={ingesting}>
            {ingesting ? 'Ingesting…' : 'Ingest Crypto'}
          </button>
          <button className="btn btn-sm" onClick={async () => { setIngesting(true); try { const r = await ingestFed(); setIngestMsg(`Ingested ${r.kalshi} FED markets`); } catch (e: any) { setIngestMsg(e.message); } setIngesting(false); }} disabled={ingesting}>
            Ingest FED
          </button>
          <button className="btn btn-sm" onClick={async () => { setIngesting(true); try { const r = await ingestMacro(); setIngestMsg(`Ingested ${r.kalshi} MACRO markets`); } catch (e: any) { setIngestMsg(e.message); } setIngesting(false); }} disabled={ingesting}>
            Ingest MACRO
          </button>
        </div>
      </div>

      {ingestMsg && (
        <div className="card" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>{ingestMsg}</div>
      )}

      <div className="stats-grid" style={{ marginBottom: '1rem' }}>
        <div className="card stat-card"><div className="stat-value">{pmCount}</div><div className="stat-label">Polymarket</div></div>
        <div className="card stat-card"><div className="stat-value">{kCount}</div><div className="stat-label">Kalshi</div></div>
        <div className="card stat-card"><div className="stat-value">{cryptoMarkets.length}</div><div className="stat-label">With Asset Tag</div></div>
      </div>

      <div className="card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Venue</label>
          <select value={venue} onChange={e => setVenue(e.target.value)}>
            <option value="">All</option>
            <option value="POLYMARKET">Polymarket</option>
            <option value="KALSHI">Kalshi</option>
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Category</label>
          <select value={category} onChange={e => setCategory(e.target.value)}>
            <option value="">All</option>
            <option value="CRYPTO">Crypto</option>
            <option value="FED">FED</option>
            <option value="MACRO">MACRO</option>
            <option value="EVENT">Event</option>
          </select>
        </div>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Asset</label>
          <select value={asset} onChange={e => setAsset(e.target.value)}>
            <option value="">All</option>
            <option value="BTC">BTC</option>
            <option value="ETH">ETH</option>
            <option value="SOL">SOL</option>
            <option value="FED_RATE">FED Rate</option>
            <option value="GDP">GDP</option>
            <option value="CPI">CPI</option>
          </select>
        </div>
        <div className="form-group" style={{ margin: 0, flex: 1, minWidth: '200px' }}>
          <label>Search</label>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search questions…"
            style={{ width: '100%' }}
          />
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)', padding: '2rem 0' }}>Loading…</div>
      ) : markets.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <p>No markets found.</p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Click &ldquo;Ingest Crypto&rdquo; to fetch BTC/ETH/SOL markets from both venues.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Question</th>
                <th>Venue</th>
                <th>Asset</th>
                <th>Direction</th>
                <th>Threshold</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {markets.map((m: any) => (
                <tr key={m.id}>
                  <td style={{ maxWidth: '350px' }}>
                    <a href={m.url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem' }}>{m.question}</a>
                  </td>
                  <td>
                    <span className={`badge ${m.venue === 'POLYMARKET' ? 'badge-blue' : 'badge-yellow'}`}>
                      {m.venue === 'POLYMARKET' ? 'PM' : 'K'}
                    </span>
                  </td>
                  <td>
                    {m.asset
                      ? <span className="badge badge-blue">{m.asset}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>{m.predicate_direction || '—'}</td>
                  <td style={{ fontSize: '0.8rem' }}>
                    {m.predicate_threshold != null ? `$${Number(m.predicate_threshold).toLocaleString()}` : '—'}
                  </td>
                  <td style={{
                    fontSize: '0.8rem',
                    color: m.expiry_ts && (m.expiry_ts - Date.now() / 1000) < 7200
                      ? 'var(--yellow)'
                      : 'var(--text-muted)',
                  }}>
                    {formatExpiry(m.expiry_ts)}
                  </td>
                  <td>
                    <span className={`badge ${m.status === 'open' ? 'badge-green' : 'badge-red'}`}>{m.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
