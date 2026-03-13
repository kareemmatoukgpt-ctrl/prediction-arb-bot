'use client';

import { useEffect, useState } from 'react';
import { getOpportunities, scanOpportunities, executePaperTrade } from '@/lib/api';

export default function OpportunitiesPage() {
  const [opps, setOpps] = useState<any[]>([]);
  const [minEdge, setMinEdge] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);

  async function load() {
    try {
      const data = await getOpportunities({ limit: 100, minEdgeBps: minEdge });
      setOpps(data);
    } catch (err: any) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, [minEdge]);

  async function handleScan() {
    setScanning(true);
    try {
      await scanOpportunities();
      await load();
    } catch (err: any) {
      setError(err.message);
    }
    setScanning(false);
  }

  async function handleExecute(oppId: string) {
    setExecuting(oppId);
    setResult(null);
    try {
      const res = await executePaperTrade(oppId);
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    }
    setExecuting(null);
  }

  return (
    <>
      <div className="page-header">
        <h1>Arbitrage Opportunities</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ margin: 0 }}>Min edge (bps):</label>
          <input
            type="number"
            value={minEdge}
            onChange={(e) => setMinEdge(parseInt(e.target.value) || 0)}
            style={{ width: '80px' }}
          />
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            {scanning ? 'Scanning...' : 'Scan Now'}
          </button>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--red)' }}>{error}</div>}

      {result && (
        <div className="card" style={{ borderColor: result.status === 'SIMULATED' ? 'var(--green)' : 'var(--red)' }}>
          <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
            Paper Trade Result: <span className={`badge ${result.status === 'SIMULATED' ? 'badge-green' : 'badge-red'}`}>{result.status}</span>
          </h3>
          <p style={{ fontSize: '0.85rem' }}>
            PnL: <span className={result.result.pnl >= 0 ? 'profit' : 'loss'}>${result.result.pnl.toFixed(4)}</span>
            {' | '}Yes: ${result.result.avgPriceYes.toFixed(4)}
            {' | '}No: ${result.result.avgPriceNo.toFixed(4)}
            {result.result.failureReason && <> | Reason: {result.result.failureReason}</>}
          </p>
        </div>
      )}

      <div className="card">
        {opps.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            No opportunities found. Make sure you have enabled mappings and the orderbook scanner is running.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Label</th>
                <th>Direction</th>
                <th>YES Price</th>
                <th>NO Price</th>
                <th>Total Cost</th>
                <th>Edge (bps)</th>
                <th>Profit (USD)</th>
                <th>Buffer</th>
                <th>Time</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {opps.map((opp: any) => (
                <tr key={opp.id}>
                  <td style={{ fontWeight: 500 }}>{opp.mapping_label}</td>
                  <td>
                    <span className="badge badge-blue" style={{ fontSize: '0.65rem' }}>
                      {opp.direction === 'BUY_YES_PM_BUY_NO_KALSHI' ? 'YES PM / NO K' : 'NO PM / YES K'}
                    </span>
                  </td>
                  <td>${opp.cost_yes?.toFixed(3)}</td>
                  <td>${opp.cost_no?.toFixed(3)}</td>
                  <td>${(opp.cost_yes + opp.cost_no)?.toFixed(3)}</td>
                  <td className="profit">{opp.expected_profit_bps}</td>
                  <td className="profit">${opp.expected_profit_usd?.toFixed(2)}</td>
                  <td>{opp.buffer_bps} bps</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {new Date(opp.ts).toLocaleTimeString()}
                  </td>
                  <td>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleExecute(opp.id)}
                      disabled={executing === opp.id}
                    >
                      {executing === opp.id ? 'Simulating...' : 'Simulate Execute'}
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
