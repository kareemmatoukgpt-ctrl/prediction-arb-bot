/**
 * Team name resolution and game deduplication for cross-venue sports matching.
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../../db/schema';

/**
 * Resolve a raw team name to its canonical form via the team_aliases table.
 * Returns null if no match found (market should be skipped).
 */
export function resolveTeamName(rawName: string, sport: string): string | null {
  const db = getDb();

  // 1. Exact match
  const exact = db.prepare(
    'SELECT canonical_name FROM team_aliases WHERE alias = ? AND sport = ?',
  ).get(rawName, sport) as any;
  if (exact) return exact.canonical_name;

  // 2. Case-insensitive match
  const ci = db.prepare(
    'SELECT canonical_name FROM team_aliases WHERE LOWER(alias) = LOWER(?) AND sport = ?',
  ).get(rawName, sport) as any;
  if (ci) return ci.canonical_name;

  // 3. Partial match — check if rawName contains an alias or vice versa
  const allAliases = db.prepare(
    'SELECT canonical_name, alias FROM team_aliases WHERE sport = ?',
  ).all(sport) as any[];

  const lower = rawName.toLowerCase();
  for (const row of allAliases) {
    if (lower.includes(row.alias.toLowerCase()) || row.alias.toLowerCase().includes(lower)) {
      return row.canonical_name;
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

  // Look for existing event: same sport + same two teams + start_time within 2 hours (7200s)
  const twoHours = 7200;
  const existing = db.prepare(`
    SELECT id FROM sports_events
    WHERE sport = ?
      AND home_team = ? AND away_team = ?
      AND ABS(start_time - ?) < ?
    LIMIT 1
  `).get(sport, home, away, startTime, twoHours) as any;

  if (existing) return existing.id;

  // Create new event
  const id = uuid();
  db.prepare(`
    INSERT INTO sports_events (id, sport, league, home_team, away_team, start_time)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sport, league || sport, home, away, startTime);

  return id;
}
