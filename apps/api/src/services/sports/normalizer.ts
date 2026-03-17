/**
 * Team name resolution and game deduplication for cross-venue sports matching.
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../../db/schema';

/**
 * Sports that share team pools — if a market is tagged 'SOCCER',
 * we also search EPL, La Liga, Bundesliga aliases.
 */
const SPORT_GROUPS: Record<string, string[]> = {
  SOCCER: ['SOCCER', 'EPL', 'La Liga', 'Bundesliga', 'Serie A', 'Ligue 1', 'MLS'],
  EPL: ['EPL', 'SOCCER'],
  'La Liga': ['La Liga', 'SOCCER'],
  Bundesliga: ['Bundesliga', 'SOCCER'],
};

/**
 * Resolve a raw team name to its canonical form via the team_aliases table.
 * Returns null if no match found (market should be skipped).
 */
export function resolveTeamName(rawName: string, sport: string): string | null {
  const db = getDb();
  const sportsToSearch = SPORT_GROUPS[sport] || [sport];

  for (const s of sportsToSearch) {
    // 1. Exact match
    const exact = db.prepare(
      'SELECT canonical_name, sport FROM team_aliases WHERE alias = ? AND sport = ?',
    ).get(rawName, s) as any;
    if (exact) return exact.canonical_name;

    // 2. Case-insensitive match
    const ci = db.prepare(
      'SELECT canonical_name, sport FROM team_aliases WHERE LOWER(alias) = LOWER(?) AND sport = ?',
    ).get(rawName, s) as any;
    if (ci) return ci.canonical_name;
  }

  // 3. Partial match across all related sports
  for (const s of sportsToSearch) {
    const allAliases = db.prepare(
      'SELECT canonical_name, alias FROM team_aliases WHERE sport = ?',
    ).all(s) as any[];

    const lower = rawName.toLowerCase();
    for (const row of allAliases) {
      if (lower.includes(row.alias.toLowerCase()) || row.alias.toLowerCase().includes(lower)) {
        return row.canonical_name;
      }
    }
  }

  return null;
}

/**
 * Find or create a canonical sports event for a game.
 * Uses alphabetical team ordering for consistency.
 * Matches existing events within a 2-hour window.
 */
export function matchOrCreateEvent(
  sport: string,
  teamA: string,
  teamB: string,
  startTime: number,
  league?: string,
): string {
  const db = getDb();

  // Normalize team order: alphabetical by canonical name
  const [home, away] = [teamA, teamB].sort();

  // Look for existing event: same/related sport + same two teams + start_time within 2 hours
  const twoHours = 7200;
  const relatedSports = SPORT_GROUPS[sport] || [sport];
  let existing: any = null;
  for (const s of relatedSports) {
    existing = db.prepare(`
      SELECT id FROM sports_events
      WHERE sport = ?
        AND home_team = ? AND away_team = ?
        AND ABS(start_time - ?) < ?
      LIMIT 1
    `).get(s, home, away, startTime, twoHours) as any;
    if (existing) break;
  }

  if (existing) return existing.id;

  // Create new event
  const id = uuid();
  db.prepare(`
    INSERT INTO sports_events (id, sport, league, home_team, away_team, start_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sport, league || sport, home, away, startTime);

  return id;
}
