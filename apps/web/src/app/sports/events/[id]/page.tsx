'use client';

import { useEffect, useState } from 'react';
import { sportsApi } from '@/lib/sports-api';
import Link from 'next/link';
import { useParams } from 'next/navigation';

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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    upcoming: 'badge-blue',
    live: 'badge-green',
    final: 'badge-red',
  };
  return <span className={`badge ${colors[status] || 'badge-blue'}`}>{status.toUpperCase()}</span>;
}

function formatTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function EventDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sportsApi.getEvent(id).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>;
  }

  if (!data || !data.event) {
    return (
      <div className="card empty-state">
        <h2>Event not found</h2>
        <Link href="/sports/events"><button className="btn btn-sm">Back to Events</button></Link>
      </div>
    );
  }

  const { event, markets, arbs } = data;
  const betTypes = Object.keys(markets || {});

  return (
    <>
      {/* Game header */}
      <div style={{ marginTop: '0.5rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
          <Link href="/sports" style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sports</Link>
          <span style={{ color: 'var(--text-dim)' }}>/</span>
          <Link href="/sports/events" style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Events</Link>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <SportBadge sport={event.sport} />
          <StatusBadge status={event.status} />
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.5rem', letterSpacing: '-0.02em' }}>
          {event.home_team} vs {event.away_team}
        </h1>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          {event.league} &middot; {formatTime(event.start_time)}
        </div>
      </div>

      {/* Arbs for this event */}
      {arbs && arbs.length > 0 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>
            Active Arbitrage ({arbs.length})
          </h2>
          {arbs.map((arb: any) => (
            <div key={arb.id} className="card card-feed feed-card" style={{ borderColor: 'var(--green)' }}>
              <div className="feed-card-left">
                <div className="feed-label">
                  <span className={`badge ${arb.bet_type === 'MONEYLINE' ? 'badge-purple' : arb.bet_type === 'SPREAD' ? 'badge-blue' : 'badge-yellow'}`} style={{ fontSize: '0.6rem' }}>
                    {arb.bet_type}
                  </span>
                  <span style={{ marginLeft: '0.5rem' }}>{arb.side_a} vs {arb.side_b}</span>
                </div>
                <div className="feed-direction" style={{ marginTop: '0.35rem' }}>
                  <span className="venue-badge venue-pm">{arb.venue_a === 'POLYMARKET' ? 'PM' : 'K'} {arb.side_a} @ {(arb.price_a * 100).toFixed(1)}¢</span>
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.65rem', margin: '0 0.2rem' }}>/</span>
                  <span className="venue-badge venue-k">{arb.venue_b === 'KALSHI' ? 'K' : 'PM'} {arb.side_b} @ {(arb.price_b * 100).toFixed(1)}¢</span>
                </div>
                <div className="feed-meta">
                  <span className="feed-meta-item">Cost: ${arb.combined_cost?.toFixed(3)} / $1.00</span>
                  <span className="feed-meta-item">Size: ${arb.size_usd}</span>
                </div>
              </div>
              <div className="feed-card-right">
                <div className="feed-profit">${arb.profit_usd?.toFixed(2)}</div>
                <div className="feed-edge">{arb.edge_bps} bps</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Odds comparison by bet type */}
      {betTypes.length === 0 ? (
        <div className="card empty-state">
          <h2>No markets found</h2>
          <p>No venue markets have been matched to this event yet.</p>
        </div>
      ) : (
        betTypes.map((bt) => {
          const btMarkets = markets[bt] as any[];
          // Group by venue
          const byVenue: Record<string, any[]> = {};
          for (const m of btMarkets) {
            if (!byVenue[m.venue]) byVenue[m.venue] = [];
            byVenue[m.venue].push(m);
          }
          const venueNames = Object.keys(byVenue);

          // Collect all unique sides
          const sides = Array.from(new Set(btMarkets.map((m: any) => m.side)));

          return (
            <div key={bt} style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                {bt}
                {btMarkets[0]?.line != null && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.5rem' }}>
                    Line: {btMarkets[0].line > 0 ? '+' : ''}{btMarkets[0].line}
                  </span>
                )}
              </h2>
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Side</th>
                      {venueNames.map((v) => (
                        <th key={v}>
                          <span className={`venue-badge ${v === 'POLYMARKET' ? 'venue-pm' : 'venue-k'}`}>
                            {v === 'POLYMARKET' ? 'Polymarket' : 'Kalshi'}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sides.map((side) => {
                      // Find cheapest YES price for this side across venues
                      const pricesPerVenue: Record<string, number | null> = {};
                      for (const v of venueNames) {
                        const match = byVenue[v]?.find((m: any) => m.side === side);
                        pricesPerVenue[v] = match?.yes_price ?? null;
                      }
                      const validPrices = Object.values(pricesPerVenue).filter((p): p is number => p !== null);
                      const cheapest = validPrices.length > 0 ? Math.min(...validPrices) : null;

                      return (
                        <tr key={side}>
                          <td style={{ fontWeight: 600 }}>{side}</td>
                          {venueNames.map((v) => {
                            const market = byVenue[v]?.find((m: any) => m.side === side);
                            const price = market?.yes_price;
                            const isCheapest = price !== null && price === cheapest && validPrices.length > 1;

                            return (
                              <td key={v}>
                                {price != null ? (
                                  <span style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                    <span style={{
                                      fontWeight: 700,
                                      fontSize: '1rem',
                                      color: isCheapest ? 'var(--green)' : 'var(--text)',
                                    }}>
                                      {(price * 100).toFixed(1)}¢
                                    </span>
                                    {market?.url && (
                                      <a
                                        href={market.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ fontSize: '0.7rem', color: 'var(--accent)' }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        View on {v === 'POLYMARKET' ? 'PM' : 'Kalshi'}
                                      </a>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text-dim)' }}>—</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
