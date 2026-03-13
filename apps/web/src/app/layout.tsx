import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Prediction Arb Bot',
  description: 'Cross-venue prediction market arbitrage dashboard',
};

const globalStyles = `
  :root {
    --bg: #0a0a0a;
    --bg-card: #141414;
    --bg-hover: #1a1a1a;
    --border: #2a2a2a;
    --text: #e5e5e5;
    --text-muted: #888;
    --accent: #3b82f6;
    --green: #22c55e;
    --red: #ef4444;
    --yellow: #eab308;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: var(--bg); color: var(--text); line-height: 1.5; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1200px; margin: 0 auto; padding: 0 1rem; }
  nav { background: var(--bg-card); border-bottom: 1px solid var(--border); padding: 0.75rem 0; position: sticky; top: 0; z-index: 100; }
  nav .container { display: flex; align-items: center; gap: 2rem; }
  nav .logo { font-weight: 700; font-size: 1.1rem; color: var(--text); }
  nav .links { display: flex; gap: 1.5rem; }
  nav .links a { color: var(--text-muted); font-size: 0.9rem; }
  nav .links a:hover { color: var(--text); text-decoration: none; }
  .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; margin-bottom: 1rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  th { text-align: left; padding: 0.5rem; color: var(--text-muted); border-bottom: 1px solid var(--border); font-weight: 500; }
  td { padding: 0.5rem; border-bottom: 1px solid var(--border); }
  tr:hover { background: var(--bg-hover); }
  .btn { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.4rem 0.75rem; border-radius: 6px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); cursor: pointer; font-size: 0.8rem; transition: background 0.15s; }
  .btn:hover { background: var(--bg-hover); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: white; }
  .btn-primary:hover { opacity: 0.9; }
  .btn-danger { border-color: var(--red); color: var(--red); }
  .btn-sm { padding: 0.25rem 0.5rem; font-size: 0.75rem; }
  input, select { background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 0.4rem 0.6rem; border-radius: 4px; font-size: 0.85rem; }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  label { font-size: 0.8rem; color: var(--text-muted); display: block; margin-bottom: 0.25rem; }
  .form-group { margin-bottom: 0.75rem; }
  .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 500; }
  .badge-green { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge-red { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-yellow { background: rgba(234,179,8,0.15); color: var(--yellow); }
  .badge-blue { background: rgba(59,130,246,0.15); color: var(--accent); }
  .page-header { display: flex; justify-content: space-between; align-items: center; margin: 1.5rem 0 1rem; }
  .page-header h1 { font-size: 1.4rem; font-weight: 600; }
  .profit { color: var(--green); font-weight: 600; }
  .loss { color: var(--red); font-weight: 600; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
  .stat-card { text-align: center; }
  .stat-value { font-size: 1.8rem; font-weight: 700; }
  .stat-label { font-size: 0.8rem; color: var(--text-muted); }
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
            <span className="logo">Prediction Arb Bot</span>
            <div className="links">
              <Link href="/">Dashboard</Link>
              <Link href="/mappings">Mappings</Link>
              <Link href="/opportunities">Opportunities</Link>
              <Link href="/paper">Paper Trading</Link>
            </div>
          </div>
        </nav>
        <main className="container" style={{ paddingTop: '1rem', paddingBottom: '2rem' }}>
          {children}
        </main>
      </body>
    </html>
  );
}
