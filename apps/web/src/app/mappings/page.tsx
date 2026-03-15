'use client';

import { useEffect, useState } from 'react';
import { getMappings, createMapping, toggleMapping, deleteMapping } from '@/lib/api';

export default function MappingsPage() {
  const [mappings, setMappings] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ polymarketMarketId: '', kalshiMarketId: '', label: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const data = await getMappings();
      setMappings(data);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await createMapping(form);
      setForm({ polymarketMarketId: '', kalshiMarketId: '', label: '' });
      setShowForm(false);
      await load();
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }

  async function handleToggle(id: string) {
    try {
      await toggleMapping(id);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to toggle mapping');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this mapping?')) return;
    try {
      await deleteMapping(id);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to delete mapping');
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Market Mappings</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Add Mapping'}
        </button>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--red)', marginBottom: '1rem' }}>{error}</div>}

      {showForm && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>New Mapping</h2>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>Polymarket Market ID</label>
              <input
                type="text"
                value={form.polymarketMarketId}
                onChange={(e) => setForm({ ...form, polymarketMarketId: e.target.value })}
                placeholder="e.g. 0x1234..."
                style={{ width: '100%' }}
                required
              />
            </div>
            <div className="form-group">
              <label>Kalshi Market ID</label>
              <input
                type="text"
                value={form.kalshiMarketId}
                onChange={(e) => setForm({ ...form, kalshiMarketId: e.target.value })}
                placeholder="e.g. KXBTC-100K"
                style={{ width: '100%' }}
                required
              />
            </div>
            <div className="form-group">
              <label>Label</label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="e.g. BTC $100k by EOY 2026"
                style={{ width: '100%' }}
                required
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Mapping'}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        {mappings.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No mappings yet. Add one to start scanning for arbitrage opportunities.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Polymarket ID</th>
                <th>Kalshi ID</th>
                <th>Confidence</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((m: any) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 500 }}>{m.label}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {m.polymarket_market_id.substring(0, 16)}...
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {m.kalshi_market_id}
                  </td>
                  <td>{m.confidence}%</td>
                  <td>
                    <span className={`badge ${m.enabled ? 'badge-green' : 'badge-red'}`}>
                      {m.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => handleToggle(m.id)}>
                      {m.enabled ? 'Disable' : 'Enable'}
                    </button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(m.id)}>
                      Delete
                    </button>
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
