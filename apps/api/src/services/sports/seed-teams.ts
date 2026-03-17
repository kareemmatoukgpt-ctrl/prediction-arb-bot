import { v4 as uuid } from 'uuid';
import { getDb } from '../../db/schema';

interface TeamDef {
  canonical: string;
  aliases: string[];
  sport: string;
}

const TEAMS: TeamDef[] = [
  // ─── NBA (30 teams) ───────────────────────────────────────────────────
  { canonical: 'Atlanta Hawks', aliases: ['Hawks', 'ATL', 'Atlanta'], sport: 'NBA' },
  { canonical: 'Boston Celtics', aliases: ['Celtics', 'BOS', 'Boston'], sport: 'NBA' },
  { canonical: 'Brooklyn Nets', aliases: ['Nets', 'BKN', 'Brooklyn'], sport: 'NBA' },
  { canonical: 'Charlotte Hornets', aliases: ['Hornets', 'CHA', 'Charlotte'], sport: 'NBA' },
  { canonical: 'Chicago Bulls', aliases: ['Bulls', 'CHI', 'Chicago'], sport: 'NBA' },
  { canonical: 'Cleveland Cavaliers', aliases: ['Cavaliers', 'Cavs', 'CLE', 'Cleveland'], sport: 'NBA' },
  { canonical: 'Dallas Mavericks', aliases: ['Mavericks', 'Mavs', 'DAL', 'Dallas'], sport: 'NBA' },
  { canonical: 'Denver Nuggets', aliases: ['Nuggets', 'DEN', 'Denver'], sport: 'NBA' },
  { canonical: 'Detroit Pistons', aliases: ['Pistons', 'DET', 'Detroit'], sport: 'NBA' },
  { canonical: 'Golden State Warriors', aliases: ['Warriors', 'GSW', 'GS Warriors', 'Golden State'], sport: 'NBA' },
  { canonical: 'Houston Rockets', aliases: ['Rockets', 'HOU', 'Houston'], sport: 'NBA' },
  { canonical: 'Indiana Pacers', aliases: ['Pacers', 'IND', 'Indiana'], sport: 'NBA' },
  { canonical: 'Los Angeles Clippers', aliases: ['Clippers', 'LAC', 'LA Clippers'], sport: 'NBA' },
  { canonical: 'Los Angeles Lakers', aliases: ['Lakers', 'LAL', 'LA Lakers'], sport: 'NBA' },
  { canonical: 'Memphis Grizzlies', aliases: ['Grizzlies', 'MEM', 'Memphis'], sport: 'NBA' },
  { canonical: 'Miami Heat', aliases: ['Heat', 'MIA', 'Miami'], sport: 'NBA' },
  { canonical: 'Milwaukee Bucks', aliases: ['Bucks', 'MIL', 'Milwaukee'], sport: 'NBA' },
  { canonical: 'Minnesota Timberwolves', aliases: ['Timberwolves', 'Wolves', 'MIN', 'Minnesota'], sport: 'NBA' },
  { canonical: 'New Orleans Pelicans', aliases: ['Pelicans', 'NOP', 'New Orleans'], sport: 'NBA' },
  { canonical: 'New York Knicks', aliases: ['Knicks', 'NYK', 'NY Knicks'], sport: 'NBA' },
  { canonical: 'Oklahoma City Thunder', aliases: ['Thunder', 'OKC', 'Oklahoma City'], sport: 'NBA' },
  { canonical: 'Orlando Magic', aliases: ['Magic', 'ORL', 'Orlando'], sport: 'NBA' },
  { canonical: 'Philadelphia 76ers', aliases: ['76ers', 'Sixers', 'PHI', 'Philadelphia'], sport: 'NBA' },
  { canonical: 'Phoenix Suns', aliases: ['Suns', 'PHX', 'Phoenix'], sport: 'NBA' },
  { canonical: 'Portland Trail Blazers', aliases: ['Trail Blazers', 'Blazers', 'POR', 'Portland'], sport: 'NBA' },
  { canonical: 'Sacramento Kings', aliases: ['Kings', 'SAC', 'Sacramento'], sport: 'NBA' },
  { canonical: 'San Antonio Spurs', aliases: ['Spurs', 'SAS', 'San Antonio'], sport: 'NBA' },
  { canonical: 'Toronto Raptors', aliases: ['Raptors', 'TOR', 'Toronto'], sport: 'NBA' },
  { canonical: 'Utah Jazz', aliases: ['Jazz', 'UTA', 'Utah'], sport: 'NBA' },
  { canonical: 'Washington Wizards', aliases: ['Wizards', 'WAS', 'Washington'], sport: 'NBA' },

  // ─── NFL (32 teams) ──────────────────────────────────────────────────
  { canonical: 'Arizona Cardinals', aliases: ['Cardinals', 'ARI', 'Arizona'], sport: 'NFL' },
  { canonical: 'Atlanta Falcons', aliases: ['Falcons', 'ATL', 'Atlanta'], sport: 'NFL' },
  { canonical: 'Baltimore Ravens', aliases: ['Ravens', 'BAL', 'Baltimore'], sport: 'NFL' },
  { canonical: 'Buffalo Bills', aliases: ['Bills', 'BUF', 'Buffalo'], sport: 'NFL' },
  { canonical: 'Carolina Panthers', aliases: ['Panthers', 'CAR', 'Carolina'], sport: 'NFL' },
  { canonical: 'Chicago Bears', aliases: ['Bears', 'CHI', 'Chicago'], sport: 'NFL' },
  { canonical: 'Cincinnati Bengals', aliases: ['Bengals', 'CIN', 'Cincinnati'], sport: 'NFL' },
  { canonical: 'Cleveland Browns', aliases: ['Browns', 'CLE', 'Cleveland'], sport: 'NFL' },
  { canonical: 'Dallas Cowboys', aliases: ['Cowboys', 'DAL', 'Dallas'], sport: 'NFL' },
  { canonical: 'Denver Broncos', aliases: ['Broncos', 'DEN', 'Denver'], sport: 'NFL' },
  { canonical: 'Detroit Lions', aliases: ['Lions', 'DET', 'Detroit'], sport: 'NFL' },
  { canonical: 'Green Bay Packers', aliases: ['Packers', 'GB', 'Green Bay'], sport: 'NFL' },
  { canonical: 'Houston Texans', aliases: ['Texans', 'HOU', 'Houston'], sport: 'NFL' },
  { canonical: 'Indianapolis Colts', aliases: ['Colts', 'IND', 'Indianapolis'], sport: 'NFL' },
  { canonical: 'Jacksonville Jaguars', aliases: ['Jaguars', 'Jags', 'JAX', 'Jacksonville'], sport: 'NFL' },
  { canonical: 'Kansas City Chiefs', aliases: ['Chiefs', 'KC', 'Kansas City'], sport: 'NFL' },
  { canonical: 'Las Vegas Raiders', aliases: ['Raiders', 'LV', 'LVR', 'Las Vegas'], sport: 'NFL' },
  { canonical: 'Los Angeles Chargers', aliases: ['Chargers', 'LAC', 'LA Chargers'], sport: 'NFL' },
  { canonical: 'Los Angeles Rams', aliases: ['Rams', 'LAR', 'LA Rams'], sport: 'NFL' },
  { canonical: 'Miami Dolphins', aliases: ['Dolphins', 'MIA', 'Miami'], sport: 'NFL' },
  { canonical: 'Minnesota Vikings', aliases: ['Vikings', 'MIN', 'Minnesota'], sport: 'NFL' },
  { canonical: 'New England Patriots', aliases: ['Patriots', 'Pats', 'NE', 'New England'], sport: 'NFL' },
  { canonical: 'New Orleans Saints', aliases: ['Saints', 'NO', 'New Orleans'], sport: 'NFL' },
  { canonical: 'New York Giants', aliases: ['Giants', 'NYG', 'NY Giants'], sport: 'NFL' },
  { canonical: 'New York Jets', aliases: ['Jets', 'NYJ', 'NY Jets'], sport: 'NFL' },
  { canonical: 'Philadelphia Eagles', aliases: ['Eagles', 'PHI', 'Philadelphia'], sport: 'NFL' },
  { canonical: 'Pittsburgh Steelers', aliases: ['Steelers', 'PIT', 'Pittsburgh'], sport: 'NFL' },
  { canonical: 'San Francisco 49ers', aliases: ['49ers', 'Niners', 'SF', 'San Francisco'], sport: 'NFL' },
  { canonical: 'Seattle Seahawks', aliases: ['Seahawks', 'SEA', 'Seattle'], sport: 'NFL' },
  { canonical: 'Tampa Bay Buccaneers', aliases: ['Buccaneers', 'Bucs', 'TB', 'Tampa Bay'], sport: 'NFL' },
  { canonical: 'Tennessee Titans', aliases: ['Titans', 'TEN', 'Tennessee'], sport: 'NFL' },
  { canonical: 'Washington Commanders', aliases: ['Commanders', 'WAS', 'Washington'], sport: 'NFL' },

  // ─── NHL (32 teams) ──────────────────────────────────────────────────
  { canonical: 'Anaheim Ducks', aliases: ['Ducks', 'ANA', 'Anaheim'], sport: 'NHL' },
  { canonical: 'Arizona Coyotes', aliases: ['Coyotes', 'ARI', 'Arizona'], sport: 'NHL' },
  { canonical: 'Boston Bruins', aliases: ['Bruins', 'BOS', 'Boston'], sport: 'NHL' },
  { canonical: 'Buffalo Sabres', aliases: ['Sabres', 'BUF', 'Buffalo'], sport: 'NHL' },
  { canonical: 'Calgary Flames', aliases: ['Flames', 'CGY', 'Calgary'], sport: 'NHL' },
  { canonical: 'Carolina Hurricanes', aliases: ['Hurricanes', 'Canes', 'CAR', 'Carolina'], sport: 'NHL' },
  { canonical: 'Chicago Blackhawks', aliases: ['Blackhawks', 'Hawks', 'CHI', 'Chicago'], sport: 'NHL' },
  { canonical: 'Colorado Avalanche', aliases: ['Avalanche', 'Avs', 'COL', 'Colorado'], sport: 'NHL' },
  { canonical: 'Columbus Blue Jackets', aliases: ['Blue Jackets', 'CBJ', 'Columbus'], sport: 'NHL' },
  { canonical: 'Dallas Stars', aliases: ['Stars', 'DAL', 'Dallas'], sport: 'NHL' },
  { canonical: 'Detroit Red Wings', aliases: ['Red Wings', 'DET', 'Detroit'], sport: 'NHL' },
  { canonical: 'Edmonton Oilers', aliases: ['Oilers', 'EDM', 'Edmonton'], sport: 'NHL' },
  { canonical: 'Florida Panthers', aliases: ['Panthers', 'FLA', 'Florida'], sport: 'NHL' },
  { canonical: 'Los Angeles Kings', aliases: ['Kings', 'LAK', 'LA Kings'], sport: 'NHL' },
  { canonical: 'Minnesota Wild', aliases: ['Wild', 'MIN', 'Minnesota'], sport: 'NHL' },
  { canonical: 'Montreal Canadiens', aliases: ['Canadiens', 'Habs', 'MTL', 'Montreal'], sport: 'NHL' },
  { canonical: 'Nashville Predators', aliases: ['Predators', 'Preds', 'NSH', 'Nashville'], sport: 'NHL' },
  { canonical: 'New Jersey Devils', aliases: ['Devils', 'NJD', 'NJ Devils', 'New Jersey'], sport: 'NHL' },
  { canonical: 'New York Islanders', aliases: ['Islanders', 'NYI', 'NY Islanders'], sport: 'NHL' },
  { canonical: 'New York Rangers', aliases: ['Rangers', 'NYR', 'NY Rangers'], sport: 'NHL' },
  { canonical: 'Ottawa Senators', aliases: ['Senators', 'Sens', 'OTT', 'Ottawa'], sport: 'NHL' },
  { canonical: 'Philadelphia Flyers', aliases: ['Flyers', 'PHI', 'Philadelphia'], sport: 'NHL' },
  { canonical: 'Pittsburgh Penguins', aliases: ['Penguins', 'Pens', 'PIT', 'Pittsburgh'], sport: 'NHL' },
  { canonical: 'San Jose Sharks', aliases: ['Sharks', 'SJS', 'San Jose'], sport: 'NHL' },
  { canonical: 'Seattle Kraken', aliases: ['Kraken', 'SEA', 'Seattle'], sport: 'NHL' },
  { canonical: 'St. Louis Blues', aliases: ['Blues', 'STL', 'St Louis Blues', 'Saint Louis Blues'], sport: 'NHL' },
  { canonical: 'Tampa Bay Lightning', aliases: ['Lightning', 'Bolts', 'TBL', 'Tampa Bay'], sport: 'NHL' },
  { canonical: 'Toronto Maple Leafs', aliases: ['Maple Leafs', 'Leafs', 'TOR', 'Toronto'], sport: 'NHL' },
  { canonical: 'Utah Hockey Club', aliases: ['Utah HC', 'UTA', 'Utah'], sport: 'NHL' },
  { canonical: 'Vancouver Canucks', aliases: ['Canucks', 'VAN', 'Vancouver'], sport: 'NHL' },
  { canonical: 'Vegas Golden Knights', aliases: ['Golden Knights', 'VGK', 'Vegas'], sport: 'NHL' },
  { canonical: 'Washington Capitals', aliases: ['Capitals', 'Caps', 'WSH', 'Washington'], sport: 'NHL' },
  { canonical: 'Winnipeg Jets', aliases: ['Jets', 'WPG', 'Winnipeg'], sport: 'NHL' },

  // ─── MLB (30 teams) ──────────────────────────────────────────────────
  { canonical: 'Arizona Diamondbacks', aliases: ['Diamondbacks', 'D-backs', 'ARI', 'Arizona'], sport: 'MLB' },
  { canonical: 'Atlanta Braves', aliases: ['Braves', 'ATL', 'Atlanta'], sport: 'MLB' },
  { canonical: 'Baltimore Orioles', aliases: ['Orioles', 'Os', 'BAL', 'Baltimore'], sport: 'MLB' },
  { canonical: 'Boston Red Sox', aliases: ['Red Sox', 'BOS', 'Boston'], sport: 'MLB' },
  { canonical: 'Chicago Cubs', aliases: ['Cubs', 'CHC', 'Chicago Cubs'], sport: 'MLB' },
  { canonical: 'Chicago White Sox', aliases: ['White Sox', 'CWS', 'CHW', 'Chicago White Sox'], sport: 'MLB' },
  { canonical: 'Cincinnati Reds', aliases: ['Reds', 'CIN', 'Cincinnati'], sport: 'MLB' },
  { canonical: 'Cleveland Guardians', aliases: ['Guardians', 'CLE', 'Cleveland'], sport: 'MLB' },
  { canonical: 'Colorado Rockies', aliases: ['Rockies', 'COL', 'Colorado'], sport: 'MLB' },
  { canonical: 'Detroit Tigers', aliases: ['Tigers', 'DET', 'Detroit'], sport: 'MLB' },
  { canonical: 'Houston Astros', aliases: ['Astros', 'HOU', 'Houston'], sport: 'MLB' },
  { canonical: 'Kansas City Royals', aliases: ['Royals', 'KC', 'KCR', 'Kansas City'], sport: 'MLB' },
  { canonical: 'Los Angeles Angels', aliases: ['Angels', 'LAA', 'LA Angels', 'Anaheim Angels'], sport: 'MLB' },
  { canonical: 'Los Angeles Dodgers', aliases: ['Dodgers', 'LAD', 'LA Dodgers'], sport: 'MLB' },
  { canonical: 'Miami Marlins', aliases: ['Marlins', 'MIA', 'Miami'], sport: 'MLB' },
  { canonical: 'Milwaukee Brewers', aliases: ['Brewers', 'MIL', 'Milwaukee'], sport: 'MLB' },
  { canonical: 'Minnesota Twins', aliases: ['Twins', 'MIN', 'Minnesota'], sport: 'MLB' },
  { canonical: 'New York Mets', aliases: ['Mets', 'NYM', 'NY Mets'], sport: 'MLB' },
  { canonical: 'New York Yankees', aliases: ['Yankees', 'NYY', 'NY Yankees'], sport: 'MLB' },
  { canonical: 'Oakland Athletics', aliases: ['Athletics', "A's", 'OAK', 'Oakland'], sport: 'MLB' },
  { canonical: 'Philadelphia Phillies', aliases: ['Phillies', 'PHI', 'Philadelphia'], sport: 'MLB' },
  { canonical: 'Pittsburgh Pirates', aliases: ['Pirates', 'PIT', 'Pittsburgh'], sport: 'MLB' },
  { canonical: 'San Diego Padres', aliases: ['Padres', 'SD', 'SDP', 'San Diego'], sport: 'MLB' },
  { canonical: 'San Francisco Giants', aliases: ['Giants', 'SF', 'SFG', 'San Francisco'], sport: 'MLB' },
  { canonical: 'Seattle Mariners', aliases: ['Mariners', 'SEA', 'Seattle'], sport: 'MLB' },
  { canonical: 'St. Louis Cardinals', aliases: ['Cardinals', 'Cards', 'STL', 'St Louis Cardinals', 'Saint Louis Cardinals'], sport: 'MLB' },
  { canonical: 'Tampa Bay Rays', aliases: ['Rays', 'TB', 'TBR', 'Tampa Bay'], sport: 'MLB' },
  { canonical: 'Texas Rangers', aliases: ['Rangers', 'TEX', 'Texas'], sport: 'MLB' },
  { canonical: 'Toronto Blue Jays', aliases: ['Blue Jays', 'Jays', 'TOR', 'Toronto'], sport: 'MLB' },
  { canonical: 'Washington Nationals', aliases: ['Nationals', 'Nats', 'WSH', 'Washington'], sport: 'MLB' },

  // ─── EPL (20 teams) ──────────────────────────────────────────────────
  { canonical: 'Arsenal', aliases: ['Arsenal FC', 'ARS', 'The Gunners', 'Gunners'], sport: 'EPL' },
  { canonical: 'Aston Villa', aliases: ['Aston Villa FC', 'AVL', 'Villa', 'The Villans'], sport: 'EPL' },
  { canonical: 'AFC Bournemouth', aliases: ['Bournemouth', 'BOU', 'The Cherries', 'Cherries'], sport: 'EPL' },
  { canonical: 'Brentford', aliases: ['Brentford FC', 'BRE', 'The Bees', 'Bees'], sport: 'EPL' },
  { canonical: 'Brighton & Hove Albion', aliases: ['Brighton', 'BHA', 'BRI', 'Brighton FC', 'Seagulls'], sport: 'EPL' },
  { canonical: 'Chelsea', aliases: ['Chelsea FC', 'CHE', 'The Blues'], sport: 'EPL' },
  { canonical: 'Crystal Palace', aliases: ['Crystal Palace FC', 'CRY', 'Palace', 'The Eagles'], sport: 'EPL' },
  { canonical: 'Everton', aliases: ['Everton FC', 'EVE', 'The Toffees', 'Toffees'], sport: 'EPL' },
  { canonical: 'Fulham', aliases: ['Fulham FC', 'FUL', 'The Cottagers'], sport: 'EPL' },
  { canonical: 'Ipswich Town', aliases: ['Ipswich', 'IPS', 'Ipswich Town FC', 'The Tractor Boys'], sport: 'EPL' },
  { canonical: 'Leicester City', aliases: ['Leicester', 'LEI', 'Leicester City FC', 'The Foxes', 'Foxes'], sport: 'EPL' },
  { canonical: 'Liverpool', aliases: ['Liverpool FC', 'LIV', 'LFC', 'The Reds'], sport: 'EPL' },
  { canonical: 'Manchester City', aliases: ['Man City', 'MCFC', 'MCI', 'Manchester City FC', 'City'], sport: 'EPL' },
  { canonical: 'Manchester United', aliases: ['Man United', 'Man Utd', 'MUFC', 'MUN', 'Manchester United FC', 'United'], sport: 'EPL' },
  { canonical: 'Newcastle United', aliases: ['Newcastle', 'NEW', 'NUFC', 'Newcastle United FC', 'The Magpies', 'Magpies'], sport: 'EPL' },
  { canonical: 'Nottingham Forest', aliases: ['Nott Forest', 'NFO', 'NOT', 'Nottingham Forest FC', 'Forest'], sport: 'EPL' },
  { canonical: 'Southampton', aliases: ['Southampton FC', 'SOU', 'The Saints', 'Saints'], sport: 'EPL' },
  { canonical: 'Tottenham Hotspur', aliases: ['Tottenham', 'Spurs', 'TOT', 'Tottenham Hotspur FC', 'THFC'], sport: 'EPL' },
  { canonical: 'West Ham United', aliases: ['West Ham', 'WHU', 'West Ham United FC', 'The Hammers', 'Hammers'], sport: 'EPL' },
  { canonical: 'Wolverhampton Wanderers', aliases: ['Wolves', 'WOL', 'Wolverhampton', 'Wolverhampton Wanderers FC'], sport: 'EPL' },

  // ─── La Liga (selected teams) ────────────────────────────────────────
  { canonical: 'FC Barcelona', aliases: ['Barcelona', 'Barca', 'BAR', 'FCB', 'FC Barcelona'], sport: 'La Liga' },
  { canonical: 'Real Madrid', aliases: ['Real Madrid CF', 'RMA', 'Madrid', 'Los Blancos'], sport: 'La Liga' },
  { canonical: 'Atletico Madrid', aliases: ['Atletico', 'ATM', 'Atletico Madrid CF', 'Atleti', 'Atletico de Madrid'], sport: 'La Liga' },

  // ─── Bundesliga (selected teams) ─────────────────────────────────────
  { canonical: 'Bayern Munich', aliases: ['Bayern', 'FCB', 'FC Bayern', 'FC Bayern Munich', 'Bayern Munchen', 'FC Bayern Munchen'], sport: 'Bundesliga' },
  { canonical: 'Borussia Dortmund', aliases: ['Dortmund', 'BVB', 'Borussia Dortmund FC'], sport: 'Bundesliga' },
];

export function seedTeamAliases(): void {
  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO team_aliases (id, canonical_name, alias, sport) VALUES (?, ?, ?, ?)',
  );

  const runBatch = db.transaction((teams: TeamDef[]) => {
    for (const team of teams) {
      // Always include canonical name as an alias so lookups work both ways
      const allAliases = new Set([team.canonical, ...team.aliases]);
      for (const alias of allAliases) {
        insert.run(uuid(), team.canonical, alias, team.sport);
      }
    }
  });

  runBatch(TEAMS);
  console.log('[sports] Team aliases seeded');
}
