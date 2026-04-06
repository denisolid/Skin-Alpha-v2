import Link from 'next/link';

import { getCurrentUser } from './lib/server-api';

const productPoints = [
  'Normalized market state across Skinport, CSFloat, Steam snapshots, and backup references.',
  'Opportunity scoring with freshness, liquidity, disagreement, and stale-source penalties.',
  'Session auth, watchlists, alerts, and scanner diagnostics already wired in the backend.',
];

export default async function LandingPage() {
  const currentUser = await getCurrentUser();

  return (
    <main className="landing-shell">
      <section className="landing-hero card">
        <div className="hero-copy">
          <span className="eyebrow">SkinAlpha v2</span>
          <h1>Scanner-first market workflow for CS2 items.</h1>
          <p className="hero-text">
            A functional frontend shell for monitoring normalized opportunities,
            managing watchlists, and operating the scanner from internal market
            state rather than live source calls.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/opportunities">
              Open Opportunities
            </Link>
            <Link
              className="button button-secondary"
              href={currentUser ? '/dashboard' : '/login'}
            >
              {currentUser ? 'Go To Dashboard' : 'Sign In'}
            </Link>
          </div>
        </div>

        <div className="hero-panel">
          <div className="metric-grid">
            <div className="metric-card">
              <span className="metric-label">Scanner Mode</span>
              <strong>Cached State Only</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Auth</span>
              <strong>Session Cookies</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Primary Views</span>
              <strong>Feed, Watchlists, Dashboard</strong>
            </div>
            <div className="metric-card">
              <span className="metric-label">Current Session</span>
              <strong>
                {currentUser ? (currentUser.email ?? 'Signed in') : 'Guest'}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-grid">
        <article className="card content-card">
          <h2>What This Shell Covers</h2>
          <ul className="bullet-list">
            {productPoints.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </article>

        <article className="card content-card">
          <h2>Routes</h2>
          <div className="route-list">
            <Link href="/dashboard">/dashboard</Link>
            <Link href="/opportunities">/opportunities</Link>
            <Link href="/watchlists">/watchlists</Link>
            <Link href="/account/settings">/account/settings</Link>
            <Link href="/login">/login</Link>
            <Link href="/register">/register</Link>
          </div>
        </article>
      </section>
    </main>
  );
}
