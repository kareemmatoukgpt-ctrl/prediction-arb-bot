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

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SportsEventsPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [sport, setSport] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const data = await sportsApi.getEvents({
        sport: sport || undefined,
        limit: 100,
      });
      setEvents(Array.isArray(data) ? data : []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sport]);

  return (
    <>
      <div className="page-header">
        <h1>Upcoming Games</h1>
        <Link href="/sports">
          <button className="btn btn-sm btn-ghost">Back to Arbs</button>
        </Link>
      </div>

      <div className="filter-bar" style={{ marginBottom: '1rem' }}>
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
      </div>

      {loading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading events...</div>
      ) : events.length === 0 ? (
        <div className="card empty-state">
          <h2>No upcoming events</h2>
          <p>No sports events have been ingested yet. The pipeline refreshes every 60 seconds.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Sport</th>
                <th>Game</th>
                <th>Start Time</th>
                <th>Venues</th>
                <th>Markets</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev: any) => (
                <tr
                  key={ev.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => window.location.href = `/sports/events/${ev.id}`}
                >
                  <td><SportBadge sport={ev.sport} /></td>
                  <td style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                    {ev.home_team} vs {ev.away_team}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    {formatTime(ev.start_time)}
                  </td>
                  <td>
                    <span style={{ display: 'flex', gap: '0.3rem' }}>
                      {ev.pm_markets > 0 && <span className="venue-badge venue-pm">PM ({ev.pm_markets})</span>}
                      {ev.kalshi_markets > 0 && <span className="venue-badge venue-k">K ({ev.kalshi_markets})</span>}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                    {ev.total_markets}
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
