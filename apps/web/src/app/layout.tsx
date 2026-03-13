import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Prediction Arb Bot',
  description: 'Cross-venue prediction market arbitrage dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
