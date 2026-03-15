import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Arb Feed',
  description: 'Cross-venue prediction market arbitrage feed',
};

const globalStyles = `
  :root {
    --bg: #09090b;
    --bg-card: #111113;
    --bg-hover: #1a1a1e;
    --bg-surface: #16161a;
    --border: #27272a;
    --border-bright: #3f3f46;
    --text: #fafafa;
    --text-muted: #71717a;
    --text-dim: #52525b;
    --accent: #8b5cf6;
    --accent-dim: rgba(139,92,246,0.15);
    --green: #22c55e;
    --green-dim: rgba(34,197,94,0.12);
    --red: #ef4444;
    --red-dim: rgba(239,68,68,0.12);
    --yellow: #eab308;
    --yellow-dim: rgba(234,179,8,0.12);
    --blue: #3b82f6;
    --blue-dim: rgba(59,130,246,0.12);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1280px; margin: 0 auto; padding: 0 1.25rem; }

  /* Nav */
  nav { background: var(--bg-card); border-bottom: 1px solid var(--border); padding: 0; position: sticky; top: 0; z-index: 100; }
  nav .container { display: flex; align-items: center; gap: 0; height: 52px; }
  nav .logo { font-weight: 800; font-size: 1rem; color: var(--text); letter-spacing: -0.02em; margin-right: 2rem; white-space: nowrap; }
  nav .logo-accent { color: var(--accent); }
  nav .nav-group { display: flex; align-items: center; gap: 0; height: 100%; }
  nav .nav-link { color: var(--text-muted); font-size: 0.82rem; font-weight: 500; padding: 0 0.9rem; height: 100%; display: flex; align-items: center; border-bottom: 2px solid transparent; transition: all 0.15s; }
  nav .nav-link:hover { color: var(--text); text-decoration: none; background: var(--bg-hover); }
  nav .nav-divider { width: 1px; height: 24px; background: var(--border); margin: 0 0.5rem; }
  nav .nav-admin { color: var(--text-dim); font-size: 0.75rem; }

  /* Cards */
  .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; margin-bottom: 0.75rem; }
  .card:hover { border-color: var(--border-bright); }
  .card-feed { padding: 1.25rem; transition: border-color 0.15s; cursor: default; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; padding: 0.5rem 0.75rem; color: var(--text-muted); border-bottom: 1px solid var(--border); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }
  tr:hover { background: var(--bg-hover); }

  /* Buttons */
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.4rem; padding: 0.5rem 1rem; border-radius: 8px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); cursor: pointer; font-size: 0.82rem; font-weight: 500; transition: all 0.15s; }
  .btn:hover { background: var(--bg-hover); border-color: var(--border-bright); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: white; }
  .btn-primary:hover { opacity: 0.9; }
  .btn-danger { border-color: var(--red); color: var(--red); }
  .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.75rem; }
  .btn-ghost { background: transparent; border: none; color: var(--text-muted); }
  .btn-ghost:hover { color: var(--text); background: var(--bg-hover); }

  /* Inputs */
  input, select { background: var(--bg-surface); border: 1px solid var(--border); color: var(--text); padding: 0.5rem 0.75rem; border-radius: 8px; font-size: 0.82rem; }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  label { font-size: 0.75rem; color: var(--text-muted); display: block; margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }
  .form-group { margin-bottom: 0.75rem; }

  /* Badges */
  .badge { display: inline-flex; align-items: center; padding: 0.2rem 0.6rem; border-radius: 6px; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.02em; }
  .badge-green { background: var(--green-dim); color: var(--green); }
  .badge-red { background: var(--red-dim); color: var(--red); }
  .badge-yellow { background: var(--yellow-dim); color: var(--yellow); }
  .badge-blue { background: var(--blue-dim); color: var(--blue); }
  .badge-purple { background: var(--accent-dim); color: var(--accent); }

  /* Page header */
  .page-header { display: flex; justify-content: space-between; align-items: center; margin: 1.5rem 0 1rem; }
  .page-header h1 { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em; }

  /* Stats */
  .profit { color: var(--green); font-weight: 600; }
  .loss { color: var(--red); font-weight: 600; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }
  .stat-card { text-align: center; padding: 1.25rem 0.75rem; }
  .stat-value { font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
  .stat-label { font-size: 0.72rem; color: var(--text-muted); margin-top: 0.4rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 500; }

  /* Feed-specific */
  .feed-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 1.25rem; }
  .feed-total { font-size: 2.5rem; font-weight: 800; letter-spacing: -0.04em; line-height: 1; }
  .feed-total-label { font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.25rem; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }

  .feed-card { display: flex; align-items: center; gap: 1rem; padding: 1rem 1.25rem; }
  .feed-card-left { flex: 1; min-width: 0; }
  .feed-card-right { text-align: right; flex-shrink: 0; }
  .feed-label { font-size: 0.88rem; font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .feed-direction { font-size: 0.72rem; color: var(--text-muted); margin-top: 0.2rem; }
  .feed-meta { display: flex; gap: 0.75rem; margin-top: 0.35rem; }
  .feed-meta-item { font-size: 0.72rem; color: var(--text-dim); }
  .feed-profit { font-size: 1.5rem; font-weight: 800; color: var(--green); letter-spacing: -0.02em; line-height: 1; }
  .feed-edge { font-size: 0.75rem; color: var(--green); margin-top: 0.15rem; font-weight: 600; }
  .feed-prices { font-size: 0.7rem; color: var(--text-dim); margin-top: 0.25rem; }
  .feed-actions { display: flex; gap: 0.4rem; margin-top: 0.4rem; justify-content: flex-end; }

  .filter-bar { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; margin-bottom: 1.25rem; padding: 0.75rem 1rem; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; }
  .filter-bar select, .filter-bar input { font-size: 0.78rem; padding: 0.35rem 0.6rem; }

  .venue-badge { display: inline-flex; align-items: center; gap: 0.25rem; font-size: 0.68rem; font-weight: 600; padding: 0.15rem 0.4rem; border-radius: 4px; }
  .venue-pm { background: rgba(59,130,246,0.12); color: #60a5fa; }
  .venue-k { background: rgba(234,179,8,0.12); color: #facc15; }

  .empty-state { text-align: center; padding: 3rem 1rem; color: var(--text-muted); }
  .empty-state h2 { font-size: 1.1rem; color: var(--text); margin-bottom: 0.5rem; }
  .empty-state p { font-size: 0.85rem; max-width: 500px; margin: 0 auto; line-height: 1.6; }
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: globalStyles }} />
      </head>
      <body>
        <nav>
          <div className="container">
            <span className="logo">
              <span className="logo-accent">ARB</span> FEED
            </span>
            <div className="nav-group">
              <Link href="/" className="nav-link">Feed</Link>
              <Link href="/paper" className="nav-link">Paper Trades</Link>
              <div className="nav-divider" />
              <Link href="/markets" className="nav-link nav-admin">Markets</Link>
              <Link href="/suggestions" className="nav-link nav-admin">Suggestions</Link>
              <Link href="/mappings" className="nav-link nav-admin">Mappings</Link>
              <Link href="/opportunities" className="nav-link nav-admin">Diagnostics</Link>
            </div>
          </div>
        </nav>
        <main className="container" style={{ paddingTop: '1.25rem', paddingBottom: '2rem' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
