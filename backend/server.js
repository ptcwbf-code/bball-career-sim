/**
 * BBALL CAREER SIMULATOR — backend
 * Node.js + Express + SQLite (node:sqlite, no ORM).
 *
 * Run:  cd backend && npm install && npm start
 * Then open http://localhost:3000
 */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');

// ------------------------------------------------------------
// Config
// ------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT, 'frontend');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'database', 'app.db');
const INIT_SQL = path.join(ROOT, 'database', 'init.sql');

// ------------------------------------------------------------
// Database
// ------------------------------------------------------------
const fs = require('fs');
const db = new DatabaseSync(DB_PATH);
db.exec(fs.readFileSync(INIT_SQL, 'utf8'));
// WAL + relaxed sync makes the many small writes (league simulation) far cheaper;
// durability tradeoff is acceptable for a single-player sim.
try { db.exec('PRAGMA journal_mode=WAL'); db.exec('PRAGMA synchronous=NORMAL'); } catch(e) { console.warn('sqlite pragma setup failed', e); }

// Add columns missing from pre-existing databases (idempotent migration).
function migrateColumns(table, columns) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name));
  for (const [col, ddl] of Object.entries(columns)) {
    if (!existing.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
  }
}
migrateColumns('game_logs', {
  q1_t: 'INTEGER DEFAULT 0', q1_o: 'INTEGER DEFAULT 0',
  q2_t: 'INTEGER DEFAULT 0', q2_o: 'INTEGER DEFAULT 0',
  q3_t: 'INTEGER DEFAULT 0', q3_o: 'INTEGER DEFAULT 0',
  q4_t: 'INTEGER DEFAULT 0', q4_o: 'INTEGER DEFAULT 0',
  team_reb: 'INTEGER DEFAULT 0', team_ast: 'INTEGER DEFAULT 0', team_tov: 'INTEGER DEFAULT 0',
  team_fgm: 'INTEGER DEFAULT 0', team_fga: 'INTEGER DEFAULT 0', team_3pm: 'INTEGER DEFAULT 0', team_3pa: 'INTEGER DEFAULT 0',
  opp_reb: 'INTEGER DEFAULT 0', opp_ast: 'INTEGER DEFAULT 0', opp_tov: 'INTEGER DEFAULT 0',
  opp_fgm: 'INTEGER DEFAULT 0', opp_fga: 'INTEGER DEFAULT 0', opp_3pm: 'INTEGER DEFAULT 0', opp_3pa: 'INTEGER DEFAULT 0',
});
// World isolation migration: league_state and team_records were previously global
// singletons shared by every career. Promote them to per-player so each save/career
// owns an independent world (its own season counter, phase, and league standings).
function migrateWorldIsolation() {
  const lsCols = new Set(db.prepare('PRAGMA table_info(league_state)').all().map(r => r.name));
  if (!lsCols.has('player_id')) {
    const old = db.prepare('SELECT * FROM league_state WHERE id=1').get();
    db.exec('DROP TABLE league_state');
    db.exec(`CREATE TABLE league_state (
      player_id TEXT PRIMARY KEY,
      current_season INTEGER DEFAULT 1,
      current_phase TEXT DEFAULT 'regular_season',
      games_played_in_season INTEGER DEFAULT 0,
      playoff_round INTEGER DEFAULT 0,
      series_wins INTEGER DEFAULT 0,
      series_losses INTEGER DEFAULT 0,
      playoff_opponent INTEGER DEFAULT 0,
      player_seed INTEGER DEFAULT 0,
      opponent_seed INTEGER DEFAULT 0,
      market REAL DEFAULT 0
    )`);
    if (old) {
      const ins = db.prepare(`INSERT INTO league_state (player_id,current_season,current_phase,games_played_in_season,playoff_round,series_wins,series_losses,playoff_opponent,player_seed,opponent_seed) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const p of db.prepare('SELECT id FROM players').all()) {
        ins.run(p.id, old.current_season, old.current_phase, old.games_played_in_season, old.playoff_round ?? 0, old.series_wins ?? 0, old.series_losses ?? 0, old.playoff_opponent ?? 0, old.player_seed ?? 0, old.opponent_seed ?? 0);
      }
    }
  }
  const trCols = new Set(db.prepare('PRAGMA table_info(team_records)').all().map(r => r.name));
  if (!trCols.has('player_id')) {
    const old = db.prepare('SELECT * FROM team_records').all();
    db.exec('DROP TABLE team_records');
    db.exec(`CREATE TABLE team_records (
      player_id TEXT NOT NULL, team_id INTEGER NOT NULL, season_number INTEGER NOT NULL,
      wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
      PRIMARY KEY (player_id, team_id, season_number)
    )`);
    // Backfill to the most-recently-updated player (the "active" career) so their
    // standings continue; every other career re-projects from scratch.
    if (old.length) {
      const owner = db.prepare('SELECT id FROM players ORDER BY updated_at DESC LIMIT 1').get();
      if (owner) {
        const ins = db.prepare('INSERT INTO team_records (player_id,team_id,season_number,wins,losses) VALUES (?,?,?,?,?)');
        for (const r of old) ins.run(owner.id, r.team_id, r.season_number, r.wins, r.losses);
      }
    }
  }
}
migrateWorldIsolation();
migrateColumns('league_state', { market: 'REAL DEFAULT 0' });
migrateColumns('media_events', { scenario_id: 'TEXT' });
migrateColumns('players', {
  p_pts: 'REAL DEFAULT 0', p_reb: 'REAL DEFAULT 0', p_ast: 'REAL DEFAULT 0',
  p_stl: 'REAL DEFAULT 0', p_blk: 'REAL DEFAULT 0', p_tov: 'REAL DEFAULT 0',
  p_fga: 'REAL DEFAULT 0', p_fgm: 'REAL DEFAULT 0', p_3pa: 'REAL DEFAULT 0',
  p_3pm: 'REAL DEFAULT 0', p_fta: 'REAL DEFAULT 0', p_ftm: 'REAL DEFAULT 0',
  p_games: 'INTEGER DEFAULT 0', p_min: 'REAL DEFAULT 0', p_pf: 'INTEGER DEFAULT 0',
  p_wins: 'INTEGER DEFAULT 0', p_losses: 'INTEGER DEFAULT 0',
  background: "TEXT DEFAULT 'small_town'",
  dev_focus: 'TEXT', last_dev_game: 'INTEGER DEFAULT 0',
  retired: 'INTEGER DEFAULT 0',
  retirement_pending: 'INTEGER DEFAULT 0',
  injury_treatment: 'TEXT',
  rebounding: 'INTEGER DEFAULT 40',
  lifestyle: 'INTEGER DEFAULT 1',
  advisor_trust: 'INTEGER DEFAULT 65',
  locker_actions_used: 'INTEGER DEFAULT 0',
  pending_weekend: 'INTEGER DEFAULT 0',
  pending_option: 'INTEGER DEFAULT 0',
  second_life_years: 'INTEGER DEFAULT 0',
  growth: "TEXT DEFAULT 'steady'",
  second_life: 'TEXT',
  legacy_score: 'REAL DEFAULT 0',
  s_fga_mid: 'REAL DEFAULT 0', p_fga_mid: 'REAL DEFAULT 0',
  tactics_defense: "TEXT DEFAULT 'balanced'", tactics_offense: "TEXT DEFAULT 'balanced'",
  life_values: "TEXT DEFAULT '{}'", flags: "TEXT DEFAULT '[]'",
  goat_bonus: 'REAL DEFAULT 0',
  media_pending: 'TEXT',
  nationality: "TEXT DEFAULT 'USA'",
});
migrateColumns('ai_players', { growth: "TEXT DEFAULT 'steady'", injury_games: 'INTEGER DEFAULT 0', rest_games: 'INTEGER DEFAULT 0', salary: 'REAL DEFAULT 0' });
migrateColumns('investments', { asset_type: "TEXT DEFAULT 'stocks'", lock_season: 'INTEGER DEFAULT 0' });
migrateColumns('contracts', { player_option: 'INTEGER DEFAULT 0', no_trade: 'INTEGER DEFAULT 0' });
migrateColumns('season_summaries', {
  p_games: 'INTEGER DEFAULT 0', p_ppg: 'REAL DEFAULT 0', p_rpg: 'REAL DEFAULT 0',
  p_apg: 'REAL DEFAULT 0', p_spg: 'REAL DEFAULT 0', p_bpg: 'REAL DEFAULT 0',
  p_topg: 'REAL DEFAULT 0', p_mpg: 'REAL DEFAULT 0', p_fg_pct: 'REAL DEFAULT 0',
  p_tp_pct: 'REAL DEFAULT 0', p_ft_pct: 'REAL DEFAULT 0',
});
migrateColumns('league_state', { intl_tournament: 'TEXT', game_mode: "TEXT DEFAULT 'classic'", lang: "TEXT DEFAULT 'en'" });

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function randRange(a, b) { return a + Math.random() * (b - a); }
function choice(list) { return list[Math.floor(Math.random() * list.length)]; }

function gauss(mean, std = 15) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * std;
}
function roll(mean, std = 15) { return clamp(Math.round(gauss(mean, std)), 1, 99); }

// Weighted random choice. `w` maps keys to numeric weights.
function weightedChoice(w) {
  const entries = Object.entries(w);
  const total = entries.reduce((s, [, wt]) => s + wt, 0);
  if (total <= 0) return entries[Math.floor(Math.random() * entries.length)][0];
  let r = Math.random() * total;
  let acc = 0;
  for (const [k, wt] of entries) { acc += wt; if (r <= acc) return k; }
  return entries[entries.length - 1][0];
}

class HttpError extends Error {
  constructor(status, detail) { super(detail); this.status = status; }
}
function httpError(status, detail) { return new HttpError(status, detail); }

function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }

// Pick a localized string from an {en, zh} pair (or pass through a plain string).
function pick(v, lang) {
  if (v && typeof v === 'object' && !Array.isArray(v) && ('en' in v || 'zh' in v)) return v[lang] || v.en || '';
  return v;
}

// ------------------------------------------------------------
// Team data
// ------------------------------------------------------------
const TEAMS = {
  1: { name: 'Atlanta Hawks', abbr: 'ATL', conf: 'East', div: 'Southeast', off: 112, def: 114, ovr: 78 },
  2: { name: 'Boston Celtics', abbr: 'BOS', conf: 'East', div: 'Atlantic', off: 120, def: 108, ovr: 95 },
  3: { name: 'Brooklyn Nets', abbr: 'BKN', conf: 'East', div: 'Atlantic', off: 108, def: 113, ovr: 72 },
  4: { name: 'Charlotte Hornets', abbr: 'CHA', conf: 'East', div: 'Southeast', off: 106, def: 115, ovr: 65 },
  5: { name: 'Chicago Bulls', abbr: 'CHI', conf: 'East', div: 'Central', off: 110, def: 112, ovr: 74 },
  6: { name: 'Cleveland Cavaliers', abbr: 'CLE', conf: 'East', div: 'Central', off: 115, def: 110, ovr: 85 },
  7: { name: 'Detroit Pistons', abbr: 'DET', conf: 'East', div: 'Central', off: 105, def: 113, ovr: 62 },
  8: { name: 'Indiana Pacers', abbr: 'IND', conf: 'East', div: 'Central', off: 116, def: 113, ovr: 80 },
  9: { name: 'Miami Heat', abbr: 'MIA', conf: 'East', div: 'Southeast', off: 111, def: 109, ovr: 82 },
  10: { name: 'Milwaukee Bucks', abbr: 'MIL', conf: 'East', div: 'Central', off: 117, def: 109, ovr: 88 },
  11: { name: 'New York Knicks', abbr: 'NYK', conf: 'East', div: 'Atlantic', off: 114, def: 108, ovr: 86 },
  12: { name: 'Orlando Magic', abbr: 'ORL', conf: 'East', div: 'Southeast', off: 110, def: 110, ovr: 79 },
  13: { name: 'Philadelphia 76ers', abbr: 'PHI', conf: 'East', div: 'Atlantic', off: 116, def: 110, ovr: 84 },
  14: { name: 'Toronto Raptors', abbr: 'TOR', conf: 'East', div: 'Atlantic', off: 109, def: 112, ovr: 70 },
  15: { name: 'Washington Wizards', abbr: 'WAS', conf: 'East', div: 'Southeast', off: 107, def: 116, ovr: 60 },
  16: { name: 'Dallas Mavericks', abbr: 'DAL', conf: 'West', div: 'Southwest', off: 118, def: 111, ovr: 87 },
  17: { name: 'Denver Nuggets', abbr: 'DEN', conf: 'West', div: 'Northwest', off: 119, def: 110, ovr: 92 },
  18: { name: 'Golden State Warriors', abbr: 'GSW', conf: 'West', div: 'Pacific', off: 115, def: 111, ovr: 83 },
  19: { name: 'Houston Rockets', abbr: 'HOU', conf: 'West', div: 'Southwest', off: 111, def: 112, ovr: 76 },
  20: { name: 'LA Clippers', abbr: 'LAC', conf: 'West', div: 'Pacific', off: 115, def: 109, ovr: 84 },
  21: { name: 'Los Angeles Lakers', abbr: 'LAL', conf: 'West', div: 'Pacific', off: 114, def: 111, ovr: 83 },
  22: { name: 'Memphis Grizzlies', abbr: 'MEM', conf: 'West', div: 'Southwest', off: 113, def: 109, ovr: 83 },
  23: { name: 'Minnesota Timberwolves', abbr: 'MIN', conf: 'West', div: 'Northwest', off: 114, def: 107, ovr: 88 },
  24: { name: 'New Orleans Pelicans', abbr: 'NOP', conf: 'West', div: 'Southwest', off: 113, def: 111, ovr: 80 },
  25: { name: 'Oklahoma City Thunder', abbr: 'OKC', conf: 'West', div: 'Northwest', off: 119, def: 106, ovr: 96 },
  26: { name: 'Phoenix Suns', abbr: 'PHX', conf: 'West', div: 'Pacific', off: 115, def: 112, ovr: 81 },
  27: { name: 'Portland Trail Blazers', abbr: 'POR', conf: 'West', div: 'Northwest', off: 107, def: 115, ovr: 64 },
  28: { name: 'Sacramento Kings', abbr: 'SAC', conf: 'West', div: 'Pacific', off: 114, def: 113, ovr: 78 },
  29: { name: 'San Antonio Spurs', abbr: 'SAS', conf: 'West', div: 'Southwest', off: 110, def: 112, ovr: 73 },
  30: { name: 'Utah Jazz', abbr: 'UTA', conf: 'West', div: 'Northwest', off: 108, def: 114, ovr: 66 },
};
const ALL_TEAM_IDS = Object.keys(TEAMS).map(Number);

// ------------------------------------------------------------
// Position / build system
// ------------------------------------------------------------
const POSITION_PROFILES = {
  PG: { label: 'Point Guard', icon: '🎯', height_range: [1.83, 1.96], weight_range: [77, 93], base_points: 260,
        aptitudes: { athleticism: 45, defense: 40, scoring: 55, playmaking: 65, mental: 55 } },
  SG: { label: 'Shooting Guard', icon: '🔥', height_range: [1.91, 2.03], weight_range: [84, 102], base_points: 250,
        aptitudes: { athleticism: 45, defense: 40, scoring: 65, playmaking: 45, mental: 55 } },
  SF: { label: 'Small Forward', icon: '⚡', height_range: [1.98, 2.08], weight_range: [93, 112], base_points: 245,
        aptitudes: { athleticism: 50, defense: 50, scoring: 55, playmaking: 35, mental: 55 } },
  PF: { label: 'Power Forward', icon: '💪', height_range: [2.03, 2.13], weight_range: [102, 122], base_points: 240,
        aptitudes: { athleticism: 55, defense: 60, scoring: 45, playmaking: 25, mental: 55 } },
  C:  { label: 'Center', icon: '🏔️', height_range: [2.08, 2.21], weight_range: [109, 136], base_points: 235,
        aptitudes: { athleticism: 55, defense: 70, scoring: 35, playmaking: 20, mental: 55 } },
};

const ATTRIBUTE_CATEGORIES = {
  athleticism: { label: 'Athleticism', icon: '⚡',
    attrs: ['vertical_jump', 'speed', 'lateral_quickness', 'strength', 'core_stability', 'stamina', 'durability'] },
  scoring: { label: 'Scoring', icon: '🎯',
    attrs: ['first_step', 'finishing', 'mid_range', 'catch_shoot_3pt', 'pull_up_3pt', 'off_ball', 'drawing_fouls', 'free_throw'] },
  playmaking: { label: 'Playmaking', icon: '👁️',
    attrs: ['ball_security', 'pnr_vision', 'passing_accuracy'] },
  defense: { label: 'Defense', icon: '🛡️',
    attrs: ['perimeter_defense', 'help_defense', 'steal', 'rim_protection', 'box_out'] },
  mental: { label: 'Basketball IQ', icon: '🧠',
    attrs: ['bbiq', 'clutch_factor', 'work_ethic', 'leadership', 'composure'] },
};

// Default on-court role per position — ball-handlers get playmaking-friendly roles.
const POSITION_ROLE = {
  PG: 'Ball-Dominant Creator',
  SG: 'Off-Ball Finisher',
  SF: 'Two-Way Wing',
  PF: 'Stretch Big',
  C: 'Defensive Anchor',
};

// Position-based defensive tendencies: guards grab few boards but rack up steals;
// bigs own the glass and block shots. Multipliers applied in resolveDefense.
const POSITION_DEFENSE = {
  PG: { reb: 0.30, stl: 1.6, blk: 0.12 },
  SG: { reb: 0.45, stl: 1.3, blk: 0.25 },
  SF: { reb: 0.75, stl: 1.0, blk: 0.55 },
  PF: { reb: 1.05, stl: 0.65, blk: 1.1 },
  C:  { reb: 1.25, stl: 0.45, blk: 1.8 },
};

// Player origin stories (background) — chosen at creation, give a starting edge
// and flavour. Effects are applied on top of the point-buy build.
const BACKGROUNDS = {
  basketball_royalty: { label: 'Basketball Royalty', icon: '👑',
    desc: 'Raised in an NBA family. Polished from day one, but carrying a famous name means pressure.',
    effects: { bbiq: 3, composure: 2, fan_base: 12, morale: -4 } },
  inner_city: { label: 'Inner-City Grinder', icon: '🏙️',
    desc: 'Fought for every possession on cracked courts. Relentless work ethic and toughness.',
    effects: { work_ethic: 5, strength: 2, stamina: 2 } },
  overseas_pro: { label: 'Overseas Prodigy', icon: '🌍',
    desc: 'Turned pro abroad as a teenager. Seasoned beyond his years.',
    effects: { bbiq: 2, composure: 3, mid_range: 2 } },
  small_town: { label: 'Small-Town Star', icon: '🌾',
    desc: 'The biggest name in a tiny town. Untested, but bursting with upside and confidence.',
    effects: { potential: 6, work_ethic: 2, morale: 5 } },
  late_bloomer: { label: 'Late Bloomer', icon: '🌱',
    desc: 'Discovered the game at 15 after a growth spurt. Raw, but the ceiling is enormous.',
    effects: { potential: 8, vertical_jump: 2, bbiq: -2, composure: -2 } },
};

// Attributes that can be developed mid-season (training focus + auto development).
const DEVELOPABLE_ATTRS = [
  'mid_range', 'catch_shoot_3pt', 'pull_up_3pt', 'finishing', 'first_step', 'free_throw',
  'ball_security', 'pnr_vision', 'passing_accuracy', 'perimeter_defense', 'help_defense', 'steal',
  'box_out', 'rebounding', 'vertical_jump', 'speed', 'lateral_quickness', 'strength', 'stamina', 'bbiq', 'composure',
];

// Growth archetypes — how a player's career arc is shaped. Each has a peak age,
// a development multiplier, a decline multiplier, and a "bust" chance (the odds
// of stalling short of potential each offseason). This breaks the old one-size
// curve: prodigies burn bright and peak early, late bloomers arrive at 30,
// grinders age gracefully, and some high-upside players fizzle out.
const GROWTH_ARCHETYPES = {
  prodigy: { label: 'Prodigy', peak: 27, dev: 1.35, decline: 1.0, bust: 0.25 },
  steady:  { label: 'Steady', peak: 28, dev: 1.0, decline: 1.0, bust: 0.12 },
  late:    { label: 'Late Bloomer', peak: 30, dev: 0.75, decline: 0.65, bust: 0.2 },
  ageless: { label: 'Aging Gracefully', peak: 29, dev: 0.9, decline: 0.45, bust: 0.1 },
  fizzle:  { label: 'Flash in the Pan', peak: 26, dev: 1.2, decline: 1.35, bust: 0.5 },
};

// A created player's arc branches on their origin story, with a dash of luck.
// Backgrounds steer the archetype; high work ethic outworks the "bust" label.
function rollGrowthArchetype(background, workEthic) {
  const bgMap = { late_bloomer: 'late', basketball_royalty: 'prodigy', overseas_pro: 'steady', inner_city: 'ageless' };
  let key;
  if (bgMap[background]) key = bgMap[background];
  else key = weightedChoice({ steady: 45, prodigy: 15, late: 15, ageless: 10, fizzle: 15 });
  if (key === 'fizzle' && (workEthic ?? 50) >= 70) key = 'steady';
  return key;
}

// ------------------------------------------------------------
// Player creation (point-buy)
// ------------------------------------------------------------
function calculatePointPool(position, height, weight, luckBonus = null) {
  const profile = POSITION_PROFILES[position];
  const base = profile.base_points;
  const hMid = (profile.height_range[0] + profile.height_range[1]) / 2;
  const hDev = (height - hMid) / (profile.height_range[1] - profile.height_range[0]);
  const heightBonus = Math.round(hDev * 15);
  const wMid = (profile.weight_range[0] + profile.weight_range[1]) / 2;
  const wDev = (weight - wMid) / (profile.weight_range[1] - profile.weight_range[0]);
  const weightBonus = Math.round(wDev * 8);
  const luck = luckBonus != null ? luckBonus : randInt(-12, 12);
  const totalPoints = base + heightBonus + weightBonus + luck;

  const aptitudes = { ...profile.aptitudes };
  if (hDev > 0.3) { aptitudes.defense += 3; aptitudes.athleticism += 2; aptitudes.scoring -= 2; }
  else if (hDev < -0.3) { aptitudes.scoring += 3; aptitudes.playmaking += 2; aptitudes.defense -= 2; }

  return { total_points: totalPoints, base, height_bonus: heightBonus, weight_bonus: weightBonus,
           luck_bonus: luck, aptitudes, height_deviation: round2(hDev), weight_deviation: round2(wDev) };
}

function generateStaticPhysicals(position, height, weight) {
  const posCfg = { PG: [1.00, 1.06], SG: [1.01, 1.08], SF: [1.02, 1.10], PF: [1.03, 1.12], C: [1.04, 1.15] };
  const [wsLo, wsHi] = posCfg[position] || [1.01, 1.10];
  const wingspan = round2(height * randRange(wsLo, wsHi));
  const standingReach = round2(height * 1.28 + (wingspan - height) * 0.45);
  const handSize = round1(randRange(20.0, 28.5));
  const frame = roll(50, 18);
  const bodyFat = round1(randRange(5.5, 14.0));
  return { wingspan, standing_reach: standingReach, hand_size: handSize, frame_build: frame, body_fat_pct: bodyFat };
}

function createPlayerWithPoints(name, position, age, height, weight, allocations, luckBonus = null, background = 'small_town', nationality = 'USA') {
  const pid = crypto.randomBytes(4).toString('hex');
  const poolInfo = calculatePointPool(position, height, weight, luckBonus);
  const attrs = {};
  for (const [cat, catInfo] of Object.entries(ATTRIBUTE_CATEGORIES)) {
    const catPoints = allocations[cat] ?? poolInfo.aptitudes[cat] ?? 30;
    // Average attribute level scales with points allocated (independent of category size).
    // A wider per-attribute spread gives every prospect a distinctive build.
    const avg = 22 + catPoints * 0.8;
    for (const attr of catInfo.attrs) attrs[attr] = clamp(Math.round(avg + gauss(0, 5.5)), 18, 94);
  }
  const phys = generateStaticPhysicals(position, height, weight);
  let potential = clamp(roll(50, 22), 18, 99);
  const teamId = choice(ALL_TEAM_IDS);
  const jersey = randInt(0, 55);
  const role = POSITION_ROLE[position] || 'Two-Way Wing';

  // Origin story: adjust starting attributes and intangibles.
  const bg = BACKGROUNDS[background] ? background : 'small_town';
  const bgFx = BACKGROUNDS[bg].effects;
  let fanBase = clamp(5 + (bgFx.fan_base ?? 0), 0, 100);
  let morale = clamp(75 + (bgFx.morale ?? 0), 10, 100);
  for (const [k, v] of Object.entries(bgFx)) {
    if (k === 'potential') potential = clamp(potential + v, 18, 99);
    else if (k === 'fan_base') fanBase = clamp(fanBase + v, 0, 100);
    else if (k === 'morale') morale = clamp(morale + v, 10, 100);
    else attrs[k] = clamp((attrs[k] ?? 50) + v, 18, 94);
  }

  // Rebounding inherits the point-bought box-out skill at creation, then grows
  // independently through training and development.
  attrs.rebounding = attrs.box_out ?? 40;

  // Height/weight shape the physical profile — taller players block & rebound
  // more but are slower and less springy; heavier players are stronger but slower.
  // Strength scales with weight *relative to height*: a very tall but light frame
  // isn't actually strong, and a short, heavy frame is a bowling ball.
  const bp = POSITION_PROFILES[position];
  const hDev = (height - (bp.height_range[0] + bp.height_range[1]) / 2) / (bp.height_range[1] - bp.height_range[0]); // -0.5..0.5
  const wDev = (weight - (bp.weight_range[0] + bp.weight_range[1]) / 2) / (bp.weight_range[1] - bp.weight_range[0]); // -0.5..0.5
  const adj = (k, d) => { attrs[k] = clamp(Math.round((attrs[k] ?? 50) + d), 18, 94); };
  adj('rim_protection', hDev * 18);             // height → blocks
  adj('rebounding', hDev * 14 + wDev * 6);      // height (reach) + mass (box-out position)
  adj('box_out', hDev * 6 + wDev * 12);         // boxing out is mostly about mass
  adj('vertical_jump', -(hDev * 8 + wDev * 6));
  adj('speed', -(hDev * 8 + wDev * 8));
  adj('lateral_quickness', -hDev * 6);
  adj('strength', wDev * 14 - hDev * 6);        // weight relative to height → strength
  adj('core_stability', wDev * 6);
  // Position shapes the defensive archetype: bigs protect the rim but struggle on
  // the perimeter; guards chase ball-handlers but can't challenge at the rim.
  const pd = POSITION_DEFENSE[position] || { blk: 1, stl: 1 };
  adj('rim_protection', Math.round((pd.blk - 1) * 18));    // C(1.8)→+14, PG(0.12)→−16
  adj('perimeter_defense', Math.round((1 - pd.blk) * 10)); // C→−8, PG→+9
  adj('steal', Math.round((pd.stl - 1) * 12));             // PG(1.6)→+7, C(0.45)→−7

  const growth = rollGrowthArchetype(bg, attrs.work_ethic ?? 50);
  const g = (k, d) => attrs[k] ?? d;
  const cols = ['id', 'name', 'position', 'role', 'height', 'weight', 'age', 'team_id', 'jersey_number',
    'wingspan', 'standing_reach', 'hand_size', 'frame_build', 'body_fat_pct', 'potential', 'growth',
    'vertical_jump', 'speed', 'lateral_quickness', 'strength', 'core_stability', 'stamina', 'durability',
    'perimeter_defense', 'help_defense', 'steal', 'rim_protection', 'box_out', 'rebounding',
    'first_step', 'finishing', 'mid_range', 'catch_shoot_3pt', 'pull_up_3pt', 'off_ball', 'drawing_fouls',
    'ball_security', 'pnr_vision', 'passing_accuracy', 'free_throw',
    'bbiq', 'clutch_factor', 'work_ethic', 'leadership', 'composure',
    'fan_base', 'morale', 'background', 'nationality'];
  const vals = [pid, name, position, role, height, weight, age, teamId, jersey,
    phys.wingspan, phys.standing_reach, phys.hand_size, phys.frame_build, phys.body_fat_pct, potential, growth,
    g('vertical_jump', 45), g('speed', 45), g('lateral_quickness', 45), g('strength', 45), g('core_stability', 45), g('stamina', 55), g('durability', 55),
    g('perimeter_defense', 40), g('help_defense', 40), g('steal', 35), g('rim_protection', 40), g('box_out', 40), g('rebounding', 40),
    g('first_step', 40), g('finishing', 40), g('mid_range', 40), g('catch_shoot_3pt', 35), g('pull_up_3pt', 30), g('off_ball', 40), g('drawing_fouls', 35),
    g('ball_security', 45), g('pnr_vision', 40), g('passing_accuracy', 40), g('free_throw', 65),
    g('bbiq', 50), g('clutch_factor', 50), g('work_ethic', 50), g('leadership', 40), g('composure', 50),
    fanBase, morale, bg, nationality];

  db.prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
  const sal = round1(randRange(1.0, 8.0));
  db.prepare("INSERT INTO contracts (player_id,season_number,team_id,years,total_value,annual_salary,contract_type) VALUES (?,0,?,3,?,?,'Rookie')")
    .run(pid, teamId, sal * 3, sal);
  ensureLeaguePlayers(pid);
  syncTeammates(pid);
  return pid;
}

// ------------------------------------------------------------
// Draft system
// ------------------------------------------------------------
const FIRST_NAMES = ['Jalen', 'Marcus', 'DeAndre', 'Malik', 'Isaiah', 'Cameron', 'Jordan', 'Donte', 'Terrence', 'Amari', 'Kai', 'Zion', 'Elijah', 'Bryce', 'Xavier', 'Jayden', 'Tariq', 'Desmond', 'Roman', 'Andre', 'Kobe', 'Tyler', 'Jamal', 'Brandon', 'Darius', 'Shawn', 'Trey', 'Malcolm', 'Derek', 'Quinn'];
const LAST_NAMES = ['Williams', 'Johnson', 'Thompson', 'Carter', 'Henderson', 'Mitchell', 'Robinson', 'Washington', 'Griffin', 'Bridges', 'Walker', 'Reeves', 'Anderson', 'Parker', 'Martinez', 'Okafor', 'Murphy', 'Chen', 'Santos', 'Bell', 'Pierce', 'Hughes', 'Monroe', 'Fox', 'Stone', 'Cross', 'Bennett', 'Knight', 'Reid', 'Blake'];

function generateDraftClass() {
  const prospects = [];
  for (let i = 0; i < 60; i++) {
    const pos = weightedChoice({ PG: 16, SG: 18, SF: 20, PF: 22, C: 14 });
    const profile = POSITION_PROFILES[pos];
    const name = `${choice(FIRST_NAMES)} ${choice(LAST_NAMES)}`;
    const height = round2(randRange(profile.height_range[0], profile.height_range[1]));
    const weight = round1(randRange(profile.weight_range[0], profile.weight_range[1]));
    const age = randInt(19, 22);
    // Realistic rookie curve: generational talents are rare, 80+ is a top-3
    // pick, and nobody enters the league at 90+. The tail is long and flat.
    const tr = Math.random();
    let overall;
    if (tr < 0.01) overall = roll(85, 3);      // generational (~once every 2 classes)
    else if (tr < 0.04) overall = roll(78, 5);  // franchise cornerstone (~2/class)
    else if (tr < 0.14) overall = roll(72, 6);  // all-star ceiling (~6/class)
    else if (tr < 0.36) overall = roll(64, 7);  // starter (~13/class)
    else if (tr < 0.70) overall = roll(56, 8);  // rotation (~20/class)
    else overall = roll(49, 9);                 // bench / draft-and-stash (~18/class)
    overall = clamp(overall, 25, 90);
    const potential = clamp(overall + randInt(-5, 16), 30, 92);
    prospects.push({ id: i + 1, name, position: pos, height, weight, age, overall, potential });
  }
  shuffle(prospects);
  prospects.forEach((p, i) => { p.id = i + 1; });
  return prospects;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function simulateDraftLottery() {
  const weights = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];
  const lotteryOrder = [];
  let available = Array.from({ length: 14 }, (_, i) => i + 1);
  for (let i = 0; i < 4; i++) {
    const w = available.map(id => weights[id - 1]);
    const pick = weightedPick(available, w);
    lotteryOrder.push(pick);
    available = available.filter(x => x !== pick);
  }
  lotteryOrder.push(...available);
  return lotteryOrder;
}

function weightedPick(pop, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pop.length; i++) { r -= weights[i]; if (r <= 0) return pop[i]; }
  return pop[pop.length - 1];
}

function calculateOverallRating(player) {
  const scoring = (player.first_step + player.finishing + player.mid_range + player.catch_shoot_3pt + player.pull_up_3pt) / 5;
  const playmaking = (player.ball_security + player.pnr_vision + player.passing_accuracy) / 3;
  const defense = (player.perimeter_defense + player.help_defense + player.steal + player.rim_protection + player.box_out) / 5;
  const athleticism = (player.vertical_jump + player.speed + player.lateral_quickness + player.strength + player.stamina) / 5;
  const mental = (player.bbiq + player.clutch_factor + player.composure) / 3;
  return clamp(Math.round(scoring * 0.35 + playmaking * 0.15 + defense * 0.2 + athleticism * 0.2 + mental * 0.1), 25, 95);
}

// ------------------------------------------------------------
// Hidden ability rubric — team & player tiers so a created player
// can be read against the league and slotted into a rotation sensibly.
// ------------------------------------------------------------
const TEAM_TIERS = [
  { label: 'Title Contender', min: 86 },
  { label: 'Playoff Team', min: 78 },
  { label: 'Play-In Fringe', min: 72 },
  { label: 'Lottery / Rebuild', min: 0 },
];
const PLAYER_TIERS = [
  { label: 'Superstar', min: 90 },
  { label: 'All-Star', min: 82 },
  { label: 'Starter', min: 72 },
  { label: 'Rotation', min: 62 },
  { label: 'Bench', min: 52 },
  { label: 'Fringe', min: 0 },
];
function tierLabel(rating, tiers) {
  for (const t of tiers) if (rating >= t.min) return t.label;
  return tiers[tiers.length - 1].label;
}
function teamTier(ovr) { return tierLabel(ovr, TEAM_TIERS); }
function playerTier(ovr) { return tierLabel(ovr, PLAYER_TIERS); }

// "Consistency" — how steady a player's game-to-game output is. Derived from
// composure + BBIQ. Higher = steadier (less boom/bust), lower = streaky.
function consistencyRating(p) {
  return clamp(Math.round((p.composure ?? 50) * 0.7 + (p.bbiq ?? 50) * 0.3), 20, 99);
}

function buildDraftOrder(playerId) {
  // Draft order is now driven by the prior season's records: the 14 worst teams
  // enter a weighted lottery (worst team = best odds), the 16 playoff teams pick
  // after them (worst-first), and the second round reverses the order.
  const season = getLeagueState(playerId).current_season;
  let rows = db.prepare('SELECT team_id, wins FROM team_records WHERE player_id=? AND season_number=?').all(playerId, Math.max(1, season - 1));
  if (!rows.length) rows = db.prepare('SELECT team_id, wins FROM team_records WHERE player_id=? AND season_number=?').all(playerId, season);
  const rec = new Map(rows.map(r => [r.team_id, r.wins || 0]));
  // No records yet (first season) → fall back to static team OVR, weakest first.
  const ranked = ALL_TEAM_IDS.slice().sort((a, b) => {
    const hasA = rec.has(a), hasB = rec.has(b);
    if (hasA && hasB) return rec.get(a) - rec.get(b) || a - b;
    if (hasA) return -1;
    if (hasB) return 1;
    return (TEAMS[a].ovr - TEAMS[b].ovr) || a - b;
  });
  const lotteryTeams = ranked.slice(0, 14);
  const nonLottery = ranked.slice(14); // playoff teams, worst-first
  const weights = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];
  const order = [];
  const avail = lotteryTeams.slice();
  for (let i = 0; i < 4; i++) {
    const w = avail.map(tid => weights[lotteryTeams.indexOf(tid)]);
    const idx = weightedPickIndex(w);
    order.push(avail.splice(idx, 1)[0]);
  }
  order.push(...avail);     // remaining lottery teams, worst-first
  order.push(...nonLottery); // playoff teams, worst-first
  return order.concat(order.slice().reverse()).slice(0, 60);
}

function weightedPickIndex(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return weights.length - 1;
}

function simulateDraft(playerId) {
  const player = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!player) throw httpError(404, 'Player not found');
  const overall = calculateOverallRating(player);
  const draftClass = generateDraftClass();
  const draftOrder = buildDraftOrder(playerId);
  const combineSwing = randInt(-8, 8);
  const draftStock = clamp(overall + combineSwing, 25, 95);
  const allProspects = draftClass.map(p => ({ ...p })).concat([
    { id: 0, name: player.name, position: player.position, height: player.height, weight: player.weight, age: player.age, overall: draftStock, potential: player.potential ?? 50, is_player: true },
  ]);
  allProspects.sort((a, b) => b.overall - a.overall);
  const draftPosition = allProspects.findIndex(p => p.is_player) + 1;
  const season = getLeagueState(playerId).current_season;

  // Ranked worse than the 60th pick → undrafted. Sign a two-way deal instead.
  if (draftPosition > 60) {
    const twTeam = choice(ALL_TEAM_IDS);
    db.prepare("UPDATE players SET team_id=?,draft_pick=0,draft_year=?,clout=?,fan_base=?,updated_at=datetime('now') WHERE id=?")
      .run(twTeam, season, 1, 2, playerId);
    db.prepare('UPDATE contracts SET team_id=?,annual_salary=?,total_value=? WHERE player_id=? AND season_number=0')
      .run(twTeam, 0.5, 1.5, playerId);
    db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
      .run(playerId, season, 'event', `Went undrafted and signed a two-way deal with ${TEAMS[twTeam].name}.`);
    syncTeammates(playerId, true);
    return { undrafted: true, draft_position: 0, draft_round: 0, team: TEAMS[twTeam].name, team_abbr: TEAMS[twTeam].abbr,
             combine_swing: combineSwing, draft_stock: draftStock, rookie_salary: 0.5, top_prospects: allProspects.slice(0, 10) };
  }

  const draftedTeamId = draftOrder[draftPosition - 1] ?? choice(ALL_TEAM_IDS);
  const draftedTeam = TEAMS[draftedTeamId] || TEAMS[1];
  const draftRound = draftPosition <= 30 ? 1 : 2;
  const salaryScale = [[1, 10.0], [2, 8.5], [3, 7.5], [4, 6.5], [5, 5.8], [10, 4.0], [15, 3.0], [20, 2.2], [30, 1.8], [45, 1.0]];
  let salary = 1.0;
  for (const [thresh, sal] of salaryScale) { if (draftPosition <= thresh) salary = sal; }

  db.prepare("UPDATE players SET team_id=?,draft_pick=?,draft_year=?,clout=?,fan_base=?,updated_at=datetime('now') WHERE id=?")
    .run(draftedTeamId, draftPosition, season, 2 + draftPosition * 0.3, 3 + draftPosition * 0.5, playerId);
  db.prepare('UPDATE contracts SET team_id=?,annual_salary=?,total_value=? WHERE player_id=? AND season_number=0')
    .run(draftedTeamId, salary, salary * 3, playerId);
  syncTeammates(playerId, true);

  return { draft_position: draftPosition, draft_round: draftRound, team: draftedTeam.name, team_abbr: draftedTeam.abbr,
           combine_swing: combineSwing, draft_stock: draftStock, rookie_salary: salary, top_prospects: allProspects.slice(0, 10) };
}

// ------------------------------------------------------------
// Game simulation engine
// ------------------------------------------------------------
function calculateMinutes(player, overall, isPlayoff = false, fatiguePenalty = 0.0) {
  const exp = player.experience || 0;
  const draftPick = player.draft_pick || 60;
  const stamina = player.stamina ?? 55;

  let mpg = 6 + (overall - 35) * 0.46;
  if (exp === 0) {
    let draftFactor;
    if (draftPick <= 5) draftFactor = 1.05;
    else if (draftPick <= 14) draftFactor = 0.98;
    else if (draftPick <= 30) draftFactor = 0.96 - (draftPick - 15) * 0.012;
    else draftFactor = clamp(0.72 - (draftPick - 31) * 0.010, 0.42, 1.0);
    mpg *= draftFactor;
  } else {
    mpg += Math.min(exp * 1.5, 10);
  }
  mpg += (stamina - 50) * 0.05;
  if (player.load_management) mpg -= 8;
  if (isPlayoff) mpg += 4;
  mpg -= fatiguePenalty * 10;
  // Form shifts minutes: a hot hand earns more run, a cold spell loses it.
  mpg += (player.hot_streak || 0) * 1.2 + (player.cold_streak || 0) * 1.2;
  // Consistency steadies minutes: high-consistency players play near their base
  // every night; low-consistency players see wider swings.
  const consistency = consistencyRating(player);
  mpg += randRange(-5, 5) * (1 - consistency / 100 * 0.6);
  return round1(clamp(mpg, 5, 42));
}

// Pre-game tactics: the player picks a defensive scheme and an offensive pace.
// Each is a trade-off — nothing is free. `tactics_defense`/`tactics_offense`
// live on the player row; 'balanced' leaves the game unchanged.
function tacticModifiers(player) {
  const t = { poss: 0, oppScore: 1, oppThree: 1, oppAst: 1, myThree: 1, myTwo: 1, myTov: 1, fatigue: 0 };
  const d = player.tactics_defense || 'balanced';
  const o = player.tactics_offense || 'balanced';
  // Defense: each scheme cuts opponent scoring a different way, but leaks elsewhere.
  if (d === 'lockdown_star') { t.oppScore = 0.94; t.oppThree = 1.25; }       // over-commit to their star → open threes
  else if (d === 'protect_paint') { t.oppScore = 0.95; t.oppThree = 1.4; }   // pack the paint → dare them to shoot
  else if (d === 'switch_everything') { t.oppScore = 0.96; t.oppAst = 0.7; t.fatigue += 5; } // switch all screens → kill passing, tire yourself
  // Offense: pace and shot mix trade-offs.
  if (o === 'push_pace') { t.poss = 16; t.fatigue += 5; t.oppScore *= 1.03; } // run — both teams score more, you wear down
  else if (o === 'grind_halfcourt') { t.poss = -12; t.myTov = 0.8; t.fatigue -= 4; } // slow it down → fewer possessions/turnovers, less wear
  else if (o === 'three_heavy') { t.myThree = 1.5; t.myTwo = 0.9; }          // live by the three → more variance
  return t;
}

function simulateGame(playerId, opponentTeamId = null, isPlayoff = false, isHome = null) {
  const player = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!player) throw httpError(404, 'Player not found');
  const state = getLeagueState(playerId);
  if (state.current_phase === 'offseason') throw httpError(400, "It's the offseason. Advance to the next season to play games.");
  if (state.current_phase === 'playoffs' && !isPlayoff) throw httpError(400, 'The playoffs are underway — play the playoff series instead.');
  if (!isPlayoff && state.games_played_in_season >= 82) throw httpError(400, 'Season is complete (82 games played). Finalize the season first.');

  // Regular-season opponents always come from the league schedule (never chosen).
  if (!isPlayoff) {
    const schedule = generateSeasonSchedule(player.team_id, playerId);
    const idx = Math.min(state.games_played_in_season, 81);
    opponentTeamId = schedule[idx];
  }
  // Override the frozen static ratings with LIVE roster strength (spread copy so
  // the global TEAMS table is never mutated) — the sim must reflect the evolved
  // league and the player's own rating, not season-1 numbers.
  const oppLive = teamOffDef(playerId, opponentTeamId);
  const teamLive = teamOffDef(playerId, player.team_id);
  const opp = { ...(TEAMS[opponentTeamId] || TEAMS[1]), off: oppLive.off, def: oppLive.def };
  const team = { ...(TEAMS[player.team_id] || TEAMS[1]), off: teamLive.off, def: teamLive.def };

  // Relationship health nudges on-court composure/clutch (and morale, below).
  const lifeBuffs = lifeBondBuffs(playerId);
  player.clutch_factor = clamp((player.clutch_factor || 50) + lifeBuffs.clutch, 1, 99);
  player.composure = clamp((player.composure || 50) + lifeBuffs.composure, 1, 99);

  // Locker-room bonds: the average bond makes teammates shoot better, and a
  // strong bond with your top teammate makes your own assists convert more often.
  const locker = getLockerRoomBonds(playerId);
  player._avgBond = locker.avg;
  player._connection = clamp(1 + (locker.top - 50) / 300 + (locker.avg - 50) / 600, 0.85, 1.3);

  const overall = calculateOverallRating(player);
  let fatiguePenalty = player.fatigue / 100.0;
  if (player.load_management) fatiguePenalty = Math.max(fatiguePenalty - 0.15, 0);
  let minutes = calculateMinutes(player, overall, isPlayoff, fatiguePenalty);
  if (player.injury_games_remaining > 0) {
    // "Play through it" keeps the player on the court at reduced minutes.
    if (player.injury_treatment === 'play_through') minutes = round1(minutes * 0.65);
    else minutes = 0;
  }

  const consistency = consistencyRating(player);
  // Lower consistency = wilder streaks; high consistency damps the swings.
  const streakScale = 1.4 - consistency / 100 * 0.8;
  let streakMod = 0;
  if (player.hot_streak > 0) streakMod = Math.min(player.hot_streak * 2.5, 15) * streakScale;
  else if (player.cold_streak < 0) streakMod = Math.max(player.cold_streak * 2.5, -15) * streakScale;
  // Morale nudges shot-making: low morale saps the whole team's consistency,
  // high morale steadies it. A small ±3–6% swing around the 75 baseline.
  const moraleMod = clamp(1 + ((player.morale ?? 75) - 75) / 400, 0.94, 1.06);

  const roleUsage = { 'Ball-Dominant Creator': 0.33, 'Off-Ball Finisher': 0.21, 'Rim Protector': 0.14, 'Two-Way Wing': 0.25, '3-and-D Specialist': 0.17, 'Point Forward': 0.28, 'Stretch Big': 0.19, 'Defensive Anchor': 0.12 };
  let usageRate = roleUsage[player.role] ?? 0.24;
  usageRate *= clamp(0.5 + (overall - 40) / 70.0, 0.5, 1.3);

  const tactics = tacticModifiers(player);
  const totalPoss = clamp(randInt(195, 210) + tactics.poss, 150, 240);
  const courtPct = minutes / 48.0;
  const box = { pts: 0, oreb: 0, dreb: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fga: 0, fgm: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, fga_mid: 0 };
  // Team box scores (teammates only for now; the player's line is folded in at the end).
  const teamBox = { reb: 0, ast: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 };
  const oppBox = { reb: 0, ast: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0 };
  const home = isHome != null ? isHome : homeSchedule(player.team_id, playerId)[Math.min(state.games_played_in_season, 81)];
  // Home-court advantage: a modest ~2.5-point scoring edge for the home team.
  const teamOff = team.off + (home ? 2.5 : 0), oppDef = opp.def;
  const oppOff = opp.off - (home ? 2.5 : 0), teamDef = team.def;
  let teamScore = 0, oppScore = 0;
  // Quarter-by-quarter scoring.
  const quarterEnd = [Math.ceil(totalPoss * 0.25), Math.ceil(totalPoss * 0.5), Math.ceil(totalPoss * 0.75), totalPoss];
  const qT = [0, 0, 0, 0], qO = [0, 0, 0, 0];
  let qStartT = 0, qStartO = 0, qi = 0;

  const TOV_RATE = 0.12 * tactics.myTov;
  let fouledOut = false, foulOutPos = totalPoss;
  for (let posNum = 1; posNum <= totalPoss; posNum++) {
    const isClutch = (posNum > totalPoss - 15) && Math.abs(teamScore - oppScore) <= 8;
    const myPossession = Math.random() < 0.50;
    const playerOn = !fouledOut && Math.random() < courtPct;
    if (myPossession) {
      const defFactor = 1 + (oppDef - 110) / 220.0;
      // Team chemistry (bond-driven, blended with leadership) makes teammates shoot a touch better/worse.
      const effChem = clamp((player._avgBond ?? player.chemistry ?? 50) * 0.7 + (player.leadership || 40) * 0.3, 0, 100);
      const chemMod = 1 + (effChem - 50) / 250.0;
      const baseProb = teamOff / 155.0 * defFactor * 0.68 * chemMod * moraleMod;
      const playerInvolved = playerOn && Math.random() < usageRate * 1.25;
      if (Math.random() < TOV_RATE) {
        // Turnover ends the possession before a shot.
        teamBox.tov += 1;
      } else if (playerInvolved) {
        const action = determineAction(player, isClutch, streakMod);
        const result = resolveAction(player, action, opp, isClutch, streakMod, moraleMod);
        // Shot-location tracking: only the non-three catch-and-shoot is a true
        // mid-range jumper; every other two is at the rim (drive/cut/post/putback).
        if (result.fga > 0 && result.tpa === 0 && action === 'catch_shoot') box.fga_mid += 1;
        updateBox(box, result);
        if (result.points > 0) teamScore += result.points;
        if (result.assist > 0) teamScore += result.assist_points;
        // The player's own miss -> offensive-rebound opportunity.
        if (result.fga > 0 && result.fgm === 0 && result.points === 0) {
          if (rollOffReb(player)) { box.oreb += 1; teamBox.reb += 1; }
          else oppBox.reb += 1;
        }
      } else {
        // Teammate possession.
        teamBox.fga += 1;
        const isThree = Math.random() < 0.28 * tactics.myThree;
        if (isThree) teamBox.tpa += 1;
        if (Math.random() < baseProb * (isThree ? 1 : tactics.myTwo)) {
          teamBox.fgm += 1;
          if (isThree) { teamBox.tpm += 1; teamScore += 3; } else teamScore += 2;
          if (Math.random() < 0.6) teamBox.ast += 1;
        } else if (playerOn && rollOffReb(player)) {
          box.oreb += 1; teamBox.reb += 1;
        } else {
          oppBox.reb += 1;
        }
      }
    } else {
      const defFactor = 1 + (teamDef - 110) / 220.0;
      const oppProb = oppOff / 155.0 * defFactor * 0.68 * tactics.oppScore;
      if (Math.random() < TOV_RATE) {
        // Opponent turnover -> our steal chance.
        oppBox.tov += 1;
        if (playerOn) box.stl += rollSteal(player, isClutch);
      } else {
        oppBox.fga += 1;
        const isThree = Math.random() < 0.25 * tactics.oppThree;
        if (isThree) oppBox.tpa += 1;
        let blocked = false;
        if (playerOn && rollBlock(player)) { box.blk += 1; blocked = true; }
        if (!blocked && Math.random() < oppProb) {
          oppBox.fgm += 1;
          if (isThree) { oppBox.tpm += 1; oppScore += 3; } else oppScore += 2;
          if (Math.random() < 0.6 * tactics.oppAst) oppBox.ast += 1;
        } else if (playerOn && rollDefReb(player)) {
          box.dreb += 1; teamBox.reb += 1;
        } else {
          oppBox.reb += 1;
        }
      }
      // Defensive foul chance while guarding.
      if (playerOn) box.pf += rollFoul(player);
      if (box.pf >= 6) { fouledOut = true; foulOutPos = posNum; }
    }
    if (posNum === quarterEnd[qi]) {
      qT[qi] = teamScore - qStartT; qO[qi] = oppScore - qStartO;
      qStartT = teamScore; qStartO = oppScore; qi++;
    }
  }

  // Foul-out: six personal fouls ends the player's night, capping their minutes
  // at the point they left (approximated by possession progress).
  if (fouledOut) minutes = round1(clamp(minutes * foulOutPos / totalPoss, 0, minutes));

  box.reb = box.oreb + box.dreb;
  // Fold the player's line into the team totals.
  teamBox.reb += box.reb; teamBox.ast += box.ast; teamBox.tov += box.tov;
  teamBox.fgm += box.fgm; teamBox.fga += box.fga; teamBox.tpm += box.tpm; teamBox.tpa += box.tpa;
  if (minutes > 6 && box.fga < 1) {
    box.fga = Math.max(1, Math.floor(minutes * usageRate * 0.35));
    box.fgm = Math.max(0, Math.floor(box.fga * 0.3));
  }
  // Stabilize team totals toward rating-implied expectation to tame blowouts
  // (each possession is otherwise an independent, high-variance coin flip).
  const expTeam = clamp(team.off + (team.off - opp.def) * 0.4 + (home ? 2.5 : 0), 85, 135);
  const expOpp = clamp(opp.off + (opp.off - team.def) * 0.4 + (home ? -2.5 : 0), 85, 135);
  const STAB = 0.55;
  teamScore = Math.round(teamScore * (1 - STAB) + expTeam * STAB);
  oppScore = Math.round(oppScore * (1 - STAB) + expOpp * STAB);
  const tRaw = qT.reduce((a, b) => a + b, 0) || 1;
  const oRaw = qO.reduce((a, b) => a + b, 0) || 1;
  for (let i = 0; i < 3; i++) { qT[i] = Math.round(qT[i] / tRaw * teamScore); qO[i] = Math.round(qO[i] / oRaw * oppScore); }
  qT[3] = teamScore - (qT[0] + qT[1] + qT[2]);
  qO[3] = oppScore - (qO[0] + qO[1] + qO[2]);
  const adv = calcAdvanced(box, minutes, totalPoss);
  // Overtime — resolve ties with extra periods instead of a tie becoming an 'L'.
  let overtime = 0;
  while (teamScore === oppScore && overtime < 6) {
    overtime += 1;
    teamScore += randInt(6, 16);
    oppScore += randInt(6, 16);
  }
  if (teamScore === oppScore) teamScore += 2; // safety net for an absurd multi-OT tie
  // NOTE: this is the full-game team scoring margin, not a true on-court
  // plus/minus — the engine doesn't model substitutions. Stored as-is but
  // labeled "score differential" in the UI.
  const plusMinus = minutes > 0 ? teamScore - oppScore : 0;
  const result = teamScore > oppScore ? 'W' : 'L';

  const newFatigue = clamp(player.fatigue + (minutes / 40.0) * randRange(3, 7) + tactics.fatigue, 0, 100);
  let newHot = player.hot_streak, newCold = player.cold_streak;
  if (box.pts >= 28) { newHot = Math.min(newHot + 2, 5); newCold = 0; }
  else if (box.pts >= 20) { newHot = Math.min(newHot + 1, 5); newCold = 0; }
  else if (box.pts <= 6 && box.fga >= 7) { newCold = Math.max(newCold - 1, -5); newHot = 0; }
  else {
    if (newHot > 0 && Math.random() < 0.25) newHot -= 1;
    if (newCold < 0 && Math.random() < 0.25) newCold += 1;
  }

  // Injury risk is a per-game level (NOT accumulated across games — that was the
  // old bug that made injuries constant). It feeds a deliberately low per-game chance.
  const durFactor = 1.45 - (player.durability || 55) / 100.0;
  let injRisk = clamp(Math.round(
    8 + (minutes / 36.0) * 20 * durFactor + (player.fatigue > 70 ? (player.fatigue - 70) * 0.45 : 0) - (player.load_management ? 5 : 0)
    + (player.injury_treatment === 'play_through' && player.injury_games_remaining > 0 ? 10 : 0)
  ), 0, 100);
  let injury = null;
  if (minutes > 0 && Math.random() < (injRisk / 100.0) * 0.045) {
    const sev = Math.random();
    if (sev < 0.50) injury = ['Minor sprain', randInt(1, 3)];
    else if (sev < 0.76) injury = ['Moderate strain', randInt(4, 10)];
    else if (sev < 0.92) injury = ['Serious sprain', randInt(11, 20)];
    else if (sev < 0.98) injury = ['Major injury', randInt(21, 40)];
    else injury = ['Season-ending injury', randInt(60, 82)];
  }

  const moraleDelta = (result === 'W' ? 1 : -1) * randInt(1, 3);
  const newMorale = clamp(player.morale + moraleDelta + (box.pts >= 25 ? randInt(2, 4) : 0) + lifeBuffs.morale, 10, 100);

  let newInjStatus = null, newInjGames = 0;
  if (injury) { newInjStatus = injury[0]; newInjGames = injury[1]; }
  else if (player.injury_games_remaining > 0) {
    const remaining = player.injury_games_remaining - 1;
    if (remaining > 0) { newInjStatus = player.injury_status; newInjGames = remaining; }
  }
  // Reset the treatment choice when a new injury starts or the current one heals.
  let newInjTreatment = player.injury_treatment || null;
  if (injury || newInjGames <= 0) newInjTreatment = null;

  const played = minutes > 0 ? 1 : 0;
  // Playoff games continue the numbering after the 82-game regular season so
  // logs stay ordered correctly.
  const gameNumber = isPlayoff ? 82 + state.games_played_in_season + 1 : state.games_played_in_season + 1;

  const gcols = ['player_id', 'season_number', 'game_number', 'opponent_team_id', 'is_playoff', 'is_home', 'result', 'team_score', 'opponent_score', 'minutes', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf', 'fga', 'fgm', 'tpa', 'tpm', 'fta', 'ftm', 'plus_minus', 'per', 'ts_pct', 'usg_pct', 'game_score', 'eff', 'q1_t', 'q1_o', 'q2_t', 'q2_o', 'q3_t', 'q3_o', 'q4_t', 'q4_o', 'team_reb', 'team_ast', 'team_tov', 'team_fgm', 'team_fga', 'team_3pm', 'team_3pa', 'opp_reb', 'opp_ast', 'opp_tov', 'opp_fgm', 'opp_fga', 'opp_3pm', 'opp_3pa'];
  const gvals = [playerId, state.current_season, gameNumber, opponentTeamId, isPlayoff ? 1 : 0, home ? 1 : 0, result, teamScore, oppScore,
    minutes, box.pts, box.reb, box.oreb, box.dreb, box.ast, box.stl, box.blk, box.tov, box.pf,
    box.fga, box.fgm, box.tpa, box.tpm, box.fta, box.ftm, plusMinus, adv.per, adv.ts_pct, adv.usg_pct, adv.game_score, adv.eff,
    qT[0], qO[0], qT[1], qO[1], qT[2], qO[2], qT[3], qO[3],
    teamBox.reb, teamBox.ast, teamBox.tov, teamBox.fgm, teamBox.fga, teamBox.tpm, teamBox.tpa,
    oppBox.reb, oppBox.ast, oppBox.tov, oppBox.fgm, oppBox.fga, oppBox.tpm, oppBox.tpa];
  db.prepare(`INSERT INTO game_logs (${gcols.join(',')}) VALUES (${gcols.map(() => '?').join(',')})`).run(...gvals);

  // Accumulate the box score into the right bucket: regular season (s_*) or playoffs (p_*).
  const B = isPlayoff ? 'p' : 's';
  db.prepare(`UPDATE players SET ${B}_pts=${B}_pts+?, ${B}_reb=${B}_reb+?, ${B}_ast=${B}_ast+?, ${B}_stl=${B}_stl+?, ${B}_blk=${B}_blk+?, ${B}_tov=${B}_tov+?, ${B}_fga=${B}_fga+?, ${B}_fgm=${B}_fgm+?, ${B}_3pa=${B}_3pa+?, ${B}_3pm=${B}_3pm+?, ${B}_fga_mid=${B}_fga_mid+?, ${B}_fta=${B}_fta+?, ${B}_ftm=${B}_ftm+?, ${B}_games=${B}_games+?, ${B}_min=${B}_min+?, ${B}_pf=${B}_pf+?, fatigue=?, injury_risk=?, morale=?, hot_streak=?, cold_streak=?, ${B}_wins=${B}_wins+?, ${B}_losses=${B}_losses+?, injury_status=?, injury_games_remaining=?, injury_treatment=? WHERE id=?`)
    .run(box.pts, box.reb, box.ast, box.stl, box.blk, box.tov, box.fga, box.fgm, box.tpa, box.tpm, box.fga_mid, box.fta, box.ftm,
      played, minutes, box.pf, newFatigue, injRisk, newMorale, newHot, newCold,
      result === 'W' ? 1 : 0, result === 'L' ? 1 : 0, newInjStatus, newInjGames, newInjTreatment, playerId);
  db.prepare('UPDATE league_state SET games_played_in_season=games_played_in_season+1 WHERE player_id=?').run(playerId);

  // League-wide simulation + mid-season development + rare career events only
  // happen during the regular season (not playoff games).
  let development = null, event = null, allStar = null, passiveTrade = null, allStarWeekend = null;
  if (!isPlayoff) {
    const after = db.prepare('SELECT s_wins, s_losses FROM players WHERE id=?').get(playerId);
    // Injuries tick every 3rd league game (they last multiple games anyway).
    if ((state.games_played_in_season + 1) % 3 === 0) tickLeagueInjuries(playerId);
    advanceLeague(playerId, player.team_id, after.s_wins, after.s_losses);
    development = maybeDevelop(playerId);
    event = maybeCareerEvent(playerId);
    allStar = maybeAllStar(playerId);
    passiveTrade = maybePassiveTrade(playerId);
    allStarWeekend = maybeAllStarWeekend(playerId);
  }

  // Locker room bonds drift with the result.
  driftBonds(playerId, result);

  const recordsBroken = checkGameRecords(box);
  for (const r of recordsBroken) logRecordBroken(playerId, state.current_season, r);

  // A notable night draws the media — set a pending interview. Media only fires
  // on big moments now (not randomly), so it becomes part of the story.
  let mediaNotable = null;
  if (recordsBroken.length > 0) {
    const rec = recordsBroken[0];
    mediaNotable = { type: 'record', label: rec.label, achieved: rec.achieved };
  } else if (allStar) {
    mediaNotable = { type: 'allstar' };
  } else if (box.pts >= 50) {
    mediaNotable = { type: '50pts', pts: box.pts };
  } else if (box.pts >= 10 && box.reb >= 10 && box.ast >= 10) {
    mediaNotable = { type: 'triple_double', pts: box.pts, reb: box.reb, ast: box.ast };
  }
  if (mediaNotable) db.prepare('UPDATE players SET media_pending=? WHERE id=?').run(JSON.stringify(mediaNotable), playerId);

  // Personal best + franchise record — "reachable" milestones that fire often
  // and give small, frequent moments of progress (unlike the legend records).
  const prevHigh = db.prepare('SELECT MAX(pts) pts FROM game_logs WHERE player_id=?').get(playerId)?.pts || 0;
  const personalRecord = box.pts > prevHigh && box.pts >= 20;
  if (personalRecord) {
    db.prepare('UPDATE players SET clout=MIN(100,clout+1) WHERE id=?').run(playerId);
    db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,'event',?)")
      .run(playerId, state.current_season, `New career high: ${box.pts} points.`);
  }
  const franchiseMark = FRANCHISE_RECORDS[player.team_id];
  let franchiseRecord = false;
  if (franchiseMark && box.pts > franchiseMark) {
    const seen = db.prepare('SELECT id FROM career_progress WHERE player_id=? AND milestone=?').get(playerId, 'franchise_pts');
    if (!seen) {
      db.prepare('UPDATE players SET clout=MIN(100,clout+3), fan_base=MIN(100,fan_base+3) WHERE id=?').run(playerId);
      db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description,milestone) VALUES (?,?,'event',?,?)")
        .run(playerId, state.current_season, `Broke the franchise single-game scoring record: ${box.pts} points.`, 'franchise_pts');
      franchiseRecord = true;
    }
  }
  const lifeIntro = hasIntroLifeEvent(playerId);

  return { game_number: gameNumber, opponent: opp.name, opponent_abbr: opp.abbr, result, is_home: home ? 1 : 0,
           overtime: overtime > 0 ? overtime : null,
           team_score: teamScore, opponent_score: oppScore, minutes, box_score: box, advanced: adv, plus_minus: plusMinus, records_broken: recordsBroken, personal_record: personalRecord, franchise_record: franchiseRecord, life_intro: lifeIntro,
           quarters: { team: qT, opp: qO }, team_box: teamBox, opp_box: oppBox,
           fatigue: round1(newFatigue), injury: newInjStatus ? { type: newInjStatus, games: newInjGames } : null,
           fouled_out: fouledOut,
           morale: newMorale, hot_streak: newHot, cold_streak: newCold,
           development, event, all_star: allStar, passive_trade: passiveTrade, allstar_weekend: allStarWeekend };
}

function determineAction(player, isClutch, streakMod) {
  const roleActions = {
    'Ball-Dominant Creator': { pnr: 30, drive_and_kick: 22, iso_score: 20, pull_up: 16, catch_shoot: 7 },
    'Off-Ball Finisher': { catch_shoot: 28, cut: 26, drive_and_kick: 16, pnr: 14, iso_score: 12 },
    'Rim Protector': { post_up: 28, putback: 22, catch_shoot: 20, cut: 20, iso_score: 8 },
    'Two-Way Wing': { iso_score: 20, catch_shoot: 20, drive_and_kick: 20, pull_up: 16, cut: 18, pnr: 8 },
    '3-and-D Specialist': { catch_shoot: 45, cut: 25, iso_score: 14, drive_and_kick: 9, pull_up: 5 },
    'Point Forward': { pnr: 28, drive_and_kick: 25, iso_score: 20, catch_shoot: 13, pull_up: 12 },
    'Stretch Big': { catch_shoot: 35, post_up: 22, cut: 18, putback: 14, iso_score: 9 },
    'Defensive Anchor': { putback: 32, post_up: 22, catch_shoot: 20, cut: 18, iso_score: 6 },
  };
  const weights = { ...(roleActions[player.role] || roleActions['Two-Way Wing']) };
  if (isClutch && player.clutch_factor > 55) {
    weights.iso_score = (weights.iso_score || 20) + 14;
    if (weights.pull_up != null) weights.pull_up += 8;
  }
  return weightedChoice(weights);
}

function assistConvert(player) {
  const passing = player.passing_accuracy ?? 40;
  const vision = player.pnr_vision ?? 40;
  // A strong locker-room bond makes the pass land — teammates you trust finish
  // your setups more often.
  const connection = player._connection ?? 1;
  return clamp(((passing + vision) / 300.0 + 0.18) * connection, 0.25, 0.95);
}

function resolveAction(player, action, opp, isClutch, streakMod, moraleMod = 1) {
  const r = { points: 0, fgm: 0, fga: 0, tpa: 0, tpm: 0, fta: 0, ftm: 0, tov: 0, assist: 0, assist_points: 0 };
  const defFactor = opp.def / 110.0;
  const stk = (1 + streakMod / 100.0) * moraleMod;
  const cl = isClutch ? 1 + (player.clutch_factor - 50) / 180.0 : 1.0;

  if (action === 'iso_score') {
    r.fga = 1;
    const p = (player.first_step + player.finishing + player.mid_range * 0.6) / 420.0 * defFactor * 0.88 * stk * cl;
    if (Math.random() < p) {
      if (Math.random() < player.pull_up_3pt / 145.0) { r.tpa = 1; r.tpm = 1; r.points = 3; }
      else { r.fgm = 1; r.points = 2; }
      if (Math.random() < player.drawing_fouls / 320.0) {
        r.fta = 1; r.ftm = Math.random() < player.free_throw / 100.0 ? 1 : 0; r.points += r.ftm;
      }
    } else {
      if (Math.random() < player.pull_up_3pt / 145.0) r.tpa = 1;
      if (Math.random() < player.drawing_fouls / 380.0) {
        r.fta = 2;
        r.ftm = 0;
        for (let i = 0; i < 2; i++) if (Math.random() < player.free_throw / 100.0) r.ftm++;
        r.points = r.ftm;
      }
    }
  } else if (action === 'catch_shoot') {
    r.fga = 1;
    const p = (player.catch_shoot_3pt * 1.3 + player.off_ball * 0.5) / 320.0 * defFactor * 0.85 * stk;
    const isThree = Math.random() < 0.62;
    if (isThree) { r.tpa = 1; if (Math.random() < p) { r.tpm = 1; r.points = 3; } }
    else { if (Math.random() < p * 1.28) { r.fgm = 1; r.points = 2; } }
  } else if (action === 'pnr') {
    const d = weightedChoice({
      score: 28 + player.finishing / 5,
      pass_to_roller: 26 + player.pnr_vision / 4,
      kick_out: 22 + player.passing_accuracy / 5,
      pull_up: 24,
    });
    if (d === 'score') {
      r.fga = 1;
      if (Math.random() < (player.finishing + player.first_step) / 310.0 * defFactor) { r.fgm = 1; r.points = 2; }
    } else if (d === 'pass_to_roller' || d === 'kick_out') {
      if (Math.random() < assistConvert(player)) { r.assist = 1; r.assist_points = Number(weightedChoice({ 2: 58, 3: 28, 0: 14 })); }
    } else if (d === 'pull_up') {
      r.fga = 1; r.tpa = 1;
      // A pull-up three off the pick — judged by pull_up_3pt (not mid_range),
      // consistent with the standalone pull_up action.
      if (Math.random() < (player.pull_up_3pt + player.mid_range * 0.5) / 330.0 * stk * cl) { r.tpm = 1; r.points = 3; }
    }
  } else if (action === 'pull_up') {
    r.fga = 1; r.tpa = 1;
    const p = (player.pull_up_3pt + player.mid_range * 0.5) / 330.0 * defFactor * stk * cl;
    if (Math.random() < p) { r.tpm = 1; r.points = 3; }
  } else if (action === 'drive_and_kick') {
    if (Math.random() < player.first_step / 135.0 * defFactor) {
      if (Math.random() < assistConvert(player)) { r.assist = 1; r.assist_points = Number(weightedChoice({ 2: 56, 3: 32, 0: 12 })); }
      else { r.fga = 1; if (Math.random() < player.finishing / 220.0 * defFactor) { r.fgm = 1; r.points = 2; } }
    } else { r.tov = 1; }
  } else if (action === 'cut') {
    r.fga = 1;
    if (Math.random() < (player.off_ball + player.finishing) / 300.0 * defFactor) { r.fgm = 1; r.points = 2; }
  } else if (action === 'post_up' || action === 'putback') {
    r.fga = 1;
    if (Math.random() < (player.strength + player.core_stability + player.finishing) / 430.0 * defFactor) { r.fgm = 1; r.points = 2; }
  }
  return r;
}

// Wingspan vs height: long arms help blocks and rebounds (finally a real effect).
function wingspanFactor(player) {
  const ratio = (player.wingspan || player.height) / (player.height || 1);
  return clamp(0.75 + (ratio - 1.0) * 2.5, 0.5, 1.25);
}

function rollSteal(player, isClutch) {
  const pf = POSITION_DEFENSE[player.position] || { stl: 1.0 };
  if (Math.random() < (player.steal * 0.7 + player.perimeter_defense * 0.3) / 900.0 * pf.stl * (isClutch ? 0.7 : 1.0)) return 1;
  return 0;
}
function rollBlock(player) {
  const pf = POSITION_DEFENSE[player.position] || { blk: 0.6 };
  if (Math.random() < (player.rim_protection + player.vertical_jump * 0.4) / 5200.0 * pf.blk * wingspanFactor(player)) return 1;
  return 0;
}
function rollDefReb(player) {
  const pf = POSITION_DEFENSE[player.position] || { reb: 0.8 };
  const reb = player.rebounding ?? player.box_out ?? 40;
  if (Math.random() < (reb * 0.9 + player.box_out * 0.2 + player.strength * 0.35 + player.vertical_jump * 0.15) / 1500.0 * pf.reb * wingspanFactor(player)) return 1;
  return 0;
}
function rollOffReb(player) {
  const pf = POSITION_DEFENSE[player.position] || { reb: 0.8 };
  const reb = player.rebounding ?? player.box_out ?? 40;
  if (Math.random() < (reb * 0.9 + player.box_out * 0.2 + player.vertical_jump * 0.4 + player.core_stability * 0.2) / 3100.0 * pf.reb * wingspanFactor(player)) return 1;
  return 0;
}
function rollFoul(player) {
  const fc = 0.018 + (1 - player.bbiq / 100.0) * 0.04 + (1 - player.composure / 100.0) * 0.015;
  return Math.random() < fc ? 1 : 0;
}

function updateBox(box, r) {
  for (const k of ['fgm', 'fga', 'tpa', 'tpm', 'fta', 'ftm', 'tov']) box[k] = (box[k] || 0) + (r[k] || 0);
  box.pts = (box.pts || 0) + (r.points || 0);
  box.ast = (box.ast || 0) + (r.assist || 0);
  box.fgm += (r.tpm || 0);
  return box;
}

function calcAdvanced(box, minutes, possessions) {
  if (minutes < 1) return { per: 0, ts_pct: 0, usg_pct: 0, game_score: 0, eff: 0 };
  const { fga, fgm, tpa, tpm, fta, ftm, pts, reb, ast, stl, blk, tov, pf, oreb, dreb } = box;
  const tsDenom = 2 * (fga + 0.44 * fta);
  const tsPct = tsDenom > 0 ? round3(pts / tsDenom) : 0;
  const teamPoss = possessions * 0.5;
  const usg = 100 * (fga + 0.44 * fta + tov) / Math.max(1, teamPoss * (minutes / 48));
  const usgPct = round1(clamp(usg, 3, 55));
  const gs = round1(pts + 0.4 * fgm - 0.7 * fga - 0.4 * (fta - ftm) + 0.7 * oreb + 0.3 * dreb + stl + 0.7 * ast + 0.7 * blk - 0.4 * pf - tov);
  const eff = pts + reb + ast + stl + blk - (fga - fgm) - (fta - ftm) - tov;
  const uPER = (1 / Math.max(1, minutes)) * (pts + 0.85 * fgm + 0.5 * tpm + 0.7 * oreb + 0.3 * dreb + 0.9 * ast + 1.1 * stl + 1.2 * blk - 0.9 * fga - 0.5 * fta - 0.8 * tov - 0.3 * pf) * 15;
  const per = round1(clamp(uPER, 0, 55));
  return { per, ts_pct: tsPct, usg_pct: usgPct, game_score: gs, eff };
}

// ------------------------------------------------------------
// Advanced stats (season-level) — real formulas where feasible.
// Hollinger's uPER is the actual formula, normalized to a 15-average. WS/BPM/VORP
// are box-score approximations (single-player sim has no full-league context).
// ------------------------------------------------------------
const LG = { astFG: 0.53, fgFT: 2.2, ftPF: 1.3, ftaPF: 2.0, vop: 1.0, drbp: 0.70 };
const PER_NORM = 45; // maps an average (~0.33 uPER) line to PER ≈ 15

function hollingerUPER(t, tmFgm, tmAst) {
  const min = Math.max(1, t.min ?? 1);
  const reb = (t.oreb || 0) + (t.dreb || 0);
  const factor = (2 / 3) - (0.5 * LG.astFG) / (2 * LG.fgFT);
  const tmASTperFG = (tmFgm || 0) > 0 ? (tmAst || 0) / tmFgm : 0;
  const raw = (
    (t.tpm || 0)
    + (2 / 3) * (t.ast || 0)
    + (2 - factor * tmASTperFG) * (t.fgm || 0)
    + (t.ftm || 0) * 0.5 * (1 + (1 - tmASTperFG) + (2 / 3) * tmASTperFG)
    - LG.vop * (t.tov || 0)
    - LG.vop * LG.drbp * ((t.fga || 0) - (t.fgm || 0))
    - LG.vop * 0.44 * (0.44 + 0.56 * LG.drbp) * ((t.fta || 0) - (t.ftm || 0))
    + LG.vop * (1 - LG.drbp) * (reb - (t.oreb || 0))
    + LG.vop * LG.drbp * (t.oreb || 0)
    + LG.vop * (t.stl || 0)
    + LG.vop * LG.drbp * (t.blk || 0)
    - (t.pf || 0) * (LG.ftPF - 0.44 * LG.ftaPF * LG.vop)
  );
  return raw / min;
}

function seasonAdvancedStats(playerId, season, teamWins) {
  const t = db.prepare(`SELECT SUM(pts) pts, SUM(fgm) fgm, SUM(fga) fga, SUM(tpm) tpm, SUM(tpa) tpa,
      SUM(ftm) ftm, SUM(fta) fta, SUM(oreb) oreb, SUM(dreb) dreb, SUM(ast) ast, SUM(stl) stl,
      SUM(blk) blk, SUM(tov) tov, SUM(pf) pf, SUM(minutes) min, COUNT(*) g,
      SUM(team_fgm) tfm, SUM(team_ast) ta
      FROM game_logs WHERE player_id=? AND season_number=? AND is_playoff=0`).get(playerId, season) || {};
  const g = Math.max(1, t.g || 0);
  const per = round1(clamp(hollingerUPER(t, t.tfm, t.ta) * PER_NORM, 0, 55));
  // Approximate WS: a 20/5/5 season ≈ 8 WS; scale box production linearly.
  const ws = round1(clamp((t.pts / g + t.dreb / g * 0.5 + t.oreb / g * 0.8 + t.ast / g * 0.7 + t.stl / g + t.blk / g - t.tov / g * 0.5) / 4.0, 0, 20));
  // Approximate BPM: per-possession box production vs a -2.0 replacement baseline.
  const mpg = t.min / g;
  const bpm = round1(((t.pts / g) * 0.7 + (t.dreb / g + t.oreb / g) * 0.5 + (t.ast / g) * 0.8 + (t.stl / g) * 1.5 + (t.blk / g) * 1.5 - (t.tov / g) * 1.0 - (t.pf / g) * 0.2) / 6.0 - 2.0);
  const vorp = round1(Math.max(0, bpm + 2.0) * g / 82.0);
  return { per, ws, bpm, vorp };
}

function generateSeasonSchedule(teamId, playerId) {
  // Deterministic 82-game schedule following the NBA convention:
  // 82 = 16 (4×div) + 36 (4×6 conf + 3×4 conf) + 30 (2×15 cross-conf).
  const seed = teamId * 777 + (getLeagueState(playerId).current_season || 1) * 131;
  const rng = mulberry32(seed);
  const divTeams = ALL_TEAM_IDS.filter(t => TEAMS[t].div === TEAMS[teamId].div && t !== teamId);
  const confTeams = ALL_TEAM_IDS.filter(t => TEAMS[t].conf === TEAMS[teamId].conf && t !== teamId && !divTeams.includes(t));
  const oppConf = ALL_TEAM_IDS.filter(t => TEAMS[t].conf !== TEAMS[teamId].conf);

  const schedule = [];
  for (const t of divTeams) schedule.push(...Array(4).fill(t));
  const conf4 = sampleSeeded(rng, confTeams, 6);
  const conf3 = confTeams.filter(t => !conf4.includes(t));
  for (const t of conf4) schedule.push(...Array(4).fill(t));
  for (const t of conf3) schedule.push(...Array(3).fill(t));
  for (const t of oppConf) schedule.push(...Array(2).fill(t));

  shuffleSeeded(rng, schedule);
  while (schedule.length < 82) schedule.push(ALL_TEAM_IDS[Math.floor(rng() * ALL_TEAM_IDS.length)]);
  return schedule.slice(0, 82);
}

// Deterministic 41-home / 41-away pattern for a team's season (seeded so it's
// stable within a season). Replaces the old coin-flip "home court".
function homeSchedule(teamId, playerId) {
  const seed = teamId * 991 + (getLeagueState(playerId).current_season || 1) * 173;
  const rng = mulberry32(seed);
  const pattern = Array(41).fill(true).concat(Array(41).fill(false));
  shuffleSeeded(rng, pattern);
  return pattern;
}

// Seeded RNG (mulberry32) so schedules are stable within a season.
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function sampleSeeded(rng, arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy.slice(0, n);
}
function shuffleSeeded(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// ------------------------------------------------------------
// League-wide simulation (other teams' records)
// ------------------------------------------------------------
function winProbability(teamId, oppId, playerId) {
  const season = getLeagueState(playerId).current_season;
  const salt = hashSalt(playerId);
  // Team strength now comes from the live AI roster; teamDrift adds a small
  // residual (coaching, trades, chemistry swings).
  const a = teamStrength(playerId, teamId) + teamDrift(teamId, season, salt) * 0.4;
  const b = teamStrength(playerId, oppId) + teamDrift(oppId, season, salt) * 0.4;
  return clamp(0.5 + (a - b) * 0.016, 0.04, 0.96);
}

// Small per-season OVR drift so the league isn't frozen: each team's effective
// strength shifts a little every year (breakouts and rebuilds happen). The salt
// (derived from the player's id) makes the evolution differ per save instead of
// being identical every run.
function teamDrift(tid, season, salt) {
  const rng = mulberry32(tid * 1000 + season * 7 + salt);
  return Math.round((rng() - 0.5) * 8); // ±4 OVR
}

function hashSalt(str) {
  let h = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function syncTeamRecord(playerId, teamId, season, wins, losses) {
  db.prepare(`INSERT INTO team_records (player_id,team_id,season_number,wins,losses) VALUES (?,?,?,?,?)
    ON CONFLICT(player_id,team_id,season_number) DO UPDATE SET wins=excluded.wins, losses=excluded.losses`)
    .run(playerId, teamId, season, wins, losses);
}

function advanceLeague(playerId, playerTeamId, playerWins, playerLosses) {
  const state = getLeagueState(playerId);
  const season = state.current_season;
  const gp = state.current_phase === 'regular_season' ? state.games_played_in_season : 82;
  if (gp <= 0) return;
  // Precompute each team's effective strength once — strength + drift don't change
  // within a single catch-up, so this avoids hundreds of redundant teamStrength /
  // getLeagueState queries inside the loop.
  const salt = hashSalt(playerId);
  const eff = {};
  for (const tid of ALL_TEAM_IDS) eff[tid] = teamStrength(playerId, tid) + teamDrift(tid, season, salt) * 0.4;
  const upsert = db.prepare(`INSERT INTO team_records (player_id,team_id,season_number,wins,losses) VALUES (?,?,?,?,?)
    ON CONFLICT(player_id,team_id,season_number) DO UPDATE SET wins=wins+?, losses=losses+?`);
  for (const tid of ALL_TEAM_IDS) {
    if (tid === playerTeamId) {
      // The player's own team record is authoritative (from s_wins/s_losses).
      syncTeamRecord(playerId, tid, season, playerWins, playerLosses);
      continue;
    }
    const row = db.prepare('SELECT wins, losses FROM team_records WHERE player_id=? AND team_id=? AND season_number=?').get(playerId, tid, season);
    const played = row ? (row.wins + row.losses) : 0;
    if (played >= gp) continue;
    const sched = generateSeasonSchedule(tid, playerId);
    for (let g = played; g < gp; g++) {
      const oppId = sched[Math.min(g, 81)];
      const win = Math.random() < clamp(0.5 + (eff[tid] - eff[oppId]) * 0.016, 0.04, 0.96);
      upsert.run(playerId, tid, season, win ? 1 : 0, win ? 0 : 1, win ? 1 : 0, win ? 0 : 1);
    }
  }
}

function resetTeamRecords(playerId, season) {
  db.prepare('DELETE FROM team_records WHERE player_id=? AND season_number=?').run(playerId, season);
}

// ------------------------------------------------------------
// AI players — the rest of the league (a persistent roster per save)
// ------------------------------------------------------------
// Each save owns ~300 AI players across 30 teams. They age, develop, decline,
// retire and get replaced by rookies every offseason, and their strength drives
// each team's win probability (instead of a frozen TEAMS[].ovr).
const TEAM_SALARY_CAP = 170; // $M — a full 10-man roster must fit under this

// Salary scales with overall: scrubs make ~$1M, superstars ~$30M.
function aiSalary(overall) {
  return round1(clamp(Math.pow((overall - 40) / 55, 2) * 28 + 1, 1, 30));
}

function teamSalary(playerId, teamId) {
  const ai = db.prepare('SELECT COALESCE(SUM(salary),0) s FROM ai_players WHERE player_id=? AND team_id=? AND retired=0').get(playerId, teamId).s;
  // The created player's own contract also counts against their team's cap.
  const p = db.prepare('SELECT team_id FROM players WHERE id=?').get(playerId);
  if (p && p.team_id === teamId) {
    const c = db.prepare('SELECT annual_salary FROM contracts WHERE player_id=? ORDER BY signed_at DESC, id DESC LIMIT 1').get(playerId);
    return round1(ai + (c?.annual_salary || 0));
  }
  return round1(ai);
}

// Rough win/championship projection from a team's live strength, used to make
// "join a contender" offers concrete.
function teamProjection(playerId, teamId) {
  const s = teamStrength(playerId, teamId);
  const projWins = Math.round(clamp(25 + (s - 55) * 1.2, 12, 64));
  const titlePct = Math.round(clamp((s - 74) * 3, 0, 35));
  return { proj_wins: projWins, title_pct: titlePct };
}

// Scouting report for a team: current strength + its top (healthy) players.
function teamRoster(playerId, teamId) {
  ensureLeaguePlayers(playerId);
  const top = db.prepare('SELECT name, position, overall, injury_games FROM ai_players WHERE player_id=? AND team_id=? AND retired=0 ORDER BY overall DESC LIMIT 3').all(playerId, teamId);
  return {
    team_id: teamId, team: (TEAMS[teamId] || {}).name, abbr: (TEAMS[teamId] || {}).abbr,
    strength: teamStrength(playerId, teamId), salary: teamSalary(playerId, teamId), cap: TEAM_SALARY_CAP,
    top_players: top,
  };
}

function ensureLeaguePlayers(playerId) {
  if (db.prepare('SELECT COUNT(*) c FROM ai_players WHERE player_id=?').get(playerId).c > 0) return;
  const ins = db.prepare('INSERT INTO ai_players (player_id,team_id,name,position,age,overall,potential,experience,growth,salary) VALUES (?,?,?,?,?,?,?,?,?,?)');
  for (const tid of ALL_TEAM_IDS) {
    const t = TEAMS[tid];
    // Roster shape anchored to the team's static OVR: 1 star, 2 starters,
    // 3 rotation, 4 bench. Younger players carry more upside.
    const roles = [
      { n: 1, off: -2, span: 4, ageLo: 25, ageHi: 31, exp: 8 },
      { n: 2, off: -6, span: 4, ageLo: 24, ageHi: 30, exp: 6 },
      { n: 3, off: -14, span: 5, ageLo: 22, ageHi: 28, exp: 4 },
      { n: 4, off: -26, span: 6, ageLo: 20, ageHi: 25, exp: 2 },
    ];
    for (const r of roles) {
      for (let i = 0; i < r.n; i++) {
        const overall = clamp(roll(t.ovr + r.off, r.span), 42, 96);
        const age = randInt(r.ageLo, r.ageHi);
        const potential = clamp(overall + randInt(-5, 18), 45, 98);
        const pos = weightedChoice({ PG: 16, SG: 18, SF: 20, PF: 22, C: 14 });
        const growth = weightedChoice({ steady: 50, prodigy: 15, late: 15, ageless: 10, fizzle: 10 });
        ins.run(playerId, tid, `${choice(FIRST_NAMES)} ${choice(LAST_NAMES)}`, pos, age, overall, potential, r.exp, growth, aiSalary(overall));
      }
    }
  }
}

// Effective team strength = average OVR of its top-8 active players (hurt or
// resting players don't count). The created player's own rating is folded in
// for their team, so it participates in the market at its true strength.
function teamStrength(playerId, teamId) {
  ensureLeaguePlayers(playerId);
  const rows = db.prepare('SELECT overall FROM ai_players WHERE player_id=? AND team_id=? AND retired=0 AND injury_games=0 AND rest_games=0 ORDER BY overall DESC LIMIT 8').all(playerId, teamId);
  const p = db.prepare('SELECT id, team_id FROM players WHERE id=?').get(playerId);
  if (p && p.team_id === teamId) {
    const povr = calculateOverallRating(db.prepare('SELECT * FROM players WHERE id=?').get(p.id));
    rows.push({ overall: povr });
  }
  if (!rows.length) return TEAMS[teamId]?.ovr ?? 75;
  const top = rows.map(r => r.overall).sort((a, b) => b - a).slice(0, 8);
  return round1(top.reduce((s, v) => s + v, 0) / top.length);
}

// Convert LIVE roster strength (~50-95) onto the engine's off/def scale
// (~90-130). This is what makes simulateGame reflect the evolved league (and
// the player's own rating) instead of the frozen season-1 static ratings, which
// was why weak teams could sweep strong ones. A little static off/def identity
// is preserved via the "lean" so teams don't all play the same.
function teamOffDef(playerId, teamId) {
  const s = teamStrength(playerId, teamId);
  const t = TEAMS[teamId] || { off: 110, def: 110 };
  const base = 55 + s * 0.7;
  const lean = (t.off - t.def) * 0.5;
  return { off: clamp(base + lean, 88, 132), def: clamp(base - lean, 88, 132) };
}

function topAIPlayers(playerId, limit = 20) {
  ensureLeaguePlayers(playerId);
  const rows = db.prepare('SELECT id,name,position,team_id,age,overall,potential,injury_games,rest_games,salary FROM ai_players WHERE player_id=? AND retired=0 ORDER BY overall DESC LIMIT ?').all(playerId, limit);
  return rows.map(r => ({ ...r, team: (TEAMS[r.team_id] || {}).name || 'Team', team_abbr: (TEAMS[r.team_id] || {}).abbr || '—' }));
}

// The MVP race: rank the player against the league's best AI stars by a single
// "production × winning" score, so awards feel like a competition, not a threshold.
function aiWinPct(playerId, teamId) {
  const season = getLeagueState(playerId).current_season;
  const rec = db.prepare('SELECT wins, losses FROM team_records WHERE player_id=? AND team_id=? AND season_number=?').get(playerId, teamId, season);
  const w = rec?.wins || 0, l = rec?.losses || 0;
  return (w + l) > 0 ? w / (w + l) : 0.5;
}

function mvpScoreFrom(production, winPct) {
  return round1(production * (0.5 + winPct));
}

function mvpRace(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  const g = Math.max(1, p.s_games);
  const star = p.s_pts / g + p.s_reb / g * 0.8 + p.s_ast / g * 0.8 + p.s_stl / g * 1.5 + p.s_blk / g * 1.5;
  const pW = (p.s_wins + p.s_losses) > 0 ? p.s_wins / (p.s_wins + p.s_losses) : 0.5;
  const race = [{ name: p.name, team_abbr: (TEAMS[p.team_id] || {}).abbr || '—', score: mvpScoreFrom(star, pW), is_player: true }];
  for (const a of topAIPlayers(playerId, 10)) {
    race.push({ name: a.name, team_abbr: a.team_abbr, score: mvpScoreFrom(a.overall * 0.45, aiWinPct(playerId, a.team_id)), is_player: false });
  }
  race.sort((a, b) => b.score - a.score);
  return race.slice(0, 5);
}

// The best AI MVP score this season — the bar the player must clear to win MVP.
function topAiMvpScore(playerId) {
  let top = 0;
  for (const a of topAIPlayers(playerId, 10)) {
    top = Math.max(top, mvpScoreFrom(a.overall * 0.45, aiWinPct(playerId, a.team_id)));
  }
  return top;
}

// Stat leaders: the player's real per-game numbers vs the AI league. Points/
// rebounds/assists are overall-driven (stars lead those); steals and blocks are
// specialty rolls, so we rank against the FULL AI pool — a defensive specialist
// can lead steals/blocks without being a top-overall star.
// A stable per-player "specialty" roll (long-tail): steal/block leaders are
// specialists, not just the highest-overall stars. `power` skews the tail —
// higher power = rarer high values (most players cluster low, a few spike).
// Seeded from the player's row id so it stays constant for a whole career.
function aiDefSpec(seedStr, power) {
  const rng = mulberry32(hashSalt(seedStr));
  return Math.pow(rng(), power);
}

function aiPerGameStats(overall, id) {
  const stealSpec = aiDefSpec(`steal:${id}`, 3);
  const blockSpec = aiDefSpec(`block:${id}`, 24);
  return {
    ppg: round1(clamp(overall * 0.32 - 4, 4, 32)),
    rpg: round1(clamp(overall * 0.12 - 2, 1, 12)),
    apg: round1(clamp(overall * 0.11 - 2, 1, 10)),
    spg: round1(clamp(overall * 0.006 + stealSpec * 1.9, 0.3, 2.6)),
    bpg: round1(clamp(overall * 0.004 + blockSpec * 2.9, 0.2, 3.6)),
  };
}

function statLeaders(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  const g = Math.max(1, p.s_games);
  const rows = [{ name: p.name, team_abbr: (TEAMS[p.team_id] || {}).abbr || '—', ppg: round1(p.s_pts / g), rpg: round1(p.s_reb / g), apg: round1(p.s_ast / g), spg: round1(p.s_stl / g), bpg: round1(p.s_blk / g), is_player: true }];
  for (const a of topAIPlayers(playerId, 1000)) {
    const s = aiPerGameStats(a.overall, a.id);
    rows.push({ name: a.name, team_abbr: a.team_abbr, ppg: s.ppg, rpg: s.rpg, apg: s.apg, spg: s.spg, bpg: s.bpg, is_player: false });
  }
  const top = key => rows.slice().sort((a, b) => b[key] - a[key]).slice(0, 5).map(r => ({ name: r.name, team_abbr: r.team_abbr, val: r[key], is_player: r.is_player }));
  return { points: top('ppg'), rebounds: top('rpg'), assists: top('apg'), steals: top('spg'), blocks: top('bpg') };
}

// Called once per league game (from simulateGame): heal everyone a tick, then
// roll new injuries (older players more prone) and occasional rest for aging stars.
function tickLeagueInjuries(playerId) {
  db.prepare('UPDATE ai_players SET injury_games=MAX(0,injury_games-1), rest_games=MAX(0,rest_games-1) WHERE player_id=?').run(playerId);
  for (const a of db.prepare('SELECT id, age, overall, injury_games FROM ai_players WHERE player_id=? AND retired=0').all(playerId)) {
    if (a.injury_games > 0) continue;
    const ageMult = 1 + Math.max(0, a.age - 30) * 0.08;
    if (Math.random() < 0.003 * ageMult) {
      db.prepare('UPDATE ai_players SET injury_games=? WHERE id=?').run(randInt(2, 20), a.id);
    } else if (a.overall >= 85 && a.age >= 30 && Math.random() < 0.004) {
      db.prepare('UPDATE ai_players SET rest_games=? WHERE id=?').run(randInt(1, 3), a.id);
    }
  }
}

// Annual league evolution: age everyone, develop the young, decline the old,
// retire the very old, then bring in a rookie class (worst teams pick first).
function advanceLeaguePlayers(playerId) {
  ensureLeaguePlayers(playerId);
  for (const a of db.prepare('SELECT * FROM ai_players WHERE player_id=? AND retired=0').all(playerId)) {
    const arche = GROWTH_ARCHETYPES[a.growth] || GROWTH_ARCHETYPES.steady;
    const newAge = a.age + 1;
    let overall = a.overall;
    if (newAge < arche.peak && overall < a.potential) {
      const gap = a.potential - overall;
      if (Math.random() < (0.55 + gap / 50) * arche.dev && Math.random() >= arche.bust) overall += randInt(0, 2);
    } else if (newAge >= arche.peak + 2) {
      overall -= Math.round((newAge - (arche.peak + 1)) * arche.decline * randRange(0.3, 0.8));
    }
    overall = clamp(overall, 40, 99);
    let retired = 0;
    if (newAge >= 38) retired = 1;
    else if (newAge >= 35 && Math.random() < (newAge - 34) * 0.25) retired = 1;
    db.prepare('UPDATE ai_players SET age=?, overall=?, experience=experience+1, retired=? WHERE id=?').run(newAge, overall, retired, a.id);
  }
  db.prepare('DELETE FROM ai_players WHERE player_id=? AND retired=1').run(playerId);

  // Rookie class: one per team, worst teams get the top prospects.
  const season = getLeagueState(playerId).current_season;
  const standings = db.prepare('SELECT team_id, wins FROM team_records WHERE player_id=? AND season_number=?').all(playerId, season)
    .sort((a, b) => a.wins - b.wins || a.team_id - b.team_id);
  const order = standings.length ? standings.map(r => r.team_id) : shuffle(ALL_TEAM_IDS.slice());
  const rookies = generateDraftClass().sort((a, b) => b.overall - a.overall).slice(0, 30);
  const ins = db.prepare('INSERT INTO ai_players (player_id,team_id,name,position,age,overall,potential,experience,growth,salary) VALUES (?,?,?,?,?,?,?,0,?,?)');
  for (let i = 0; i < rookies.length; i++) {
    const r = rookies[i];
    ins.run(playerId, order[i % order.length], r.name, r.position, r.age, r.overall, r.potential, weightedChoice({ steady: 50, prodigy: 15, late: 15, ageless: 10, fizzle: 10 }), aiSalary(r.overall));
  }
  advanceLeagueMarket(playerId);
  advanceLeagueCoaching(playerId);
}

// Coach turnover + ownership shakeups: a handful of teams fire their coach each
// offseason (especially underperformers), and a team occasionally changes hands.
function advanceLeagueCoaching(playerId) {
  const season = getLeagueState(playerId).current_season;
  const moves = [];
  const fired = shuffle(ALL_TEAM_IDS.slice()).slice(0, randInt(4, 8));
  for (const tid of fired) {
    const rec = db.prepare('SELECT wins, losses FROM team_records WHERE player_id=? AND team_id=? AND season_number=?').get(playerId, tid, season);
    const underperforming = rec && (rec.wins + rec.losses) > 0 && rec.wins / (rec.wins + rec.losses) < 0.4;
    moves.push(`🧑‍🏫 ${TEAMS[tid].name} fired their head coach ${underperforming ? 'after a disappointing season' : 'in a front-office shakeup'}.`);
    // A new coach actually changes the system: nudge a few of the team's best
    // players (some thrive, some regress).
    const core = db.prepare('SELECT id FROM ai_players WHERE player_id=? AND team_id=? AND retired=0 ORDER BY overall DESC LIMIT 3').all(playerId, tid);
    for (const pl of core) {
      const nudge = randInt(-2, 2);
      if (nudge !== 0) db.prepare('UPDATE ai_players SET overall=MAX(40,MIN(99,overall+?)) WHERE id=?').run(nudge, pl.id);
    }
  }
  // If YOUR team fired its coach, your hand-picked game plan resets to the new system.
  const pTeam = db.prepare('SELECT team_id FROM players WHERE id=?').get(playerId)?.team_id;
  if (pTeam != null && fired.includes(pTeam)) {
    db.prepare("UPDATE players SET tactics_defense='balanced', tactics_offense='balanced' WHERE id=?").run(playerId);
    moves.push(`🧑‍🏫 Your team fired its head coach — your game plan resets to the new system.`);
  }
  if (Math.random() < 0.12) {
    const tid = choice(ALL_TEAM_IDS);
    moves.push(`💰 ${TEAMS[tid].name} was sold to a new ownership group.`);
    // New ownership often means an infusion of resources → a small overall bump.
    const core = db.prepare('SELECT id FROM ai_players WHERE player_id=? AND team_id=? AND retired=0 ORDER BY overall DESC LIMIT 3').all(playerId, tid);
    for (const pl of core) db.prepare('UPDATE ai_players SET overall=MAX(40,MIN(99,overall+1)) WHERE id=?').run(pl.id);
  }
  for (const m of moves) {
    db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?, 'league', ?)").run(playerId, season, m);
  }
  return moves;
}

// ------------------------------------------------------------
// Locker room — the player's named teammates and their bonds
// ------------------------------------------------------------
// Team chemistry is no longer a bare number: it's the average bond with the
// rotation the player actually shares the floor with (pulled from the AI roster).
function syncTeammates(playerId, force = false) {
  const p = db.prepare('SELECT team_id FROM players WHERE id=?').get(playerId);
  if (!p) return;
  ensureLeaguePlayers(playerId);
  const season = getLeagueState(playerId).current_season;
  db.prepare('DELETE FROM teammates WHERE player_id=? AND season_number<?').run(playerId, season);
  // If forced (draft/trade changed the team), rebuild the current-season locker
  // room too — otherwise the player keeps a stale, unrelated roster all season.
  if (force) db.prepare('DELETE FROM teammates WHERE player_id=? AND season_number=?').run(playerId, season);
  if (!force && db.prepare('SELECT COUNT(*) c FROM teammates WHERE player_id=? AND season_number=?').get(playerId, season).c > 0) return;
  const roster = db.prepare('SELECT name, position FROM ai_players WHERE player_id=? AND team_id=? AND retired=0 ORDER BY overall DESC LIMIT 6').all(playerId, p.team_id);
  const pool = roster.length ? roster : [{ name: 'Rookie Mate', position: 'F' }];
  const ins = db.prepare('INSERT INTO teammates (player_id,season_number,name,position,bond) VALUES (?,?,?,?,?)');
  const used = new Set();
  for (let i = 0; i < 6 && used.size < pool.length; i++) {
    const m = pool[i % pool.length];
    if (used.has(m.name)) continue;
    used.add(m.name);
    ins.run(playerId, season, m.name, m.position, randInt(45, 65));
  }
  resyncChemistry(playerId);
}

function teamChemistry(playerId) {
  const season = getLeagueState(playerId).current_season;
  const row = db.prepare('SELECT ROUND(AVG(bond)) a FROM teammates WHERE player_id=? AND season_number=?').get(playerId, season);
  if (row && row.a != null) return row.a;
  return db.prepare('SELECT chemistry FROM players WHERE id=?').get(playerId)?.chemistry ?? 50;
}

function resyncChemistry(playerId) {
  const c = teamChemistry(playerId);
  db.prepare('UPDATE players SET chemistry=? WHERE id=?').run(c, playerId);
}

// Bonds drift after a game: wins bring the room together, losses fray it, and
// strong leadership steadies the locker room.
function driftBonds(playerId, result) {
  const season = getLeagueState(playerId).current_season;
  const lead = db.prepare('SELECT leadership FROM players WHERE id=?').get(playerId)?.leadership ?? 40;
  const stab = clamp((lead - 40) / 120.0, -0.25, 0.25);
  for (const t of db.prepare('SELECT id, bond FROM teammates WHERE player_id=? AND season_number=?').all(playerId, season)) {
    let delta = result === 'W' ? randInt(0, 2) : randInt(-2, 0);
    delta = Math.round(delta * (1 - stab));
    db.prepare('UPDATE teammates SET bond=MAX(0,MIN(100,bond+?)) WHERE id=?').run(delta, t.id);
  }
  resyncChemistry(playerId);
}

// Media answers (team-first vs selfish) nudge every current teammate's bond.
function nudgeBonds(playerId, delta) {
  const season = getLeagueState(playerId).current_season;
  for (const t of db.prepare('SELECT id FROM teammates WHERE player_id=? AND season_number=?').all(playerId, season)) {
    db.prepare('UPDATE teammates SET bond=MAX(0,MIN(100,bond+?)) WHERE id=?').run(delta, t.id);
  }
  resyncChemistry(playerId);
}

// Average + best bond in the current locker room (feeds on-court chemistry).
function getLockerRoomBonds(playerId) {
  const season = getLeagueState(playerId).current_season;
  const rows = db.prepare('SELECT bond FROM teammates WHERE player_id=? AND season_number=?').all(playerId, season);
  if (!rows.length) return { avg: db.prepare('SELECT chemistry FROM players WHERE id=?').get(playerId)?.chemistry ?? 50, top: 50 };
  const avg = Math.round(rows.reduce((s, r) => s + r.bond, 0) / rows.length);
  const top = Math.max(...rows.map(r => r.bond));
  return { avg, top };
}

// A locker-room action: spend a little money/time to bond with one teammate.
// Limited to a few per season; success scales with leadership.
const MAX_LOCKER_ACTIONS = 3;
function lockerRoomAction(playerId, teammateId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  const season = getLeagueState(playerId).current_season;
  if ((p.locker_actions_used || 0) >= MAX_LOCKER_ACTIONS) throw httpError(400, `You've used all ${MAX_LOCKER_ACTIONS} locker-room actions this season.`);
  const tm = db.prepare('SELECT * FROM teammates WHERE id=? AND player_id=? AND season_number=?').get(teammateId, playerId, season);
  if (!tm) throw httpError(404, 'Teammate not found.');
  if ((p.wealth || 0) < 0.5) throw httpError(400, 'Not enough money for a team dinner ($0.5M).');
  db.prepare('UPDATE players SET wealth=MAX(0,wealth-0.5), locker_actions_used=locker_actions_used+1 WHERE id=?').run(playerId);
  const successChance = clamp(0.45 + (p.leadership || 40) / 110, 0.25, 0.9);
  if (Math.random() < successChance) {
    const gain = randInt(5, 10);
    db.prepare('UPDATE teammates SET bond=MIN(100,bond+?) WHERE id=?').run(gain, teammateId);
    resyncChemistry(playerId);
    return { success: true, name: tm.name, bond_gain: gain, message: `You bonded with ${tm.name} (+${gain}).` };
  }
  const loss = randInt(1, 3);
  db.prepare('UPDATE teammates SET bond=MAX(0,bond-?) WHERE id=?').run(loss, teammateId);
  resyncChemistry(playerId);
  return { success: false, name: tm.name, bond_loss: loss, message: `The dinner with ${tm.name} was awkward (-${loss}).` };
}

// Offseason player movement: free agency (stars change teams) and trades
// (rebuilders send a win-now veteran to a contender for youth). Moves are logged
// to career_progress as 'league' events so they show up in the League tab + timeline.
function pickTeamByStrength(playerId, overall) {
  // Weighted random: stronger teams more likely, but not guaranteed.
  // Also favor teams that need the player's position.
  const opts = ALL_TEAM_IDS.map(tid => {
    const s = teamStrength(playerId, tid);
    const appeal = s * randRange(0.8, 1.2) + (overall - 70) * 0.3;
    return { tid, weight: Math.max(1, appeal) };
  });
  return weightedChoice(Object.fromEntries(opts.map(o => [o.tid, o.weight])));
}

function advanceLeagueMarket(playerId) {
  const moves = [];
  const season = getLeagueState(playerId).current_season;
  const myTeam = db.prepare('SELECT team_id FROM players WHERE id=?').get(playerId)?.team_id;
  const tag = tid => (tid === myTeam ? ' (your team)' : '');

  // Free agency: a handful of the league's best players hit the market.
  const faCount = randInt(4, 8);
  const all = db.prepare('SELECT id, team_id, name, overall, salary FROM ai_players WHERE player_id=? AND retired=0').all(playerId);
  const pool = all.slice().sort((a, b) => b.overall - a.overall).slice(0, 30);
  for (const fa of shuffle(pool).slice(0, faCount)) {
    if (Math.random() < 0.4) continue; // re-signs with their current team
    const dest = pickTeamByStrength(playerId, fa.overall);
    if (dest === fa.team_id) continue;
    // A capped-out team can't sign another star.
    if (teamSalary(playerId, dest) + (fa.salary || 0) > TEAM_SALARY_CAP * 1.1) continue;
    db.prepare('UPDATE ai_players SET team_id=? WHERE id=?').run(dest, fa.id);
    moves.push(`🔄 ${fa.name} signed with ${TEAMS[dest].name}${tag(dest)} (free agency).`);
  }

  // Trades: a rebuilding team sends a prime veteran to a contender for a young
  // player — the classic win-now vs build-for-the-future swap. The buyer must
  // have cap room for the incoming salary (net of the outgoing prospect).
  const strengths = ALL_TEAM_IDS.map(tid => ({ tid, s: teamStrength(playerId, tid) })).sort((a, b) => a.s - b.s);
  const rebuilders = strengths.slice(0, 10).map(x => x.tid);
  const contenders = strengths.slice(-10).map(x => x.tid);
  for (let i = 0; i < randInt(2, 5); i++) {
    const seller = choice(rebuilders);
    const buyer = choice(contenders);
    if (seller === buyer) continue;
    const star = db.prepare('SELECT id, name, salary FROM ai_players WHERE player_id=? AND team_id=? AND retired=0 AND age BETWEEN 27 AND 34 ORDER BY overall DESC LIMIT 1').get(playerId, seller);
    if (!star) continue;
    const prospect = db.prepare('SELECT id, name, salary FROM ai_players WHERE player_id=? AND team_id=? AND retired=0 AND age BETWEEN 19 AND 24 ORDER BY overall ASC LIMIT 1').get(playerId, buyer);
    if (!prospect) continue;
    if (teamSalary(playerId, buyer) + (star.salary || 0) - (prospect.salary || 0) > TEAM_SALARY_CAP * 1.1) continue;
    db.prepare('UPDATE ai_players SET team_id=? WHERE id=?').run(buyer, star.id);
    db.prepare('UPDATE ai_players SET team_id=? WHERE id=?').run(seller, prospect.id);
    const yourSide = tag(buyer) || tag(seller);
    moves.push(`🔁 ${star.name} traded to ${TEAMS[buyer].name} for ${prospect.name}.${yourSide}`);
  }

  for (const m of moves) {
    db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?, 'league', ?)").run(playerId, season, m);
  }
  return moves;
}

// ------------------------------------------------------------
// Mid-season development + career events
// ------------------------------------------------------------
function maybeDevelop(playerId) {
  const state = getLeagueState(playerId);
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  const gp = state.games_played_in_season;
  if (gp - (p.last_dev_game || 0) < 12) return null;
  db.prepare('UPDATE players SET last_dev_game=? WHERE id=?').run(gp, playerId);
  const arche = GROWTH_ARCHETYPES[p.growth] || GROWTH_ARCHETYPES.steady;
  const devChance = (p.potential || 50) / 100.0 * (p.work_ethic || 50) / 100.0 * arche.dev * (0.7 + (p.morale ?? 75) / 250);
  if (Math.random() >= devChance || Math.random() < arche.bust) return null;

  const focus = p.dev_focus && DEVELOPABLE_ATTRS.includes(p.dev_focus) ? p.dev_focus : null;
  const others = shuffle(DEVELOPABLE_ATTRS.slice()).filter(a => a !== focus).slice(0, 2);
  const targets = focus ? [focus, ...others] : others;
  const changes = {};
  for (const attr of targets.slice(0, 3)) {
    const cur = p[attr] ?? 50;
    // Diminishing returns: high-rated players develop slower, and elite
    // attributes (90+) stop growing mid-season (training/aging still apply).
    let gain = randInt(1, 2);
    if (cur >= 80) gain = 1;
    if (cur >= 90) gain = 0;
    if (gain <= 0) continue;
    const nv = clamp(cur + gain, 10, 99);
    if (nv !== cur) changes[attr] = { before: cur, after: nv, gain };
  }
  if (!Object.keys(changes).length) return null;
  const parts = []; const vals = [];
  for (const [attr, d] of Object.entries(changes)) { parts.push(`${attr}=?`); vals.push(d.after); }
  parts.push("updated_at=datetime('now')");
  vals.push(playerId);
  db.prepare(`UPDATE players SET ${parts.join(', ')} WHERE id=?`).run(...vals);
  db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,'development',?)")
    .run(playerId, state.current_season, 'Development: ' + Object.keys(changes).map(a => a.replace(/_/g, ' ')).join(', '));
  return { type: 'development', changes, focus };
}

function maybeCareerEvent(playerId) {
  // Story mode surfaces more of the off-court narrative.
  const mode = getLeagueState(playerId).game_mode || 'classic';
  if (Math.random() >= (mode === 'story' ? 0.10 : 0.05)) return null;
  const state = getLeagueState(playerId);
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  const candidates = CAREER_EVENTS.filter(e => !e.min_experience || (p.experience || 0) >= e.min_experience);
  if (!candidates.length) return null;
  const ev = candidates.find(e => e.id === weightedChoice(Object.fromEntries(candidates.map(e => [e.id, e.weight || 1]))));
  if (!ev) return null;

  const changes = {};
  for (const [k, range] of Object.entries(ev.effects || {})) {
    if (k === 'wealth') {
      // wealth is money in millions, not a 0-100 gauge — don't clamp it to 100.
      changes[k] = Math.max(0, round2((p[k] ?? 0) + randInt(range[0], range[1])));
    } else {
      const base = k === 'morale' ? 75 : k === 'fan_base' ? 5 : (p[k] ?? 50);
      changes[k] = clamp(base + randInt(range[0], range[1]), 0, 100);
    }
  }
  for (const [k, range] of Object.entries(ev.attr_effects || {})) {
    changes[k] = clamp((p[k] ?? 50) + randInt(range[0], range[1]), 10, 99);
  }
  const parts = []; const vals = [];
  for (const [k, v] of Object.entries(changes)) { parts.push(`${k}=?`); vals.push(v); }
  parts.push("updated_at=datetime('now')");
  vals.push(playerId);
  db.prepare(`UPDATE players SET ${parts.join(', ')} WHERE id=?`).run(...vals);
  const lang = getLeagueState(playerId).lang || 'en';
  db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,'event',?)")
    .run(playerId, state.current_season, pick(ev.title, 'en') + ' — ' + pick(ev.text, 'en'));
  return { type: 'event', event: { id: ev.id, title: pick(ev.title, lang), text: pick(ev.text, lang), tone: ev.tone, changes } };
}

// All-Star selection: a mid-season milestone with a small fame/respect bump.
function allStarQualifies(p) {
  const g = Math.max(1, p.s_games);
  const score = p.s_pts / g + p.s_reb / g * 0.7 + p.s_ast / g * 0.8 + p.s_stl / g * 1.5 + p.s_blk / g * 1.5;
  // Fan voting: a big fan base earns a spot even with slightly lower production —
  // the way popular players get voted in regardless of the stat sheet.
  const fanBoost = clamp((p.fan_base ?? 5) / 40, 0, 2.5);
  return score > (22 - fanBoost) && p.s_wins >= 20;
}

function maybeAllStar(playerId) {
  const state = getLeagueState(playerId);
  if (state.games_played_in_season !== 41) return null;
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!allStarQualifies(p)) return null;
  const exists = db.prepare("SELECT id FROM career_progress WHERE player_id=? AND season_number=? AND event_type='allstar'").get(playerId, state.current_season);
  if (exists) return null;
  const ppg = round1(p.s_pts / Math.max(1, p.s_games));
  db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
    .run(playerId, state.current_season, 'allstar', `Selected to the All-Star Game (${ppg} PPG).`);
  db.prepare('INSERT INTO awards (player_id,season_number,award_type,award_name) VALUES (?,?,?,?)')
    .run(playerId, state.current_season, 'season', 'All-Star');
  db.prepare('UPDATE players SET clout=MIN(100,clout+3), fan_base=MIN(100,fan_base+3) WHERE id=?').run(playerId);
  // Simulate the All-Star game itself — a fun exhibition line scaled by overall.
  const overall = calculateOverallRating(p);
  const asPts = clamp(randInt(10, 18) + Math.round(overall / 8), 12, 34);
  const asReb = clamp(randInt(1, 4) + Math.round(overall / 40), 2, 9);
  const asAst = clamp(randInt(1, 5) + Math.round(overall / 40), 2, 10);
  return { all_star: true, ppg, as_game: { pts: asPts, reb: asReb, ast: asAst } };
}

// The trade deadline: front offices move players without asking. A struggling or
// capped-out team may ship the player to a contender — the classic "you got
// traded" gut-punch that adds career uncertainty.
function maybePassiveTrade(playerId) {
  const state = getLeagueState(playerId);
  if (state.current_phase !== 'regular_season' || state.games_played_in_season !== 40) return null;
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) return null;
  // A no-trade clause blocks involuntary trades (the player can still request one).
  const nt = db.prepare('SELECT id FROM contracts WHERE player_id=? AND no_trade=1 AND years>0 ORDER BY signed_at DESC, id DESC LIMIT 1').get(playerId);
  if (nt) return null;
  const games = (p.s_wins || 0) + (p.s_losses || 0);
  const winPct = games > 0 ? (p.s_wins || 0) / games : 0.5;
  const overall = calculateOverallRating(p);
  const isBadTeam = winPct < 0.4;
  const overCap = teamSalary(playerId, p.team_id) > TEAM_SALARY_CAP * 1.1;
  if (!isBadTeam && !overCap) return null;
  let chance = 0.06;
  if (isBadTeam) chance += 0.12;
  if (overCap) chance += 0.08;
  chance -= (overall - 75) * 0.004; // stars are harder to dump
  chance = clamp(chance, 0.02, 0.25);
  if (Math.random() >= chance) return null;
  const dest = pickTeamByStrength(playerId, overall);
  if (dest === p.team_id) return null;
  const season = state.current_season;
  const rec = db.prepare('SELECT wins, losses FROM team_records WHERE player_id=? AND team_id=? AND season_number=?').get(playerId, dest, season);
  db.prepare('UPDATE players SET team_id=?, s_wins=?, s_losses=?, chemistry=50, morale=MAX(40,morale-5) WHERE id=?').run(dest, rec?.wins || 0, rec?.losses || 0, playerId);
  const contract = db.prepare('SELECT id FROM contracts WHERE player_id=? ORDER BY signed_at DESC, id DESC LIMIT 1').get(playerId);
  if (contract) db.prepare('UPDATE contracts SET team_id=? WHERE id=?').run(dest, contract.id);
  syncTeammates(playerId, true);
  db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,'trade',?)")
    .run(playerId, season, `Traded to ${TEAMS[dest].name} at the trade deadline.`);
  return { passive_trade: true, from: TEAMS[p.team_id].name, to: TEAMS[dest].name, reason: isBadTeam ? 'the team was struggling' : 'a salary-cap crunch' };
}

// All-Star Weekend: at game 41 the player can enter the dunk contest or the
// three-point contest for a fame/morale bump (with a little risk).
function maybeAllStarWeekend(playerId) {
  const state = getLeagueState(playerId);
  if (state.games_played_in_season !== 41) return null;
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (p.pending_weekend) return null;
  db.prepare('UPDATE players SET pending_weekend=1 WHERE id=?').run(playerId);
  return { allstar_weekend: true };
}

// All-Star weekend events — the player picks specific moves/spots; harder ones
// pay more but are less likely to land (gated by body/physical attributes).
const DUNK_ACTIONS = [
  { id: 'windmill', label: { en: 'Windmill', zh: '大风车' }, icon: '🌪️', desc: { en: 'A clean one-handed windmill.', zh: '一记干净的大风车扣篮。' }, difficulty: 1.3, attr: 'vertical_jump' },
  { id: '360', label: { en: '360 Spin', zh: '360转身' }, icon: '🌀', desc: { en: 'A full spin in the air before the throwdown.', zh: '空中转体一圈再扣。' }, difficulty: 2.0, attr: 'vertical_jump' },
  { id: 'tomahawk', label: { en: 'Tomahawk', zh: '战斧劈扣' }, icon: '🪓', desc: { en: 'An aggressive one-handed hammer.', zh: '一记凶狠的单臂劈扣。' }, difficulty: 1.5, attr: 'strength' },
  { id: 'between_legs', label: { en: 'Between the Legs', zh: '胯下换手' }, icon: '🦵', desc: { en: 'Switch hands under the leg mid-air.', zh: '空中胯下换手再扣。' }, difficulty: 2.5, attr: 'vertical_jump' },
  { id: 'poster', label: { en: 'Jump Over a Person', zh: '跨人暴扣' }, icon: '🧍', desc: { en: 'Catch a lob over a crouching mascot.', zh: '越过一个蹲着的人接球扣篮。' }, difficulty: 3.2, attr: 'finishing' },
];
const THREE_SPOTS = [
  { id: 'corner', label: { en: 'Corner', zh: '底角' }, icon: '📐', desc: { en: 'The short corner three.', zh: '底角三分。' }, difficulty: 1.1 },
  { id: 'wing', label: { en: 'Wing', zh: '侧翼' }, icon: '🎯', desc: { en: 'The 45-degree wing.', zh: '侧翼45度三分。' }, difficulty: 1.4 },
  { id: 'top', label: { en: 'Top of the Key', zh: '弧顶' }, icon: '🏹', desc: { en: 'The deep arc three.', zh: '弧顶远距离三分。' }, difficulty: 1.8 },
  { id: 'logo', label: { en: 'Logo Range', zh: 'Logo 三分' }, icon: '💥', desc: { en: 'Way downtown — the ultimate heat check.', zh: '超远距离——终极手感检验。' }, difficulty: 2.5 },
];

function resolveAllStarWeekend(playerId, choice, action) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (!p.pending_weekend) throw httpError(400, 'No pending All-Star Weekend decision.');
  let result;
  if (choice === 'dunk') {
    const act = DUNK_ACTIONS.find(a => a.id === action) || DUNK_ACTIONS[0];
    const attr = p[act.attr] ?? 50;
    const successProb = clamp(attr / 140 - act.difficulty * 0.15 + 0.35, 0.08, 0.78);
    const success = Math.random() < successProb;
    const clout = success ? Math.max(2, Math.round(act.difficulty * 6)) : 1;
    db.prepare('UPDATE players SET clout=MIN(100,clout+?), fan_base=MIN(100,fan_base+?), morale=MIN(100,morale+?), injury_risk=MIN(100,injury_risk+?) WHERE id=?')
      .run(clout, clout, success ? 3 : 1, success ? 3 : 2, playerId);
    result = { choice, action: act.label, success, clout,
      message: success ? `You threw down the ${act.label} and the judges went wild — a ${clout} clout/fame bump.`
                       : `You missed the ${act.label} and the crowd winced — a small ${clout} clout bump for showing up.` };
  } else if (choice === 'three') {
    const spot = THREE_SPOTS.find(s => s.id === action) || THREE_SPOTS[0];
    const tp = p.catch_shoot_3pt ?? 35;
    // NBA 3-pt contest realism: elite shooters ~40% from easy spots, ~15-20% from deep.
    const base = tp / 200 + 0.08;
    const makeProb = clamp(base / Math.pow(spot.difficulty, 1.3), 0.04, 0.48);
    let made = 0;
    for (let i = 0; i < 5; i++) if (Math.random() < makeProb) made++;
    const clout = clamp(Math.round(made * 1.5), 0, 8);
    db.prepare('UPDATE players SET clout=MIN(100,clout+?), fan_base=MIN(100,fan_base+?), morale=MIN(100,morale+1) WHERE id=?').run(clout, clout, playerId);
    result = { choice, action: spot.label, made, clout,
      message: `From the ${spot.label}, you hit ${made}/5 — a ${clout} clout/fame bump.` };
  } else {
    result = { choice, message: 'You sat out the weekend events.' };
  }
  db.prepare('UPDATE players SET pending_weekend=0 WHERE id=?').run(playerId);
  return result;
}

// ------------------------------------------------------------
// Season management
// ------------------------------------------------------------
function getLeagueState(playerId) {
  if (!playerId) throw httpError(400, 'A player id is required to read league state.');
  let row = db.prepare('SELECT * FROM league_state WHERE player_id=?').get(playerId);
  if (!row) {
    db.prepare('INSERT INTO league_state (player_id) VALUES (?)').run(playerId);
    row = db.prepare('SELECT * FROM league_state WHERE player_id=?').get(playerId);
  }
  return row;
}

const PLAYOFF_ROUND_NAMES = ['', 'First Round', 'Conf Semis', 'Conf Finals', 'NBA Finals'];

function advanceLeaguePhase(playerId) {
  const s = getLeagueState(playerId);
  if (s.current_phase === 'offseason') {
    db.prepare("UPDATE league_state SET current_season=current_season+1,current_phase='regular_season',games_played_in_season=0,playoff_round=0,series_wins=0,series_losses=0,playoff_opponent=0,player_seed=0,opponent_seed=0 WHERE player_id=?").run(playerId);
    resetTeamRecords(playerId, getLeagueState(playerId).current_season);
    advanceLeaguePlayers(playerId);
    syncTeammates(playerId);
    return getLeagueState(playerId);
  }
  throw httpError(400, s.current_phase === 'regular_season'
    ? 'The regular season is not over yet. Finish all 82 games and finalize first.'
    : 'Playoff series still in progress — play it out first.');
}

// NBA playoff seeding: top 8 per conference by wins, bracket 1v8 / 4v5 / 3v6 / 2v7.
function getConferenceStandings(playerId) {
  const season = getLeagueState(playerId).current_season;
  const rows = db.prepare('SELECT team_id, wins, losses FROM team_records WHERE player_id=? AND season_number=?').all(playerId, season);
  const recMap = new Map(rows.map(r => [r.team_id, { wins: r.wins, losses: r.losses }]));
  return ALL_TEAM_IDS.map(tid => {
    const rec = recMap.get(tid) || { wins: 0, losses: 0 };
    return { team_id: tid, conference: TEAMS[tid].conf, wins: rec.wins, losses: rec.losses };
  });
}

function conferenceSeeds(standings, conf) {
  return standings.filter(t => t.conference === conf).sort((a, b) => b.wins - a.wins || a.team_id - b.team_id);
}

// Standard 1-8 bracket. Returns the opponent seed for a given player seed + round.
function bracketOpponentSeed(playerSeed, round) {
  const topHalf = [1, 8, 4, 5], bottomHalf = [3, 6, 2, 7];
  const half = topHalf.includes(playerSeed) ? topHalf : bottomHalf;
  const pos = half.indexOf(playerSeed);
  const pair = pos >> 1;
  if (round === 1) return half[pair * 2 + ((pos % 2) === 0 ? 1 : 0)];
  if (round === 2) return Math.min(...(pair === 0 ? half.slice(2, 4) : half.slice(0, 2)));
  return Math.min(...(half === topHalf ? bottomHalf : topHalf));
}

// Resolve the opponent team: same-conf bracket for rounds 1-3, other-conf champ in finals.
function playoffOpponentTeam(standings, playerTeamId, playerSeed, round) {
  const conf = TEAMS[playerTeamId].conf;
  const seeds = conferenceSeeds(standings, conf);
  if (round < 4) return seeds[bracketOpponentSeed(playerSeed, round) - 1]?.team_id;
  const other = conferenceSeeds(standings, conf === 'East' ? 'West' : 'East');
  return other[0]?.team_id;
}

function resetSeasonCounters(playerId) {
  db.prepare(`UPDATE players SET
    s_pts=0,s_reb=0,s_ast=0,s_stl=0,s_blk=0,s_tov=0,s_fga=0,s_fgm=0,s_3pa=0,s_3pm=0,s_fga_mid=0,s_fta=0,s_ftm=0,s_games=0,s_min=0,s_pf=0,s_wins=0,s_losses=0,
    p_pts=0,p_reb=0,p_ast=0,p_stl=0,p_blk=0,p_tov=0,p_fga=0,p_fgm=0,p_3pa=0,p_3pm=0,p_fga_mid=0,p_fta=0,p_ftm=0,p_games=0,p_min=0,p_pf=0,p_wins=0,p_losses=0,
    hot_streak=0,cold_streak=0,injury_status=NULL,injury_games_remaining=0,injury_treatment=NULL,
    fatigue=MAX(0,fatigue-45),injury_risk=0,mvp_votes=0,last_dev_game=0,locker_actions_used=0
    WHERE id=?`).run(playerId);
}

function recordPlayoffStats(playerId, season) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  const g = Math.max(1, p.p_games), m = Math.max(1, p.p_min);
  const pppg = round1(p.p_pts / g), prpg = round1(p.p_reb / g), papg = round1(p.p_ast / g);
  const pspg = round1(p.p_stl / g), pbpg = round1(p.p_blk / g), ptopg = round1(p.p_tov / g);
  const pfg = round3(p.p_fgm / Math.max(1, p.p_fga));
  const ptp = round3(p.p_3pm / Math.max(1, p.p_3pa));
  const pft = round3(p.p_ftm / Math.max(1, p.p_fta));
  const pmpg = round1(m / g);
  db.prepare(`UPDATE season_summaries SET p_games=?, p_ppg=?, p_rpg=?, p_apg=?, p_spg=?, p_bpg=?, p_topg=?, p_mpg=?, p_fg_pct=?, p_tp_pct=?, p_ft_pct=? WHERE player_id=? AND season_number=?`)
    .run(p.p_games, pppg, prpg, papg, pspg, pbpg, ptopg, pmpg, pfg, ptp, pft, playerId, season);
}

const MAX_ENDORSEMENTS = 3;

// Salary cap + max-salary tiers (in $M). A star's top offer is capped by their
// experience bracket (like the real 25%/30%/35% of the cap); the home team can
// re-sign them at that max via Bird rights even when its own cap room is small.
const SALARY_CAP = 140;
function maxSalaryFor(experience) {
  if (experience >= 10) return round1(SALARY_CAP * 0.35); // 49M
  if (experience >= 7) return round1(SALARY_CAP * 0.30);  // 42M
  return round1(SALARY_CAP * 0.25);                       // 35M
}

// Free agency: generate a fresh set of contract offers for an expiring player.
function generateContractOffers(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) return [];
  const season = getLeagueState(playerId).current_season;
  db.prepare('DELETE FROM contract_offers WHERE player_id=? AND accepted=0').run(playerId);
  const overall = calculateOverallRating(p);
  const sum = db.prepare('SELECT ppg FROM season_summaries WHERE player_id=? ORDER BY season_number DESC LIMIT 1').get(playerId);
  const ppg = sum?.ppg || 0;
  // Market value from performance + overall + clout, capped by the player's max.
  const maxSal = maxSalaryFor(p.experience || 0);
  const fanMult = 1 + ((p.fan_base || 5) - 20) / 400; // market appeal: stars draw more money
  const base = clamp(round1(Math.max(3, (ppg * 1.15 + overall * 0.12 + (p.clout || 0) * 0.05) * fanMult)), 3, maxSal);
  // The home team always gets to bid (Bird rights), plus four others.
  const others = shuffle(ALL_TEAM_IDS.filter(id => id !== p.team_id)).slice(0, 4);
  const teams = [p.team_id, ...others];
  const offers = [];
  for (const tid of teams) {
    const t = TEAMS[tid];
    const isHome = tid === p.team_id;
    const dynStr = teamStrength(playerId, tid);
    const proj = teamProjection(playerId, tid);
    // Pricing: the home team (Bird rights) leads but doesn't always max out;
    // rebuilders overpay to lure stars; contenders offer less cash but a title shot.
    // Uses live strength (not static OVR) so it matches proj_wins/title_pct.
    let annual;
    if (isHome) annual = round1(base * randRange(0.95, 1.12) * (1 + ((p.morale ?? 75) - 75) / 500) * (1 + (teamChemistry(playerId) - 50) / 500)); // happy + gelled → the home team pays to keep you
    else if (dynStr >= 74) annual = round1(base * randRange(0.72, 0.92));
    else if (dynStr <= 58) annual = round1(base * randRange(1.05, 1.3));
    else annual = round1(base * randRange(0.85, 1.05));
    annual = clamp(annual, 3, maxSal);
    const titleShot = !isHome && proj.title_pct > 0;
    const years = choice([2, 3, 4]);
    const ins = db.prepare('INSERT INTO contract_offers (player_id,season_number,team_id,years,annual_value,total_value,contract_type) VALUES (?,?,?,?,?,?,?)')
      .run(playerId, season, tid, years, annual, round1(annual * years), 'Free Agency');
    offers.push({ id: Number(ins.lastInsertRowid), team: t.name, team_abbr: t.abbr, years, annual_value: annual, total_value: round1(annual * years), ovr: Math.round(dynStr), title_shot: titleShot, proj_wins: proj.proj_wins, title_pct: proj.title_pct });
  }
  return offers.sort((a, b) => b.annual_value - a.annual_value);
}

function signContract(playerId, offerId) {
  const offer = db.prepare('SELECT * FROM contract_offers WHERE id=? AND player_id=? AND accepted=0').get(offerId, playerId);
  if (!offer) throw httpError(404, 'Offer not found or no longer available');
  const titleShot = teamProjection(playerId, offer.team_id).title_pct > 0;
  const p = db.prepare('SELECT clout FROM players WHERE id=?').get(playerId);
  // High-clout players can get a player option on the final year, and the very
  // biggest stars can add a no-trade clause.
  const hasOption = (p?.clout || 0) >= 55;
  const hasNoTrade = (p?.clout || 0) >= 70;
  db.prepare('INSERT INTO contracts (player_id,season_number,team_id,years,total_value,annual_salary,contract_type,player_option,no_trade) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(playerId, offer.season_number, offer.team_id, offer.years, offer.total_value, offer.annual_value, hasOption ? 'Player Option' : offer.contract_type, hasOption ? 1 : 0, hasNoTrade ? 1 : 0);
  db.prepare('UPDATE players SET team_id=?, clout=MAX(0,clout-2) WHERE id=?').run(offer.team_id, playerId);
  syncTeammates(playerId, true);
  if (titleShot) {
    // Joining a contender is worth the money left on the table.
    db.prepare('UPDATE players SET clout=MIN(100,clout+5), fan_base=MIN(100,fan_base+8) WHERE id=?').run(playerId);
  }
  // Values: taking a discount for a contender is a career/fame statement;
  // cashing in on a max deal is a money move. The two branches diverge.
  addValues(playerId, titleShot ? { career: 2, fame: 1 } : { money: 2 });
  db.prepare('UPDATE contract_offers SET accepted=1 WHERE player_id=?').run(playerId);
  const perks = [hasOption ? 'a player option' : null, hasNoTrade ? 'a no-trade clause' : null].filter(Boolean).join(' and ');
  db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
    .run(playerId, offer.season_number, 'event', `Signed a ${offer.years}-year, $${round1(offer.annual_value)}M/yr deal with ${TEAMS[offer.team_id].name}${perks ? ` (${perks})` : ''}.`);
  return { signed: true, team: TEAMS[offer.team_id].name, team_abbr: TEAMS[offer.team_id].abbr, annual_value: offer.annual_value, years: offer.years, player_option: hasOption, no_trade: hasNoTrade };
}

// Negotiate a contract offer: push for more money (or a player option), risking
// the offer being pulled. Mirrors negotiateEndorsement.
function negotiateContract(playerId, offerId) {
  const offer = db.prepare('SELECT * FROM contract_offers WHERE id=? AND player_id=? AND accepted=0').get(offerId, playerId);
  if (!offer) throw httpError(404, 'Offer not found or no longer available');
  const p = db.prepare('SELECT clout FROM players WHERE id=?').get(playerId);
  const leverage = clamp(0.3 + (p.clout || 0) / 110, 0.2, 0.85);
  if (Math.random() < leverage) {
    const bump = round1(offer.annual_value * randRange(0.08, 0.22));
    const newAnnual = round1(offer.annual_value + bump);
    const newYears = offer.years + (Math.random() < 0.35 ? 1 : 0);
    db.prepare('UPDATE contract_offers SET annual_value=?, total_value=?, years=? WHERE id=?').run(newAnnual, round1(newAnnual * newYears), newYears, offerId);
    return { success: true, team: TEAMS[offer.team_id].name, old_annual: offer.annual_value, new_annual: newAnnual, years: newYears, message: `${TEAMS[offer.team_id].name} raised their offer to $${newAnnual}M/yr.` };
  }
  db.prepare('DELETE FROM contract_offers WHERE id=?').run(offerId);
  db.prepare('UPDATE players SET clout=MAX(0,clout-2) WHERE id=?').run(playerId);
  return { success: false, team: TEAMS[offer.team_id].name, message: `${TEAMS[offer.team_id].name} pulled their offer — you pushed too hard.` };
}

// Resolve a player option: exercise (play the final year) or decline (free agency).
function resolvePlayerOption(playerId, choice) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (!p.pending_option) throw httpError(400, 'No pending player-option decision.');
  const contract = db.prepare('SELECT * FROM contracts WHERE player_id=? ORDER BY signed_at DESC, id DESC LIMIT 1').get(playerId);
  if (choice === 'exercise') {
    db.prepare('UPDATE contracts SET years=1, player_option=0 WHERE id=?').run(contract.id);
    db.prepare('UPDATE players SET pending_option=0 WHERE id=?').run(playerId);
    return { exercised: true, message: 'You exercised your option — one more year at $' + round1(contract.annual_salary) + 'M.' };
  }
  if (choice === 'decline') {
    db.prepare('UPDATE contracts SET years=0, player_option=0 WHERE id=?').run(contract.id);
    const offers = generateContractOffers(playerId);
    db.prepare('UPDATE players SET pending_option=0 WHERE id=?').run(playerId);
    return { declined: true, offers, message: 'You declined your option — you are now a free agent.' };
  }
  throw httpError(400, "Invalid choice. Use 'exercise' or 'decline'.");
}

function requestBuyout(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (p.clout < 20) return { success: false, message: "You don't have enough leverage to force a buyout yet." };
  const chem = teamChemistry(playerId);
  const success = Math.random() < Math.min(0.8, p.clout / 140.0 + Math.max(0, 50 - chem) / 150);
  if (success) {
    const contract = db.prepare('SELECT id FROM contracts WHERE player_id=? ORDER BY signed_at DESC, id DESC LIMIT 1').get(playerId);
    if (contract) db.prepare('UPDATE contracts SET years=0 WHERE id=?').run(contract.id);
    db.prepare('UPDATE players SET clout=MAX(0,clout-8), wealth=MAX(0,wealth-1), chemistry=MAX(20,chemistry-5) WHERE id=?').run(playerId);
    const offers = generateContractOffers(playerId);
    db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,'event',?)")
      .run(playerId, getLeagueState(playerId).current_season, 'Bought out their contract — now a free agent.');
    return { success: true, message: 'Buyout complete — you are a free agent.', offers };
  }
  db.prepare('UPDATE players SET clout=MAX(0,clout-5), morale=MAX(10,morale-6) WHERE id=?').run(playerId);
  return { success: false, message: 'The buyout talks fell through. Morale took a hit.' };
}

function applyInjuryTreatment(playerId, option) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (!p.injury_status || p.injury_games_remaining <= 0) throw httpError(400, 'You are not currently injured.');
  if (p.injury_treatment) throw httpError(400, 'You have already chosen a treatment for this injury.');
  if (!['rest', 'surgery', 'play_through'].includes(option)) throw httpError(400, 'Invalid treatment option.');

  let games = p.injury_games_remaining, durability = p.durability, wealth = p.wealth, risk = p.injury_risk, msg = '';
  if (option === 'rest') {
    games = Math.max(1, Math.ceil(games * (1 - ((p.work_ethic ?? 50) - 50) / 300)));   // crazy rehab shortens recovery
    msg = 'You chose to rest and recover — your relentless work ethic speeds it up.';
  } else if (option === 'surgery') {
    games = Math.max(1, Math.ceil(games * 0.6));   // faster recovery
    durability = clamp(durability + 2, 1, 99);      // long-term durability boost
    wealth = Math.max(0, round2(wealth - 1));       // medical cost
    msg = 'You opted for surgery — faster recovery and stronger durability, at a cost.';
  } else if (option === 'play_through') {
    games = Math.max(1, Math.ceil(games * 0.3));   // gut it out
    risk = 8;                                       // higher re-injury risk
    msg = 'You are playing through the injury — fewer games missed, but higher re-injury risk.';
  }
  db.prepare('UPDATE players SET injury_games_remaining=?, durability=?, wealth=?, injury_risk=?, injury_treatment=? WHERE id=?')
    .run(games, durability, wealth, risk, option, playerId);
  return { option, injury_games_remaining: games, message: msg };
}

// Lifestyle tier — how the player spends their money. Higher tiers burn wealth
// each year but buy fame; the pressure is "money never stays still".
const LIFESTYLE_TIERS = [
  { id: 0, label: 'Frugal', icon: '🪙', cost: 0, fame: 0, desc: 'Live below your means — wealth grows, but no flash.' },
  { id: 1, label: 'Modest', icon: '🏠', cost: 0.5, fame: 1, desc: 'A comfortable, low-key life.' },
  { id: 2, label: 'Comfortable', icon: '🏎️', cost: 2, fame: 3, desc: 'Nice house, nice cars, a small entourage.' },
  { id: 3, label: 'Lavish', icon: '🏰', cost: 6, fame: 6, desc: 'Mansions, supercars, designer everything.' },
  { id: 4, label: 'Excessive', icon: '💎', cost: 15, fame: 10, desc: 'Private jets, yachts, a full entourage. Fame at a price.' },
];

function lifestyleTier(tier) { return LIFESTYLE_TIERS[tier] || LIFESTYLE_TIERS[1]; }

function setLifestyle(playerId, tier) {
  tier = Number(tier);
  if (!LIFESTYLE_TIERS[tier]) throw httpError(400, `Invalid lifestyle tier (0-${LIFESTYLE_TIERS.length - 1}).`);
  db.prepare("UPDATE players SET lifestyle=?, updated_at=datetime('now') WHERE id=?").run(tier, playerId);
  const t = lifestyleTier(tier);
  return { lifestyle: tier, label: t.label, icon: t.icon, cost: t.cost, fame: t.fame };
}

// A sketchy (low-trust) advisor can gut a rich player's fortune — the Tim Duncan
// story. Checked once a year at the settlement.
function maybeAdvisorScam(playerId) {
  const p = db.prepare('SELECT wealth, advisor_trust, morale FROM players WHERE id=?').get(playerId);
  if (!p) return null;
  const trust = p.advisor_trust ?? 50;
  const wealth = p.wealth || 0;
  if (wealth < 15 || trust >= 60) return null;
  if (Math.random() >= (60 - trust) / 150) return null;
  const loss = round2(wealth * randRange(0.25, 0.55));
  db.prepare('UPDATE players SET wealth=MAX(0,wealth-?), advisor_trust=0, morale=MAX(10,morale-15) WHERE id=?').run(loss, playerId);
  const season = getLeagueState(playerId).current_season;
  db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
    .run(playerId, season, 'event', `Your financial advisor defrauded you — lost $${loss.toFixed(2)}M. Hire a reputable advisor.`);
  return { advisor_scam: true, loss };
}

// One-off shocks — a tax audit (proportional to wealth) or a high-profile
// divorce (if married). Both are rare and hit money + morale.
function maybeLifeShock(playerId) {
  const p = db.prepare('SELECT wealth, morale FROM players WHERE id=?').get(playerId);
  if (!p) return null;
  const season = getLeagueState(playerId).current_season;
  // Divorce: a married partner relationship can end, and it's expensive.
  const spouse = db.prepare("SELECT id, name FROM relationships WHERE player_id=? AND type='partner' AND status='married'").get(playerId);
  if (spouse && Math.random() < 0.03) {
    const loss = round2((p.wealth || 0) * randRange(0.3, 0.5));
    db.prepare('UPDATE players SET wealth=MAX(0,wealth-?), morale=MAX(10,morale-20) WHERE id=?').run(loss, playerId);
    db.prepare("UPDATE relationships SET status='ended', bond=MAX(0,bond-40) WHERE id=?").run(spouse.id);
    db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
      .run(playerId, season, 'event', `Divorce from ${spouse.name} — settled for $${loss.toFixed(2)}M.`);
    return { type: 'divorce', loss };
  }
  // Tax audit: the rich attract scrutiny.
  if ((p.wealth || 0) > 10 && Math.random() < 0.02) {
    const fine = round2((p.wealth || 0) * randRange(0.08, 0.2));
    db.prepare('UPDATE players SET wealth=MAX(0,wealth-?), morale=MAX(10,morale-8) WHERE id=?').run(fine, playerId);
    db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
      .run(playerId, season, 'event', `IRS audit — back taxes and penalties cost $${fine.toFixed(2)}M.`);
    return { type: 'tax', fine };
  }
  return null;
}

// Annual settlement — the "time passes" step that makes the economy real.
// Salary flows into wealth, endorsements pay out and tick down, investments
// compound, and the contract ticks toward free agency. Called once per season
// at the transition into the offseason.
function advanceYear(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) return null;
  const state = getLeagueState(playerId);
  const season = state.current_season;
  const result = { salary_earned: 0, endorsement_income: 0, investments: [], endorsements_expired: [], free_agency: null };

  // Salary from the active contract, then tick it down toward free agency.
  const contract = db.prepare('SELECT id, years, annual_salary, player_option FROM contracts WHERE player_id=? ORDER BY signed_at DESC, id DESC LIMIT 1').get(playerId);
  if (contract) {
    if ((contract.years || 0) > 0) result.salary_earned = round2(contract.annual_salary || 0);
    const newYears = Math.max(0, (contract.years || 0) - 1);
    db.prepare('UPDATE contracts SET years=? WHERE id=?').run(newYears, contract.id);
    if (newYears <= 0) {
      if (contract.player_option) {
        // The final year is a player option — decide before hitting free agency.
        db.prepare('UPDATE players SET pending_option=1 WHERE id=?').run(playerId);
        result.player_option = true;
      } else {
        result.free_agency = generateContractOffers(playerId);
      }
    }
  }

  // Endorsements: pay out annual_value, then decrement years_remaining.
  const endorsements = db.prepare('SELECT * FROM endorsements WHERE player_id=? AND years_remaining>0').all(playerId);
  let endorsementIncome = 0;
  for (const e of endorsements) {
    endorsementIncome += e.annual_value || 0;
    const yrs = (e.years_remaining || 0) - 1;
    db.prepare('UPDATE endorsements SET years_remaining=? WHERE id=?').run(Math.max(0, yrs), e.id);
    if (yrs <= 0) result.endorsements_expired.push(e.brand_name);
  }
  result.endorsement_income = round2(endorsementIncome);

  // Signature shoe: a permanent personal-brand line — pays annual royalties + fame.
  const shoe = db.prepare('SELECT * FROM shoes WHERE player_id=?').get(playerId);
  let shoeIncome = 0;
  if (shoe) {
    shoeIncome = shoe.annual_value || 0;
    db.prepare('UPDATE players SET fan_base=MIN(100, fan_base + ?) WHERE id=?').run(randRange(0.5, 1.5), playerId);
  }
  result.shoe_income = round2(shoeIncome);

  // Investments: apply annual_return to current_value (was previously never updated).
  // Market drift — a macro regime that bends every investment's return. Rarely
  // the market crashes (bubble burst) or booms (tech run).
  let market = state.market ?? 0;
  const mRoll = Math.random();
  if (mRoll < 0.04) { market = -randRange(0.35, 0.5); result.market_event = 'crash'; }
  else if (mRoll < 0.08) { market = randRange(0.25, 0.4); result.market_event = 'boom'; }
  else market = clamp(market + randRange(-0.12, 0.12), -0.4, 0.4);
  db.prepare('UPDATE league_state SET market=? WHERE player_id=?').run(round3(market), playerId);
  result.market = round3(market);

  // Investments: apply annual_return + market swing to current_value. Startups
  // are binary (big exit or bust); a team stake also pays fame.
  const investments = db.prepare('SELECT * FROM investments WHERE player_id=?').all(playerId);
  for (const inv of investments) {
    let newValue;
    if (inv.asset_type === 'startup') {
      const r = Math.random();
      if (r < 0.12) newValue = round2((inv.current_value || 0) * randRange(4, 8));
      else if (r < 0.32) newValue = 0;
      else newValue = round2((inv.current_value || 0) * randRange(0.85, 1.1));
    } else {
      const effReturn = (inv.annual_return || 0) + market;
      newValue = round2(Math.max(0, (inv.current_value || 0) * (1 + effReturn)));
    }
    db.prepare('UPDATE investments SET current_value=? WHERE id=?').run(newValue, inv.id);
    if (inv.asset_type === 'team_stake') {
      db.prepare('UPDATE players SET fan_base=MIN(100, fan_base+1) WHERE id=?').run(playerId);
    }
    result.investments.push({ name: inv.name, amount_invested: inv.amount_invested, current_value: newValue, asset_type: inv.asset_type, lock_season: inv.lock_season });
  }

  const totalIncome = round2((result.salary_earned || 0) + (result.endorsement_income || 0) + (result.shoe_income || 0));
  if (totalIncome > 0) db.prepare('UPDATE players SET wealth=MAX(0, wealth + ?) WHERE id=?').run(totalIncome, playerId);

  // Lifestyle: burn money each year, buy a little fame.
  const lifestyle = lifestyleTier(p.lifestyle ?? 1);
  if (lifestyle.cost > 0) {
    db.prepare('UPDATE players SET wealth=MAX(0, wealth-?), fan_base=MIN(100, fan_base+?) WHERE id=?').run(lifestyle.cost, lifestyle.fame, playerId);
    result.lifestyle_cost = lifestyle.cost;
  }

  // Advisor trust erodes a little each year (complacency, turnover, drift), so a
  // rich player slowly slides toward the scam-risk zone unless they hire a new
  // reputable advisor. After a scam it resets to 0 and the risk is gone for a while.
  db.prepare('UPDATE players SET advisor_trust=MAX(0, advisor_trust - ?) WHERE id=?').run(randInt(1, 4), playerId);

  // Locker-room chemistry steadies (or sours) the mood heading into the offseason.
  const chemMorale = Math.round((teamChemistry(playerId) - 50) / 10); // -5..+5
  if (chemMorale !== 0) db.prepare('UPDATE players SET morale=MAX(10,MIN(100,morale+?)) WHERE id=?').run(chemMorale, playerId);

  // Advisor scam risk (sketchy advisor + big money).
  result.advisor_scam = maybeAdvisorScam(playerId);

  // One-off life shocks (tax audit / divorce).
  result.life_shock = maybeLifeShock(playerId);

  if (totalIncome > 0 || result.endorsements_expired.length || result.lifestyle_cost > 0 || result.advisor_scam || result.life_shock) {
    const bits = [];
    if (result.salary_earned > 0) bits.push(`salary $${result.salary_earned.toFixed(2)}M`);
    if (result.endorsement_income > 0) bits.push(`endorsements $${result.endorsement_income.toFixed(2)}M`);
    if (result.shoe_income > 0) bits.push(`shoe royalties $${result.shoe_income.toFixed(2)}M`);
    if (result.endorsements_expired.length) bits.push(`${result.endorsements_expired.join(', ')} deal expired`);
    if (result.lifestyle_cost > 0) bits.push(`lifestyle -$${result.lifestyle_cost.toFixed(2)}M`);
    if (result.advisor_scam) bits.push(`advisor scam -$${result.advisor_scam.loss.toFixed(2)}M`);
    if (result.market_event === 'crash') bits.push('market crash');
    if (result.market_event === 'boom') bits.push('market boom');
    if (result.life_shock?.type === 'divorce') bits.push(`divorce -$${result.life_shock.loss.toFixed(2)}M`);
    if (result.life_shock?.type === 'tax') bits.push(`tax -$${result.life_shock.fine.toFixed(2)}M`);
    db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
      .run(playerId, season, 'event', 'Season earnings: ' + bits.join(' · '));
  }

  return result;
}

// Retirement + Hall-of-Fame check. Runs at the end of each season transition.
// Instead of force-retiring, this flags a decision the player must resolve: hang it
// up now, or play one more year (with a physical toll).
function maybeRetire(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p || p.retired) return null;
  if (p.age < 35) return null;
  // Past 42 there is no choice left — the body gives out regardless.
  if (p.age >= 42) return retireNow(playerId);
  const chance = clamp(0.15 + (p.age - 35) * 0.2, 0, 0.95);
  if (Math.random() >= chance) return null;
  db.prepare("UPDATE players SET retirement_pending=1, updated_at=datetime('now') WHERE id=?").run(playerId);
  return { retirement_pending: true, age: p.age };
}

function retireNow(playerId) {
  // A protege you mentored to a strong bond is a lasting legacy — his rise counts.
  const protege = db.prepare("SELECT bond FROM relationships WHERE player_id=? AND type='protege' ORDER BY bond DESC LIMIT 1").get(playerId);
  if (protege && protege.bond >= 60) db.prepare('UPDATE players SET goat_bonus=goat_bonus+20 WHERE id=?').run(playerId);
  const career = getCareerOverview(playerId);
  const goat = career.goat_score;
  // Two legacy tiers so a solid career still gets a satisfying ending.
  let legacyTier = null; // null | 'hof' | 'goat'
  if (goat >= 75) legacyTier = 'goat';
  else if (goat >= 45) legacyTier = 'hof';
  db.prepare("UPDATE players SET retired=1, retirement_pending=0, updated_at=datetime('now') WHERE id=?").run(playerId);
  const desc = legacyTier === 'goat' ? 'Retired — a first-ballot Hall of Famer and G.O.A.T. candidate.'
    : legacyTier === 'hof' ? 'Retired — inducted into the Hall of Fame.'
    : 'Retired from the NBA.';
  db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
    .run(playerId, getLeagueState(playerId).current_season, 'event', desc);
  return { retired: true, hall_of_fame: legacyTier !== null, legacy_tier: legacyTier, goat_score: goat };
}

function resolveRetirement(playerId, choice) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (!p.retirement_pending) throw httpError(400, 'No pending retirement decision.');
  if (choice === 'retire') return retireNow(playerId);
  if (choice === 'one_more_year') {
    // Playing on: age applies at the next transition, but the body pays a toll now.
    db.prepare("UPDATE players SET retirement_pending=0, durability=MAX(5,durability-4), stamina=MAX(5,stamina-3), injury_risk=MIN(100,injury_risk+10), updated_at=datetime('now') WHERE id=?").run(playerId);
    db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
      .run(playerId, getLeagueState(playerId).current_season, 'event', 'Decided to run it back one more season — the body will pay a toll.');
    return { retired: false, one_more_year: true };
  }
  throw httpError(400, "Invalid choice. Use 'retire' or 'one_more_year'.");
}

// Second life — what a retired player does next. Paths are gated by the traits
// they built over their career; each yields fame, wealth, and a legacy score.
const SECOND_LIFE_PATHS = {
  broadcaster: { label: 'Broadcaster', icon: '🎙️', desc: 'Call games from the booth.', req: { clout: 55 }, fame: [2, 8], wealth: [0.3, 1.5] },
  coach:       { label: 'Head Coach', icon: '🧠', desc: 'Run a franchise from the bench.', req: { bbiq: 60, leadership: 55 }, fame: [1, 6], wealth: [0.5, 2.5] },
  executive:   { label: 'Front Office', icon: '💼', desc: 'Build a contender as a GM.', req: { bbiq: 60, clout: 50 }, fame: [0, 4], wealth: [1, 5] },
  owner:       { label: 'Team Owner', icon: '🏟️', desc: 'Buy your own franchise.', req: { wealth: 80 }, req_values: { money: 5 }, fame: [1, 5], wealth: [3, 10] },
  empire:      { label: 'Business Empire', icon: '🏢', desc: 'Turn your money into an empire.', req: { wealth: 30 }, req_values: { money: 3 }, fame: [0, 3], wealth: [1, 8] },
  foundation:  { label: 'Philanthropist', icon: '🤝', desc: 'Start a family foundation in your name.', req: { clout: 40 }, req_values: { family: 6 }, fame: [2, 8], wealth: [0, 0.5] },
};

function secondLifeQualifies(p, values, cfg) {
  return Object.entries(cfg.req || {}).every(([k, v]) => (p[k] ?? 0) >= v)
    && Object.entries(cfg.req_values || {}).every(([k, v]) => (values[k] ?? 0) >= v);
}

function getSecondLifeOptions(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p || !p.retired || p.second_life) return [];
  const values = JSON.parse(p.life_values || '{}');
  return Object.entries(SECOND_LIFE_PATHS)
    .filter(([, cfg]) => secondLifeQualifies(p, values, cfg))
    .map(([id, cfg]) => ({ id, label: cfg.label, icon: cfg.icon, desc: cfg.desc }));
}

function chooseSecondLife(playerId, path) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p || !p.retired) throw httpError(400, 'Not retired yet.');
  if (p.second_life) throw httpError(400, 'Already chose a second life.');
  const cfg = SECOND_LIFE_PATHS[path];
  if (!cfg) throw httpError(400, 'Unknown path.');
  const values = JSON.parse(p.life_values || '{}');
  if (!secondLifeQualifies(p, values, cfg)) throw httpError(400, "You don't qualify for this path.");
  const fameGain = randInt(cfg.fame[0], cfg.fame[1]);
  const wealthGain = round2(randRange(cfg.wealth[0], cfg.wealth[1]));
  const career = getCareerOverview(playerId);
  let legacyScore = round1(Math.min(100, career.goat_score * 0.6 + fameGain * 1.5 + wealthGain * 0.8));
  // Financial ending: your money decisions echo into retirement. A broke retiree
  // limps away with a stain on their legacy; a wealthy one compounds it.
  let financialEnding = null;
  if ((p.wealth ?? 0) < 5) {
    legacyScore = round1(Math.max(0, legacyScore - 10));
    financialEnding = 'You retired nearly broke — the money never outran the lifestyle.';
  } else if ((p.wealth ?? 0) >= 50) {
    legacyScore = round1(Math.min(100, legacyScore + 5));
    financialEnding = 'You retired wealthy, and the fortune kept compounding.';
  }
  db.prepare('UPDATE players SET second_life=?, legacy_score=?, fan_base=MIN(100,fan_base+?), wealth=wealth+? WHERE id=?').run(path, legacyScore, fameGain, wealthGain, playerId);
  db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
    .run(playerId, getLeagueState(playerId).current_season, 'event', `Began a second life as a ${cfg.label} (${cfg.icon}).`);
  return { path, label: cfg.label, icon: cfg.icon, fame_gain: fameGain, wealth_gain: wealthGain, legacy_score: legacyScore, financial_ending: financialEnding };
}

// Advance the second life one year: fame/wealth trickle in and legacy compounds.
function advanceSecondLife(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p || !p.retired || !p.second_life) throw httpError(400, 'No active second life.');
  const cfg = SECOND_LIFE_PATHS[p.second_life];
  if (!cfg) throw httpError(400, 'Unknown second life.');
  const fame = randInt(cfg.fame[0], cfg.fame[1]);
  const wealth = round2(randRange(cfg.wealth[0], cfg.wealth[1]));
  const legacy = round1(Math.min(100, (p.legacy_score || 0) + fame * 0.3 + wealth * 0.2));
  db.prepare('UPDATE players SET second_life_years=second_life_years+1, legacy_score=?, fan_base=MIN(100,fan_base+?), wealth=wealth+? WHERE id=?').run(legacy, fame, wealth, playerId);
  return { year: (p.second_life_years || 0) + 1, fame, wealth, legacy_score: legacy };
}

function endSeasonToOffseason(playerId, playoffResult) {
  const season = getLeagueState(playerId).current_season;
  recordPlayoffStats(playerId, season);
  if (playoffResult) db.prepare('UPDATE season_summaries SET playoff_result=? WHERE player_id=? AND season_number=?').run(playoffResult, playerId, season);
  if (playoffResult === 'NBA Champion') {
    const row = db.prepare('SELECT awards FROM season_summaries WHERE player_id=? AND season_number=?').get(playerId, season);
    let awards = [];
    try { awards = JSON.parse(row?.awards || '[]'); } catch {}
    for (const a of ['NBA Champion', 'Finals MVP']) if (!awards.includes(a)) awards.push(a);
    db.prepare('UPDATE season_summaries SET awards=? WHERE player_id=? AND season_number=?').run(JSON.stringify(awards), playerId, season);
    db.prepare("INSERT INTO awards (player_id,season_number,award_type,award_name) VALUES (?,?,'season','NBA Champion')").run(playerId, season);
    db.prepare("INSERT INTO awards (player_id,season_number,award_type,award_name) VALUES (?,?,'season','Finals MVP')").run(playerId, season);
  }
  resetSeasonCounters(playerId);
  db.prepare('UPDATE players SET experience=experience+1 WHERE id=?').run(playerId);
  const yearSettlement = advanceYear(playerId);
  db.prepare("UPDATE league_state SET current_phase='offseason', games_played_in_season=0, playoff_round=0, series_wins=0, series_losses=0, playoff_opponent=0 WHERE player_id=?").run(playerId);
  const ageChanges = applyAging(playerId);
  const retirement = maybeRetire(playerId);
  checkMilestones(playerId);
  // International tournament year — occasional (a big event roughly every 4 years).
  const intlTournament = Math.random() < 0.25 ? (Math.random() < 0.5 ? 'olympics' : 'fiba') : null;
  db.prepare('UPDATE league_state SET intl_tournament=? WHERE player_id=?').run(intlTournament, playerId);
  return { playoff_result: playoffResult, age_changes: ageChanges, year_settlement: yearSettlement, retirement };
}

// Career milestones — logged once each as the player crosses scoring thresholds.
function checkMilestones(playerId) {
  const totals = db.prepare('SELECT COALESCE(SUM(pts),0) pts FROM game_logs WHERE player_id=?').get(playerId).pts;
  const season = getLeagueState(playerId).current_season;
  const seen = new Set(db.prepare('SELECT milestone FROM career_progress WHERE player_id=? AND milestone IS NOT NULL').all(playerId).map(r => r.milestone));
  for (const [m, goatBonus] of [[5000, 0], [10000, 5], [15000, 0], [20000, 10], [25000, 0], [30000, 15]]) {
    const key = `${m}_points`;
    if (totals >= m && !seen.has(key)) {
      db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description,milestone) VALUES (?,?,'milestone',?,?)")
        .run(playerId, season, `Reached ${m.toLocaleString()} career points.`, key);
      if (goatBonus > 0) db.prepare('UPDATE players SET goat_bonus=goat_bonus+? WHERE id=?').run(goatBonus, playerId);
    }
  }
}

// ------------------------------------------------------------
// All-time records — fictional "legend" benchmarks. Breaking one is a
// career-defining moment: logged as a 'record' event and highlighted in the
// Career tab alongside your own career highs.
// ------------------------------------------------------------
const LEGEND_RECORDS = {
  single_game: [
    { key: 'pts', label: 'Points in a game', holder: 'Wilt Chamberlain', value: 100, stat: 'pts' },
    { key: 'reb', label: 'Rebounds in a game', holder: 'Wilt Chamberlain', value: 55, stat: 'reb' },
    { key: 'ast', label: 'Assists in a game', holder: 'Scott Skiles', value: 30, stat: 'ast' },
    { key: 'stl', label: 'Steals in a game', holder: 'Larry Kenon', value: 11, stat: 'stl' },
    { key: 'blk', label: 'Blocks in a game', holder: 'Elmore Smith', value: 17, stat: 'blk' },
    { key: 'tpm', label: 'Threes in a game', holder: 'Klay Thompson', value: 14, stat: 'tpm' },
  ],
  season: [
    { key: 'ppg', label: 'Points per game', holder: 'Wilt Chamberlain', value: 50.4, stat: 'ppg' },
    { key: 'rpg', label: 'Rebounds per game', holder: 'Wilt Chamberlain', value: 27.2, stat: 'rpg' },
    { key: 'apg', label: 'Assists per game', holder: 'John Stockton', value: 14.5, stat: 'apg' },
    { key: 'spg', label: 'Steals per game', holder: 'Alvin Robertson', value: 3.7, stat: 'spg' },
    { key: 'bpg', label: 'Blocks per game', holder: 'Mark Eaton', value: 5.6, stat: 'bpg' },
  ],
};

// Franchise single-game scoring records — a "reachable" middle tier between a
// personal best and the untouchable legend records. Each team has a fictional
// all-time scoring mark; breaking it is a one-time moment (milestone-deduped).
const FRANCHISE_RECORDS = {
  1: 58, 2: 62, 3: 55, 4: 57, 5: 60, 6: 66, 7: 60, 8: 57, 9: 61, 10: 64,
  11: 62, 12: 55, 13: 58, 14: 60, 15: 54, 16: 63, 17: 59, 18: 61, 19: 57, 20: 62,
  21: 60, 22: 58, 23: 64, 24: 59, 25: 63, 26: 57, 27: 61, 28: 60, 29: 62, 30: 58,
};

// A single-game box line checked against the single-game records.
function checkGameRecords(box) {
  return LEGEND_RECORDS.single_game
    .filter(r => (box[r.stat] || 0) > r.value)
    .map(r => ({ ...r, category: 'single_game', achieved: box[r.stat] }));
}

// Season averages checked against the season records at finalize time.
function checkSeasonRecords(stats) {
  return LEGEND_RECORDS.season
    .filter(r => (stats[r.stat] || 0) > r.value)
    .map(r => ({ ...r, category: 'season', achieved: stats[r.stat] }));
}

// Career highs vs the legends — what the Career tab renders.
function careerRecords(playerId) {
  const g = db.prepare('SELECT MAX(pts) pts, MAX(reb) reb, MAX(ast) ast, MAX(stl) stl, MAX(blk) blk, MAX(tpm) tpm FROM game_logs WHERE player_id=?').get(playerId);
  const s = db.prepare('SELECT MAX(ppg) ppg, MAX(rpg) rpg, MAX(apg) apg, MAX(spg) spg, MAX(bpg) bpg FROM season_summaries WHERE player_id=?').get(playerId);
  const best = {
    single_game: { pts: g?.pts || 0, reb: g?.reb || 0, ast: g?.ast || 0, stl: g?.stl || 0, blk: g?.blk || 0, tpm: g?.tpm || 0 },
    season: { ppg: s?.ppg || 0, rpg: s?.rpg || 0, apg: s?.apg || 0, spg: s?.spg || 0, bpg: s?.bpg || 0 },
  };
  const held = [];
  for (const r of LEGEND_RECORDS.single_game) if (best.single_game[r.stat] > r.value) held.push({ ...r, category: 'single_game', achieved: best.single_game[r.stat] });
  for (const r of LEGEND_RECORDS.season) if (best.season[r.stat] > r.value) held.push({ ...r, category: 'season', achieved: best.season[r.stat] });
  return { legends: LEGEND_RECORDS, best, held };
}

function logRecordBroken(playerId, season, record) {
  db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description,milestone) VALUES (?,?,?,?,?)")
    .run(playerId, season, 'record', `${record.label} — new all-time record: ${record.achieved} (was ${record.holder}'s ${record.value})`, `record_${record.category}_${record.key}`);
  // Breaking an all-time record is a career-defining moment — real rewards.
  // goat_bonus is in the SAME raw units as the GOAT formula (÷6.5 at display),
  // so a single-game record (~10) is about half an MVP (20), not 2/3 of one.
  const isGame = record.category === 'single_game';
  db.prepare('UPDATE players SET clout=MIN(100,clout+?), fan_base=MIN(100,fan_base+?), goat_bonus=goat_bonus+? WHERE id=?')
    .run(isGame ? 5 : 4, isGame ? 5 : 0, isGame ? 10 : 15, playerId);
}

function finalizeSeason(playerId) {
  const state = getLeagueState(playerId);
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (state.games_played_in_season < 82) throw httpError(400, `Season not complete (${state.games_played_in_season}/82 games). Keep playing.`);
  const existing = db.prepare('SELECT id FROM season_summaries WHERE player_id=? AND season_number=?').get(playerId, state.current_season);
  if (existing) throw httpError(400, 'This season has already been finalized.');

  const g = Math.max(1, p.s_games), m = Math.max(1, p.s_min);
  const mpg = round1(m / g), ppg = round1(p.s_pts / g), rpg = round1(p.s_reb / g);
  const apg = round1(p.s_ast / g), spg = round1(p.s_stl / g), bpg = round1(p.s_blk / g), topg = round1(p.s_tov / g);
  const fgPct = round3(p.s_fgm / Math.max(1, p.s_fga));
  const tpPct = round3(p.s_3pm / Math.max(1, p.s_3pa));
  const ftPct = round3(p.s_ftm / Math.max(1, p.s_fta));
  const adv = seasonAdvancedStats(playerId, state.current_season, p.s_wins);
  const per = adv.per, ws = adv.ws, bpm = adv.bpm, vorp = adv.vorp;
  const tsDenom = 2 * (p.s_fga + 0.44 * p.s_fta);
  const tsPct = round3(p.s_pts / Math.max(1, tsDenom));
  const usgPct = clamp(Math.round(100 * (p.s_fga / g + 0.44 * p.s_fta / g + p.s_tov / g) / Math.max(1, 100 * (mpg / 48))), 3, 50);

  const awards = [];
  const star = ppg + rpg * 0.8 + apg * 0.8 + spg * 1.5 + bpg * 1.5;
  // Season-long awards require actually being on the floor for most of the year:
  // a part-time player can't accumulate the counting stats that win real honors.
  const AWARD_MIN_GAMES = 58; // ~70% of 82
  const playedEnough = g >= AWARD_MIN_GAMES;

  // MVP: be the league's best — clear the top AI star's score (same formula as
  // the MVP Race). A weak season never wins regardless of the AI field.
  const playerWinPct = (p.s_wins + p.s_losses) > 0 ? p.s_wins / (p.s_wins + p.s_losses) : 0.5;
  if (playedEnough && star > 25 && mvpScoreFrom(star, playerWinPct) > topAiMvpScore(playerId)) awards.push('MVP');
  if (playedEnough && star > 34) awards.push('All-NBA First Team');
  else if (playedEnough && star > 28) awards.push('All-NBA Second Team');
  else if (playedEnough && star > 22) awards.push('All-NBA Third Team');

  // Defensive honors reward three archetypes — stat monsters, well-rounded
  // Swiss-Army-Knives (Green), and sound low-foul positional defenders (Dumars).
  // Production is the backbone, but reputation and "clean" defense matter too,
  // so a defender who never gambles can still win without one gaudy counting stat.
  // Raw ratings still can't carry a low-minute player: the mpg gate blocks that.
  const defProd = spg * 2.0 + bpg * 2.5 + rpg * 0.25;
  const defRep = (p.perimeter_defense + p.help_defense + p.rim_protection) / 300.0; // 0..1
  const pfRate = (p.s_pf || 0) / Math.max(1, g); // personal fouls per game
  const defScore = defProd * (1 + defRep * 0.7) + defRep * 3.0 + clamp(3 - pfRate, 0, 3);
  if (playedEnough && mpg >= 28 && defScore > 11) awards.push('DPOY');
  if (playedEnough && mpg >= 24 && defScore > 8) awards.push('All-Defensive First Team');
  else if (playedEnough && mpg >= 20 && defScore > 5.5) awards.push('All-Defensive Second Team');

  if (p.experience === 0 && g >= 45 && mpg >= 18) {
    if (ppg > 16) awards.push('ROTY');
    if (ppg > 13) awards.push('All-Rookie First Team');
    else if (ppg > 8) awards.push('All-Rookie Second Team');
  }
  if (ppg >= 12 && ppg <= 20 && mpg >= 18 && mpg < 28 && g > 55) awards.push('Sixth Man of the Year');

  const scols = ['player_id', 'season_number', 'team_id', 'age', 'games_played', 'mpg', 'ppg', 'rpg', 'apg', 'spg', 'bpg', 'topg', 'fg_pct', 'tp_pct', 'ft_pct', 'per', 'ts_pct', 'usg_pct', 'ws', 'bpm', 'vorp', 'team_wins', 'team_losses', 'playoff_result', 'role', 'awards'];
  const svals = [playerId, state.current_season, p.team_id, p.age, g, mpg, ppg, rpg, apg, spg, bpg, topg, fgPct, tpPct, ftPct, per, tsPct, usgPct, ws, bpm, vorp, p.s_wins, p.s_losses, null, p.role, JSON.stringify(awards)];
  db.prepare(`INSERT INTO season_summaries (${scols.join(',')}) VALUES (${scols.map(() => '?').join(',')})`).run(...svals);
  for (const a of awards) db.prepare("INSERT INTO awards (player_id,season_number,award_type,award_name) VALUES (?,?,'season',?)").run(playerId, state.current_season, a);

  const recordsBroken = checkSeasonRecords({ ppg, rpg, apg, spg, bpg });
  for (const r of recordsBroken) logRecordBroken(playerId, state.current_season, r);

  const base = { season: state.current_season, stats: { ppg, rpg, apg, spg, bpg, topg, fg_pct: fgPct, tp_pct: tpPct, ft_pct: ftPct, mpg },
                 advanced: { per, ts_pct: tsPct, usg_pct: usgPct, ws, bpm, vorp },
                 team_record: `${p.s_wins}-${p.s_losses}`, awards, records_broken: recordsBroken };

  // Qualify for the playoffs (~.500 or better), then seed the bracket.
  if (p.s_wins >= 42) {
    advanceLeague(playerId, p.team_id, p.s_wins, p.s_losses); // sync all teams to 82 before seeding
    const seeds = conferenceSeeds(getConferenceStandings(playerId), TEAMS[p.team_id].conf);
    const seed = Math.max(1, Math.min(8, seeds.findIndex(t => t.team_id === p.team_id) + 1));
    const oppSeed = bracketOpponentSeed(seed, 1);
    const oppId = seeds[oppSeed - 1]?.team_id;
    resetSeasonCounters(playerId);
    db.prepare("UPDATE league_state SET current_phase='playoffs', games_played_in_season=0, playoff_round=1, series_wins=0, series_losses=0, playoff_opponent=?, player_seed=?, opponent_seed=? WHERE player_id=?").run(oppId, seed, oppSeed, playerId);
    return { ...base, qualified: true, seed, playoff_opponent: TEAMS[oppId].name, playoff_opponent_abbr: TEAMS[oppId].abbr, playoff_opponent_seed: oppSeed, age_changes: null };
  }

  const end = endSeasonToOffseason(playerId, 'Missed Playoffs');
  return { ...base, qualified: false, playoff_result: 'Missed Playoffs', age_changes: end.age_changes, year_settlement: end.year_settlement, retirement: end.retirement };
}

function simulatePlayoffGame(playerId) {
  const state = getLeagueState(playerId);
  if (state.current_phase !== 'playoffs') throw httpError(400, 'No active playoff series.');
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  const oppId = state.playoff_opponent;
  // 2-2-1-1-1 home court: the higher seed hosts games 1, 2, 5, 7.
  const gameInSeries = state.series_wins + state.series_losses + 1;
  const higherIsHome = [1, 2, 5, 7].includes(gameInSeries);
  const playerIsHigher = (state.player_seed || 9) < (state.opponent_seed || 9);
  const isHome = higherIsHome ? playerIsHigher : !playerIsHigher;
  const game = simulateGame(playerId, oppId, true, isHome);

  let sw = state.series_wins, sl = state.series_losses;
  if (game.result === 'W') sw++; else sl++;
  const roundName = PLAYOFF_ROUND_NAMES[state.playoff_round] || `Round ${state.playoff_round}`;
  const series = { round: state.playoff_round, round_name: roundName, wins: sw, losses: sl,
                   opponent: TEAMS[oppId].name, opponent_abbr: TEAMS[oppId].abbr,
                   player_seed: state.player_seed, opponent_seed: state.opponent_seed };

  if (sw >= 4 && state.playoff_round >= 4) {
    db.prepare('UPDATE league_state SET series_wins=?, series_losses=? WHERE player_id=?').run(sw, sl, playerId);
    const end = endSeasonToOffseason(playerId, 'NBA Champion');
    return { game, series, champion: true, eliminated: false, age_changes: end.age_changes, year_settlement: end.year_settlement, retirement: end.retirement };
  }
  if (sw >= 4) {
    const nextSeed = bracketOpponentSeed(state.player_seed, state.playoff_round + 1);
    const nextOpp = playoffOpponentTeam(getConferenceStandings(playerId), p.team_id, state.player_seed, state.playoff_round + 1);
    db.prepare('UPDATE league_state SET playoff_round=playoff_round+1, series_wins=0, series_losses=0, playoff_opponent=?, opponent_seed=? WHERE player_id=?').run(nextOpp, nextSeed, playerId);
    return { game, series, champion: false, eliminated: false, advanced: true, next_round: state.playoff_round + 1, next_opponent: TEAMS[nextOpp].name };
  }
  if (sl >= 4) {
    const result = state.playoff_round === 4 ? 'Finals Loss' : roundName;
    db.prepare('UPDATE league_state SET series_wins=?, series_losses=? WHERE player_id=?').run(sw, sl, playerId);
    const end = endSeasonToOffseason(playerId, result);
    return { game, series, champion: false, eliminated: true, playoff_result: result, age_changes: end.age_changes, year_settlement: end.year_settlement, retirement: end.retirement };
  }
  db.prepare('UPDATE league_state SET series_wins=?, series_losses=? WHERE player_id=?').run(sw, sl, playerId);
  return { game, series, champion: false, eliminated: false };
}

function applyAging(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  const arche = GROWTH_ARCHETYPES[p.growth] || GROWTH_ARCHETYPES.steady;
  const newAge = p.age + 1;
  const changes = {};

  // Development: until the archetype's peak age, scaled by its dev multiplier,
  // and subject to "bust" stalls (a high-upside player who never arrives).
  if (newAge < arche.peak) {
    const devChance = (p.potential || 50) / 100.0 * (p.work_ethic || 50) / 100.0 * arche.dev;
    const stalled = Math.random() < arche.bust;
    if (!stalled && Math.random() < devChance) {
      const ageMult = newAge < 21 ? 1.4 : newAge < 24 ? 1.1 : newAge < 26 ? 0.8 : 0.5;
      const devAttrs = ['mid_range', 'catch_shoot_3pt', 'perimeter_defense', 'help_defense', 'pnr_vision', 'ball_security', 'rebounding'];
      const sample = shuffle(devAttrs.slice()).slice(0, 3);
      for (const attr of sample) {
        const cur = p[attr] ?? 50;
        let gain = Math.max(1, Math.round(randInt(1, 3) * ageMult));
        if (cur >= 80) gain = Math.max(1, gain - 1);
        if (cur >= 90) gain = 0;
        if (gain <= 0) continue;
        changes[attr] = clamp(cur + gain, 15, 95);
      }
    }
  }

  // Athletic decline: begins a couple years after the peak, scaled by the
  // archetype's decline multiplier (ageless = slow, fizzle = fast).
  if (newAge >= arche.peak + 2) {
    const rate = (newAge - (arche.peak + 1)) * arche.decline * (newAge >= arche.peak + 6 ? 1.0 : 0.55);
    for (const attr of ['vertical_jump', 'speed', 'lateral_quickness', 'strength', 'core_stability', 'stamina', 'durability', 'first_step', 'finishing']) {
      const decline = Math.round(rate * randRange(0.5, 1.3));
      if (decline > 0) changes[attr] = clamp((p[attr] ?? 50) - decline, 8, 99);
    }
  }

  // Mental growth: veterans get savvier until late in their career.
  const mentalUntil = arche === GROWTH_ARCHETYPES.ageless ? 36 : 34;
  if (newAge <= mentalUntil) {
    for (const attr of ['bbiq', 'composure', 'leadership']) {
      const gain = randInt(0, 2);
      if (gain > 0) changes[attr] = clamp((p[attr] ?? 50) + gain, 20, 99);
    }
  }

  const parts = ['age=?', "updated_at=datetime('now')"]; const vals = [newAge];
  for (const [attr, val] of Object.entries(changes)) { parts.push(`${attr}=?`); vals.push(val); }
  vals.push(playerId);
  db.prepare(`UPDATE players SET ${parts.join(', ')} WHERE id=?`).run(...vals);
  return { new_age: newAge, attribute_changes: changes, growth: p.growth };
}

// ------------------------------------------------------------
// Training
// ------------------------------------------------------------
const TRAINING_PROGRAMS = {
  'Explosive Athlete': { desc: 'Plyometrics and sprint work to boost vertical, first step, and speed.', primary: ['vertical_jump', 'speed', 'first_step'], secondary: ['lateral_quickness', 'stamina'], intensity: 0.82, inj_risk: 5 },
  'Strength & Power': { desc: 'Heavy weight training for strength, core stability, and contact finishing.', primary: ['strength', 'core_stability', 'finishing', 'rebounding'], secondary: ['box_out', 'vertical_jump'], intensity: 0.78, inj_risk: 4 },
  'Shooting Lab': { desc: '10,000 reps: catch-and-shoot, pull-up, mid-range, free throws.', primary: ['catch_shoot_3pt', 'mid_range', 'pull_up_3pt', 'free_throw'], secondary: ['off_ball'], intensity: 0.62, inj_risk: 1 },
  'Ball Handling': { desc: 'Tight handles, PnR reads, passing under pressure.', primary: ['ball_security', 'pnr_vision', 'passing_accuracy'], secondary: ['first_step', 'composure'], intensity: 0.68, inj_risk: 2 },
  'Defensive Specialist': { desc: 'Lateral slides, closeouts, film study for defensive IQ.', primary: ['perimeter_defense', 'help_defense', 'lateral_quickness', 'steal'], secondary: ['rim_protection', 'bbiq'], intensity: 0.72, inj_risk: 3 },
  'Conditioning': { desc: 'Marathon training — stamina, durability, body maintenance.', primary: ['stamina', 'durability'], secondary: ['speed', 'strength'], intensity: 0.58, inj_risk: 0 },
  'Post Game': { desc: 'Footwork, hook shots, rebounding positioning.', primary: ['finishing', 'box_out', 'rebounding', 'core_stability'], secondary: ['strength', 'mid_range'], intensity: 0.68, inj_risk: 2 },
  'Rebounding': { desc: 'Glass work — boxing out, positioning, and second-chance hunting.', primary: ['rebounding', 'box_out', 'strength'], secondary: ['vertical_jump', 'core_stability'], intensity: 0.70, inj_risk: 3 },
  'Mental Toughness': { desc: 'Pressure simulation, meditation, late-game scenario work.', primary: ['clutch_factor', 'composure', 'bbiq'], secondary: ['leadership', 'mid_range'], intensity: 0.48, inj_risk: 0 },
};

function applyTraining(playerId, programNames) {
  if (!Array.isArray(programNames)) programNames = [programNames];
  programNames = programNames.filter(Boolean);
  if (programNames.length < 1 || programNames.length > 3) throw httpError(400, 'Choose 1 to 3 training programs.');
  if (new Set(programNames).size !== programNames.length) throw httpError(400, 'Choose distinct programs (no duplicates).');
  const progs = programNames.map(name => {
    const prog = TRAINING_PROGRAMS[name];
    if (!prog) throw httpError(400, `Unknown program: ${name}`);
    return prog;
  });
  const state = getLeagueState(playerId);
  if (state.current_phase !== 'offseason') throw httpError(400, 'Training is only available during the offseason.');
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (p.trained_season === state.current_season) throw httpError(400, "You've already trained this offseason. One plan per offseason.");

  let tmult;
  if (p.age < 22) tmult = 1.35; else if (p.age < 26) tmult = 1.12; else if (p.age < 30) tmult = 0.88; else if (p.age < 33) tmult = 0.60; else tmult = 0.30;
  const wmult = 0.65 + (p.work_ethic / 100.0) * 0.7;
  const uncertainty = randRange(0.7, 1.3);
  const results = { programs: programNames, gains: {}, injuries: [], fatigue_cleared: 0 };

  // Diminishing returns: one offseason can't fully develop three skills — the
  // first program is primary, each later program spreads your effort thinner.
  const SLOT_MULT = [1.0, 0.72, 0.48];

  // Track the running rating per attribute so overlapping programs stack
  // correctly (and the high-rating soft-cap applies to the accumulated value).
  const running = {};
  const applyAttr = (attr, baseGain, intensity) => {
    const cur = running[attr] !== undefined ? running[attr] : (p[attr] ?? 50);
    let gain = Math.max(0, Math.round(baseGain * tmult * wmult * intensity * uncertainty));
    if (cur > 80) gain = Math.max(0, gain - 1);
    if (cur > 90) gain = Math.max(0, gain - 2);
    const after = clamp(cur + gain, 10, 99);
    running[attr] = after;
    const before = p[attr] ?? 50;
    results.gains[attr] = { before, after, gain: after - before };
  };

  progs.forEach((prog, i) => {
    const slotMult = SLOT_MULT[i];
    for (const attr of prog.primary) applyAttr(attr, (attr === 'stamina' || attr === 'durability') ? 4 : 3, prog.intensity * slotMult);
    for (const attr of prog.secondary) applyAttr(attr, 2.5, prog.intensity * slotMult);
  });

  // Overtraining: stacking programs raises injury risk faster than linear.
  const totalInj = progs.reduce((s, x) => s + x.inj_risk, 0);
  const overtraining = 1 + (progs.length - 1) * 0.5; // 1.0 / 1.5 / 2.0
  const injChance = totalInj * overtraining * (1.2 - p.durability / 100.0) / 100.0;
  const injuryOccurred = Math.random() < injChance;
  if (injuryOccurred) {
    const itype = choice(['Minor training strain', 'Moderate muscle pull', 'Stress reaction']);
    const igames = itype.includes('Minor') ? randInt(1, 12) : randInt(8, 28);
    results.injuries = [{ type: itype, games: igames }];
  }
  const fatigueCleared = round1(randRange(55, 90));
  results.fatigue_cleared = fatigueCleared;

  const parts = ['fatigue=MAX(0,fatigue-?)', "updated_at=datetime('now')"]; const vals = [fatigueCleared];
  for (const [attr, data] of Object.entries(results.gains)) { parts.push(`${attr}=?`); vals.push(data.after); }
  if (injuryOccurred) { parts.push('injury_status=?'); vals.push(results.injuries[0].type); parts.push('injury_games_remaining=?'); vals.push(results.injuries[0].games); }
  parts.push('trained_season=?'); vals.push(state.current_season);
  vals.push(playerId);
  db.prepare(`UPDATE players SET ${parts.join(', ')} WHERE id=?`).run(...vals);

  results.injury_occurred = injuryOccurred;
  return results;
}

// ------------------------------------------------------------
// Economy & media
// ------------------------------------------------------------
function getEndorsementOffers(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  const state = getLeagueState(playerId);
  // Offers are generated once per season — revisiting Off-Court no longer re-rolls them.
  const existing = db.prepare('SELECT * FROM endorsement_offers WHERE player_id=? AND season_number=?').all(playerId, state.current_season);
  if (existing.length) {
    return existing.map(o => ({ id: o.id, brand: o.brand_name, prestige: o.prestige, annual_value: o.annual_value, years: o.years }))
      .sort((a, b) => b.annual_value - a.annual_value);
  }
  db.prepare('DELETE FROM endorsement_offers WHERE player_id=?').run(playerId);
  const fan = p.fan_base, clout = p.clout;
  const sum = db.prepare('SELECT ppg FROM season_summaries WHERE player_id=? ORDER BY season_number DESC LIMIT 1').get(playerId);
  const perf = (sum?.ppg || (p.s_pts / Math.max(1, p.s_games))) / 22.0;
  const brands = [['Nike', 95, 8.0], ['Adidas', 90, 6.0], ['Jordan Brand', 98, 10.0], ['Under Armour', 75, 4.0], ['Puma', 70, 3.5], ['New Balance', 65, 2.5], ['Anta', 60, 3.0], ['Gatorade', 80, 2.0], ['Beats', 70, 1.0], ['State Farm', 60, 1.5], ['Mercedes', 70, 1.5]];
  const offers = [];
  for (const [brand, prestige, base] of shuffle(brands.slice()).slice(0, 5)) {
    if (fan > prestige - 35) {
      const multi = perf * (fan / 80.0) * (clout / 50.0);
      const annual = round2(base * Math.max(0.25, multi) * randRange(0.7, 1.3));
      if (annual > 0.2) {
        const years = choice([2, 3, 4, 5]);
        const cur = db.prepare('INSERT INTO endorsement_offers (player_id,season_number,brand_name,annual_value,years,prestige) VALUES (?,?,?,?,?,?)')
          .run(playerId, state.current_season, brand, annual, years, prestige);
        offers.push({ id: Number(cur.lastInsertRowid), brand, prestige, annual_value: annual, years });
      }
    }
  }
  return offers.sort((a, b) => b.annual_value - a.annual_value);
}

function signEndorsement(playerId, offerId) {
  const offer = db.prepare('SELECT * FROM endorsement_offers WHERE id=? AND player_id=?').get(offerId, playerId);
  if (!offer) throw httpError(404, 'Offer not found or no longer available');
  const active = db.prepare('SELECT COUNT(*) AS c FROM endorsements WHERE player_id=? AND years_remaining>0').get(playerId);
  if (active.c >= MAX_ENDORSEMENTS) throw httpError(400, `You already have ${MAX_ENDORSEMENTS} active endorsements. Let one expire before signing another.`);
  db.prepare('INSERT INTO endorsements (player_id,brand_name,annual_value,years_remaining,prestige) VALUES (?,?,?,?,?)')
    .run(playerId, offer.brand_name, offer.annual_value, offer.years, offer.prestige);
  // Payout happens at the annual settlement (advanceYear) — signing itself just
  // bumps your profile, so we don't double-count the annual value here.
  db.prepare('UPDATE players SET fan_base=MIN(100,fan_base+?) WHERE id=?').run(randRange(0.3, 1.8), playerId);
  db.prepare('DELETE FROM endorsement_offers WHERE id=?').run(offerId);
  return { brand: offer.brand_name, annual_value: offer.annual_value, years: offer.years, status: 'signed' };
}

function negotiateEndorsement(playerId, offerId) {
  const offer = db.prepare('SELECT * FROM endorsement_offers WHERE id=? AND player_id=?').get(offerId, playerId);
  if (!offer) throw httpError(404, 'Offer not found or no longer available');
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  // Leverage comes from fame and influence; bigger brands (higher prestige) are
  // harder to push around, smaller brands bend more.
  const leverage = clamp(0.25 + (p.clout || 0) / 120 + (p.fan_base || 0) / 200, 0.2, 0.95);
  const successChance = clamp(leverage - (offer.prestige - 50) * 0.003, 0.05, 0.9);
  if (Math.random() < successChance) {
    const bump = round2(offer.annual_value * randRange(0.10, 0.30));
    const newAnnual = round2(offer.annual_value + bump);
    const newYears = offer.years + (Math.random() < 0.4 ? 1 : 0);
    db.prepare('UPDATE endorsement_offers SET annual_value=?, years=? WHERE id=?').run(newAnnual, newYears, offerId);
    return { success: true, brand: offer.brand_name, old_annual: offer.annual_value, new_annual: newAnnual, years: newYears, message: `${offer.brand_name} raised their offer to $${newAnnual}M/yr.` };
  }
  db.prepare('DELETE FROM endorsement_offers WHERE id=?').run(offerId);
  db.prepare('UPDATE players SET clout=MAX(0,clout-2) WHERE id=?').run(playerId);
  return { success: false, brand: offer.brand_name, message: `${offer.brand_name} pulled their offer — you pushed too hard.` };
}

// ------------------------------------------------------------
// Commercial tours + signature shoe — the "personal brand" line,
// separate from endorsements.
// ------------------------------------------------------------
// Offseason commercial tours: spend your offseason growing a global brand instead
// of training. Mutually exclusive with training (same offseason slot).
const TOURS = {
  china: { label: 'China Tour', icon: '🇨🇳', desc: 'Camps and appearances across China. Your shoes sell out in Shanghai.', fan: [8, 15], clout: [4, 8], wealth: [2, 5], values: { fame: 2 } },
  europe: { label: 'Europe Tour', icon: '🇪🇺', desc: 'Clinics across Europe — growing the game and your name.', fan: [6, 12], clout: [3, 6], wealth: [3, 6], values: { fame: 1, money: 1 } },
  africa: { label: 'Basketball Without Borders', icon: '🌍', desc: 'Give back through NBA Africa — less money, a lasting legacy.', fan: [4, 8], clout: [5, 10], wealth: [0, 1], values: { family: 2, fame: 1 } },
};

function takeTour(playerId, destination) {
  const tour = TOURS[destination];
  if (!tour) throw httpError(400, `Unknown tour. Options: ${Object.keys(TOURS).join(', ')}`);
  const state = getLeagueState(playerId);
  if (state.current_phase !== 'offseason') throw httpError(400, 'Tours are only available during the offseason.');
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (p.trained_season === state.current_season) throw httpError(400, "You've already used your offseason (training or a tour). One or the other.");
  const fan = randInt(tour.fan[0], tour.fan[1]);
  const clout = randInt(tour.clout[0], tour.clout[1]);
  const wealth = randInt(tour.wealth[0], tour.wealth[1]);
  db.prepare("UPDATE players SET fan_base=MIN(100,fan_base+?), clout=MIN(100,clout+?), wealth=MAX(0,wealth+?), trained_season=?, updated_at=datetime('now') WHERE id=?")
    .run(fan, clout, wealth, state.current_season, playerId);
  addValues(playerId, tour.values || {});
  // A signature shoe sells more on tour — the brand grows with your reach.
  const shoe = getShoe(playerId);
  if (shoe) {
    let boost = round1(shoe.annual_value * randRange(0.05, 0.15));
    if (destination === 'china' && ['Li-Ning', 'Anta'].includes(shoe.brand)) boost = round1(boost * 1.5); // China loves its own brands
    db.prepare('UPDATE shoes SET annual_value=annual_value+? WHERE id=?').run(boost, shoe.id);
  }
  const message = `${tour.label} — +${fan} fan base, +${clout} clout${wealth > 0 ? `, +$${wealth}M` : ''}.`;
  db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)")
    .run(playerId, state.current_season, 'event', `${message} ${tour.desc}`);
  return { tour: tour.label, icon: tour.icon, fan_base: fan, clout, wealth, message };
}

// International play — the occasional offseason tournament year (FIBA World Cup
// or Olympics). Representing your country costs your training slot but pays in
// global fan base and national clout, with a medal (or a group exit).
const INTL_TOURNAMENTS = {
  fiba: { label: 'FIBA World Cup', icon: '🏀' },
  olympics: { label: 'Olympics', icon: '🥇' },
};

function playIntlTournament(playerId) {
  const state = getLeagueState(playerId);
  if (state.current_phase !== 'offseason') throw httpError(400, 'International play is only available during the offseason.');
  const tournament = state.intl_tournament;
  if (!tournament || !INTL_TOURNAMENTS[tournament]) throw httpError(400, 'No international tournament this year.');
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (p.trained_season === state.current_season) throw httpError(400, "You've already used your offseason (training, tour, or international play).");
  // Medal roll: gold is rare, a group exit is common.
  const roll = Math.random();
  let medal = 'group', fanGain = 2, cloutGain = 1;
  if (roll < 0.12) { medal = 'gold'; fanGain = randInt(10, 15); cloutGain = randInt(6, 10); }
  else if (roll < 0.32) { medal = 'silver'; fanGain = randInt(6, 9); cloutGain = randInt(4, 7); }
  else if (roll < 0.55) { medal = 'bronze'; fanGain = randInt(4, 6); cloutGain = randInt(2, 5); }
  db.prepare("UPDATE players SET fan_base=MIN(100,fan_base+?), clout=MIN(100,clout+?), trained_season=?, updated_at=datetime('now') WHERE id=?")
    .run(fanGain, cloutGain, state.current_season, playerId);
  addValues(playerId, { fame: medal === 'gold' ? 3 : medal === 'silver' ? 2 : medal === 'bronze' ? 1 : 0 });
  const cfg = INTL_TOURNAMENTS[tournament];
  const nat = p.nationality || 'your country';
  const medalLabel = medal === 'gold' ? '🥇 Gold' : medal === 'silver' ? '🥈 Silver' : medal === 'bronze' ? '🥉 Bronze' : 'Group stage exit';
  db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)")
    .run(playerId, state.current_season, 'event', `${cfg.label}: ${medalLabel} for ${nat} — +${fanGain} global fan base, +${cloutGain} clout.`);
  db.prepare('UPDATE league_state SET intl_tournament=NULL WHERE player_id=?').run(playerId);
  return { tournament: cfg.label, nationality: nat, medal, medal_label: medalLabel, fan_base: fanGain, clout: cloutGain };
}

const SHOE_BRANDS = ['Nike', 'Adidas', 'Jordan Brand', 'Puma', 'Under Armour', 'Anta', 'Li-Ning', 'New Balance'];

function shoeAnnualValue(p) {
  return round1(clamp((p.clout || 0) * 0.08 + (p.fan_base || 0) * 0.06, 2, 18));
}

function getShoe(playerId) {
  return db.prepare('SELECT * FROM shoes WHERE player_id=?').get(playerId) || null;
}

function signShoe(playerId, brand, name, colorway) {
  if (!SHOE_BRANDS.includes(brand)) throw httpError(400, `Unknown brand. Options: ${SHOE_BRANDS.join(', ')}`);
  if (!name || !name.trim()) throw httpError(400, 'Give your shoe a name.');
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if ((p.clout || 0) < 60) throw httpError(400, 'You need 60+ clout to land a signature shoe.');
  if (getShoe(playerId)) throw httpError(400, 'You already have a signature shoe.');
  const annual = shoeAnnualValue(p);
  const season = getLeagueState(playerId).current_season;
  db.prepare('INSERT INTO shoes (player_id,brand,name,colorway,annual_value,signed_season) VALUES (?,?,?,?,?,?)')
    .run(playerId, brand, name.trim(), colorway || 'home', annual, season);
  db.prepare('INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,?,?)')
    .run(playerId, season, 'event', `Signed a signature shoe deal: the ${brand} "${name.trim()}" (${colorway || 'home'}). $${annual}M/yr in royalties.`);
  return { brand, name: name.trim(), colorway: colorway || 'home', annual_value: annual };
}

// Asset classes — each has a return profile, a minimum buy-in, and liquidity.
// `lock` = how many seasons it's locked; `liq` controls early-exit behavior.
const ASSET_TYPES = {
  index:       { label: 'Index Fund',  icon: '📊', desc: 'Low-risk, always liquid, steady 3–8%.', risk: 'Low',    ret: [0.03, 0.08],  lock: 0, min: 1,  liq: 'liquid' },
  stocks:      { label: 'Stocks',      icon: '📈', desc: 'Medium-risk, liquid, swingy −15%…+25%.', risk: 'Medium', ret: [-0.15, 0.25], lock: 0, min: 1, liq: 'liquid' },
  real_estate: { label: 'Real Estate', icon: '🏠', desc: 'Low volatility, but locked one season (or exit early at −15%).', risk: 'Medium', ret: [0.04, 0.10], lock: 1, min: 5, liq: 'illiquid' },
  startup:     { label: 'Startup',     icon: '🚀', desc: 'Locked 3 seasons. Small chance of a big exit — or it goes to zero.', risk: 'High', ret: null, lock: 3, min: 1, liq: 'locked' },
  team_stake:  { label: 'Team Stake',  icon: '🏀', desc: 'Own a slice of a franchise — dividends + fame. Needs $50M + 60 clout.', risk: 'Medium', ret: [0.05, 0.12], lock: 0, min: 50, liq: 'liquid', needs_clout: 60 },
};

function makeInvestment(playerId, assetType, amount) {
  const t = ASSET_TYPES[assetType];
  if (!t) throw httpError(400, `Unknown asset type: ${assetType}`);
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  if (amount < t.min) throw httpError(400, `${t.label} requires at least $${t.min}M.`);
  if (amount > p.wealth) throw httpError(400, 'Insufficient funds');
  if (t.needs_clout && (p.clout || 0) < t.needs_clout) throw httpError(400, `${t.label} requires ${t.needs_clout}+ clout.`);
  const season = getLeagueState(playerId).current_season;
  const annualReturn = t.ret ? round3(randRange(t.ret[0], t.ret[1])) : 0;
  db.prepare('INSERT INTO investments (player_id,name,amount_invested,current_value,annual_return,risk_level,asset_type,lock_season) VALUES (?,?,?,?,?,?,?,?)')
    .run(playerId, t.label, amount, amount, annualReturn, t.risk, assetType, season + t.lock);
  db.prepare('UPDATE players SET wealth=wealth-? WHERE id=?').run(amount, playerId);
  return { name: t.label, icon: t.icon, amount, annual_return: annualReturn, asset_type: assetType, lock_season: season + t.lock };
}

function redeemInvestment(playerId, investmentId) {
  const inv = db.prepare('SELECT * FROM investments WHERE id=? AND player_id=?').get(investmentId, playerId);
  if (!inv) throw httpError(404, 'Investment not found');
  const season = getLeagueState(playerId).current_season;
  let value = inv.current_value || 0;
  let penalty = 0;
  if ((inv.lock_season || 0) > season) {
    if (inv.asset_type === 'startup') throw httpError(400, `Startup is locked until season ${inv.lock_season}.`);
    if (inv.asset_type === 'real_estate') { penalty = round2(value * 0.15); value = round2(value * 0.85); }
  }
  db.prepare('DELETE FROM investments WHERE id=?').run(investmentId);
  db.prepare('UPDATE players SET wealth=wealth+? WHERE id=?').run(value, playerId);
  const profit = round2(value - (inv.amount_invested || 0));
  return { redeemed: true, name: inv.name, amount: value, profit, penalty, early_exit: penalty > 0 };
}

const CAREER_EVENTS = [
  { id: 'charity_event', title: { en: 'Community Hero', zh: '社区英雄' }, tone: 'positive', weight: 3,
    text: { en: 'A charity clinic you ran quietly blew up locally. The city loves you for it.', zh: '你默默办的慈善训练营在当地火了。这座城市因此更爱你。' },
    effects: { fan_base: [2, 6], morale: [2, 5], clout: [0, 2] } },
  { id: 'shoe_launch', title: { en: 'Signature Shoe Buzz', zh: '签名鞋传闻' }, tone: 'positive', weight: 2, min_experience: 2,
    text: { en: 'Rumors of your own signature shoe are swirling. Your brand is rising.', zh: '关于你签名鞋的传闻四起，你的个人品牌在上升。' },
    effects: { clout: [2, 6], fan_base: [1, 4], wealth: [0, 0] } },
  { id: 'family_emergency', title: { en: 'Family Emergency', zh: '家庭突发状况' }, tone: 'negative', weight: 2,
    text: { en: 'A family emergency pulled you away for a few days. Hard to focus on ball.', zh: '家里出了急事，你离开了好几天。很难专注打球。' },
    effects: { morale: [-12, -4] }, attr_effects: { composure: [-3, -1] } },
  { id: 'coach_feud', title: { en: 'Locker-Room Tension', zh: '更衣室紧张' }, tone: 'negative', weight: 2, min_experience: 1,
    text: { en: 'You and the coaching staff butted heads over your role. Teammates noticed.', zh: '你和教练组因为你的角色起了冲突，队友们都看在了眼里。' },
    effects: { chemistry: [-12, -3], morale: [-8, -2] }, attr_effects: { composure: [-2, -1] } },
  { id: 'fan_feud', title: { en: 'Online Backlash', zh: '网络反噬' }, tone: 'negative', weight: 2,
    text: { en: 'A clip of you out of context went viral. Social media is piling on.', zh: '一段断章取义的视频火了，社交媒体上骂声一片。' },
    effects: { fan_base: [-6, -1], morale: [-5, -1] } },
  { id: 'breakout_practice', title: { en: 'Breakthrough in Practice', zh: '训练突破' }, tone: 'positive', weight: 3,
    text: { en: 'Something clicked in a late-night shootaround. Your game feels sharper.', zh: '深夜加练时突然开窍了，你的比赛感觉更锐利了。' },
    attr_effects: { work_ethic: [0, 1] } },
  { id: 'mentor_wisdom', title: { en: 'A Veteran Takes You Under', zh: '老将提携' }, tone: 'positive', weight: 2,
    text: { en: 'A grizzled veteran spent the week teaching you the nuances of the game.', zh: '一位身经百战的老将用了一周时间，教你比赛里的那些微妙之处。' },
    effects: { morale: [1, 4] }, attr_effects: { bbiq: [1, 2], leadership: [1, 2] } },
  { id: 'nutrition_program', title: { en: 'Body Transformation', zh: '身体蜕变' }, tone: 'positive', weight: 2,
    text: { en: 'A new nutritionist fixed your diet. You feel lighter and stronger.', zh: '一位新的营养师调整了你的饮食，你感觉更轻盈也更强壮了。' },
    attr_effects: { stamina: [1, 3], durability: [1, 2] } },
  { id: 'viral_moment', title: { en: 'Viral Highlight', zh: '爆红高光' }, tone: 'positive', weight: 3,
    text: { en: 'A highlight of yours is everywhere. Your name is trending.', zh: '你的一个高光瞬间传遍全网，你的名字上了热搜。' },
    effects: { clout: [1, 5], fan_base: [1, 5] } },
  { id: 'league_fine', title: { en: 'League Fine', zh: '联盟罚款' }, tone: 'negative', weight: 2,
    text: { en: 'The league fined you for a postgame outburst. Costly, and a bad look.', zh: '联盟因为你赛后的失态罚了你款。代价不小，观感也差。' },
    effects: { wealth: [-3, -1], morale: [-6, -1], clout: [-2, 0] } },
  { id: 'charity_backfire', title: { en: 'Charity Scandal', zh: '慈善丑闻' }, tone: 'negative', weight: 1,
    text: { en: 'A charity you endorsed was exposed for mismanaging funds. Guilt by association.', zh: '你背书的慈善机构被曝出资金管理混乱，你被牵连了。' },
    effects: { fan_base: [-5, -1], clout: [-4, -1] } },
  { id: 'endorsement_break', title: { en: 'Endorsement Falls Through', zh: '代言告吹' }, tone: 'negative', weight: 2, min_experience: 1,
    text: { en: 'A major endorsement deal collapsed at the last minute.', zh: '一单重要代言在最后一刻谈崩了。' },
    effects: { wealth: [-5, -2], morale: [-5, -1] } },
];

const MEDIA_SCENARIOS = [
  { id: 'postgame_loss', trigger: 'after_loss', question: { en: "Tough loss tonight. The fans want to hear from you.", zh: "今晚输得憋屈。球迷想听听你的说法。" },
    choices: [
      { text: { en: '"This one\'s on me. I need to step up."', zh: '"这场怪我，我得站出来。"' }, tone: 'accountable', fan_base: [1, 6], clout: [-1, 3], chemistry: [1, 5], mvp: [0, 2] },
      { text: { en: '"We didn\'t execute as a group. We\'ll fix it."', zh: '"我们整体没执行好，会改的。"' }, tone: 'diplomatic', fan_base: [-3, 2], clout: [-2, 1], chemistry: [-6, -1], mvp: [-4, 0] },
      { text: { en: '"Next question. We\'re on to the next one."', zh: '"下一个问题。我们翻篇了。"' }, tone: 'dismissive', fan_base: [-4, 0], clout: [0, 3], chemistry: [-3, 1], mvp: [-2, 1] } ] },
  { id: 'postgame_win', trigger: 'after_win', question: { en: "Big win tonight. What's clicking for you right now?", zh: "今晚大胜。你现在的状态为什么这么好？" },
    choices: [
      { text: { en: '"It\'s all about the guys around me. They make it easy."', zh: '"全靠身边的队友，他们让我打得很轻松。"' }, tone: 'team-first', fan_base: [2, 6], clout: [0, 4], chemistry: [3, 7], mvp: [1, 5] },
      { text: { en: '"I\'m just doing what I do. Nobody can guard me right now."', zh: '"我就是做自己，现在没人防得住我。"' }, tone: 'confident', fan_base: [0, 5], clout: [3, 8], chemistry: [-5, 0], mvp: [5, 12] },
      { text: { en: '"We got lucky with a few calls. Long season, staying humble."', zh: '"我们占了几个判罚的便宜。赛季还长，保持谦逊。"' }, tone: 'humble', fan_base: [1, 4], clout: [1, 4], chemistry: [1, 4], mvp: [2, 6] } ] },
  { id: 'mvp_campaign', trigger: 'mid_season', question: { en: "You're in the MVP conversation. How do you feel about that?", zh: "你进入了 MVP 的讨论。对此你怎么看？" },
    choices: [
      { text: { en: '"It\'s an honor just to be mentioned alongside those names."', zh: '"能和那些名字并列被提及，已经是荣誉。"' }, tone: 'humble', fan_base: [1, 4], clout: [1, 5], chemistry: [1, 4], mvp: [3, 8] },
      { text: { en: '"My numbers speak for themselves."', zh: '"我的数据自己会说话。"' }, tone: 'confident', fan_base: [0, 5], clout: [3, 8], chemistry: [-5, 0], mvp: [5, 12] },
      { text: { en: '"We\'re winning games. That\'s all I care about."', zh: '"我们在赢球，这才是我在乎的。"' }, tone: 'team-first', fan_base: [2, 6], clout: [0, 4], chemistry: [3, 7], mvp: [1, 5] } ] },
  { id: 'trade_rumors', trigger: 'random', question: { en: "Rumors are swirling that you want out. Any truth to that?", zh: "有传闻说你想离开球队。这是真的吗？" },
    choices: [
      { text: { en: '"I\'m committed to this city and this team."', zh: '"我忠于这座城市和这支球队。"' }, tone: 'loyal', fan_base: [3, 8], clout: [-4, 0], chemistry: [3, 8], mvp: [0, 0] },
      { text: { en: '"I\'m focused on basketball, not rumors."', zh: '"我只专注篮球，不理会流言。"' }, tone: 'neutral', fan_base: [-2, 2], clout: [0, 2], chemistry: [-1, 1], mvp: [0, 0] },
      { text: { en: '"I want to win championships — wherever that takes me."', zh: '"我想拿总冠军——不管这需要我去哪。"' }, tone: 'ambitious', fan_base: [-10, -2], clout: [2, 7], chemistry: [-12, -3], mvp: [-3, 1] } ] },
  { id: 'social_media', trigger: 'random', question: { en: "Old posts of yours have resurfaced online. How do you respond?", zh: "你以前的旧帖子在网上被翻了出来。你怎么回应？" },
    choices: [
      { text: { en: '"I was young. I\'ve grown a lot since then."', zh: '"那时候我还年轻，现在成长了很多。"' }, tone: 'sincere', fan_base: [-1, 3], clout: [0, 3], chemistry: [0, 2], mvp: [0, 2] },
      { text: { en: '"People are digging for drama. I\'m not engaging."', zh: '"有人就想挖料。我不接招。"' }, tone: 'defensive', fan_base: [-5, 0], clout: [-3, 1], chemistry: [-2, 1], mvp: [-5, 0] },
      { text: { en: 'Stay silent. Let it blow over.', zh: '保持沉默，让它自己过去。' }, tone: 'silent', fan_base: [-3, 1], clout: [-1, 1], chemistry: [0, 0], mvp: [-4, 0] } ] },
  { id: 'rookie_wall', trigger: 'mid_season', question: { en: "The rookie wall is real. How are you handling the grind of an 82-game season?", zh: "新秀墙是真的存在。你是怎么熬过 82 场常规赛的？" },
    choices: [
      { text: { en: '"The veterans warned me. I\'m leaning on my routine."', zh: '"老将们提醒过我。我靠规律作息撑着。"' }, tone: 'focused', fan_base: [0, 3], clout: [0, 2], chemistry: [1, 3], mvp: [0, 1] },
      { text: { en: '"Wall? I don\'t feel one. I\'m built for this."', zh: '"新秀墙？我没感觉到。我就是为这个而生的。"' }, tone: 'confident', fan_base: [0, 4], clout: [2, 6], chemistry: [-3, 0], mvp: [2, 6] },
      { text: { en: '"Honestly, my body hurts every day. But I\'ll keep showing up."', zh: '"说实话，我每天浑身都疼。但我还是会坚持上场。"' }, tone: 'candid', fan_base: [1, 5], clout: [0, 3], chemistry: [0, 2], mvp: [-1, 2] } ] },
  { id: 'all_star_snub', trigger: 'mid_season', question: { en: "You missed the All-Star cut. That had to sting.", zh: "你落选了全明星。这一定很扎心。" },
    choices: [
      { text: { en: '"I\'m using it as fuel. They\'ll remember this."', zh: '"我把这当作燃料，他们会记住的。"' }, tone: 'defiant', fan_base: [1, 5], clout: [2, 6], chemistry: [-1, 2], mvp: [3, 8] },
      { text: { en: '"There are a lot of great players. I\'ll keep working."', zh: '"优秀的球员很多，我会继续努力。"' }, tone: 'humble', fan_base: [2, 5], clout: [0, 3], chemistry: [1, 3], mvp: [1, 4] },
      { text: { en: '"The voting is a joke. I should\'ve been in."', zh: '"投票就是个笑话，我本该入选的。"' }, tone: 'dismissive', fan_base: [-5, 0], clout: [0, 3], chemistry: [-4, 0], mvp: [-2, 2] } ] },
  { id: 'contract_talk', trigger: 'mid_season', question: { en: "Your contract is coming up. Any message for the front office?", zh: "你的合同快到期了。有什么话想对管理层说？" },
    choices: [
      { text: { en: '"I let my agent handle that. I\'m focused on winning."', zh: '"这些交给我经纪人，我只专注赢球。"' }, tone: 'neutral', fan_base: [-1, 2], clout: [0, 2], chemistry: [0, 2], mvp: [0, 0] },
      { text: { en: '"They know what I\'m worth. Pay me like a star."', zh: '"他们知道我的价值，按球星的标准给我。"' }, tone: 'ambitious', fan_base: [-4, 1], clout: [1, 5], chemistry: [-6, -1], mvp: [-2, 2] },
      { text: { en: '"I want to be here long-term and build something."', zh: '"我想长期留在这里，一起建立点什么。"' }, tone: 'loyal', fan_base: [2, 7], clout: [-2, 1], chemistry: [2, 6], mvp: [0, 2] } ] },
  { id: 'coach_criticism', trigger: 'after_loss', question: { en: "Your coach called out your effort after the game. Your response?", zh: "赛后教练点名批评了你的态度。你怎么回应？" },
    choices: [
      { text: { en: '"He\'s right. I have to be better. Point taken."', zh: '"他说得对，我得更好。我接受。"' }, tone: 'accountable', fan_base: [1, 5], clout: [-1, 2], chemistry: [2, 6], mvp: [0, 2] },
      { text: { en: '"He can coach. I\'ll play my game."', zh: '"他当他的教练，我打我的球。"' }, tone: 'defiant', fan_base: [0, 3], clout: [2, 5], chemistry: [-8, -2], mvp: [-1, 2] },
      { text: { en: '"I\'m not getting into a war through the media."', zh: '"我不想通过媒体打嘴仗。"' }, tone: 'diplomatic', fan_base: [-2, 1], clout: [0, 1], chemistry: [0, 2], mvp: [0, 1] } ] },
  { id: 'teammate_chemistry', trigger: 'after_win', question: { en: "Your teammate had a career night. How do you celebrate it?", zh: "队友打出了生涯之夜。你怎么为他庆祝？" },
    choices: [
      { text: { en: '"That\'s my guy. I\'m happier for him than for myself."', zh: '"那是我兄弟，我比他还高兴。"' }, tone: 'team-first', fan_base: [2, 6], clout: [0, 3], chemistry: [4, 9], mvp: [1, 4] },
      { text: { en: '"He gets open looks because of me. Happy to help."', zh: '"他那些空位都是我创造的，我很乐意。"' }, tone: 'confident', fan_base: [-2, 2], clout: [1, 4], chemistry: [-6, -1], mvp: [1, 5] },
      { text: { en: '"We feed off each other. Nights like this are contagious."', zh: '"我们互相成就，这样的夜晚是会传染的。"' }, tone: 'diplomatic', fan_base: [0, 3], clout: [0, 2], chemistry: [1, 4], mvp: [0, 2] } ] },
  { id: 'playoff_pressure', trigger: 'playoffs', question: { en: "The whole city is watching this series. Feeling the pressure?", zh: "整座城市都在盯着这轮系列赛。有压力吗？" },
    choices: [
      { text: { en: '"Pressure is a privilege. This is what we live for."', zh: '"压力是一种特权，这正是我们为之而战的。"' }, tone: 'leader', fan_base: [2, 6], clout: [1, 5], chemistry: [2, 5], mvp: [3, 7] },
      { text: { en: '"I\'ve been here before. I\'m not scared."', zh: '"我经历过这些，我不怕。"' }, tone: 'confident', fan_base: [0, 4], clout: [2, 6], chemistry: [-2, 1], mvp: [3, 8] },
      { text: { en: '"Honestly, I couldn\'t sleep last night. But I\'ll be ready."', zh: '"说实话，我昨晚没睡着。但我会准备好。"' }, tone: 'candid', fan_base: [0, 4], clout: [-1, 2], chemistry: [1, 3], mvp: [0, 3] } ] },
  { id: 'finals_media', trigger: 'playoffs', question: { en: "You're on the biggest stage. What would a ring mean to you?", zh: "你站在了最大的舞台。一枚总冠军戒指对你意味着什么？" },
    choices: [
      { text: { en: '"Everything. I\'ve dreamed of this since I was a kid."', zh: '"意味着一切。我从小就开始做这个梦。"' }, tone: 'sincere', fan_base: [2, 6], clout: [1, 5], chemistry: [2, 5], mvp: [2, 6] },
      { text: { en: '"It\'s just basketball. I\'ll play my game."', zh: '"就是打篮球而已，我照常打。"' }, tone: 'neutral', fan_base: [-2, 2], clout: [0, 2], chemistry: [-1, 1], mvp: [0, 2] },
      { text: { en: '"We\'re one win closer. Ask me after we finish the job."', zh: '"我们离目标又近了一步，等拿下再问我。"' }, tone: 'focused', fan_base: [1, 4], clout: [0, 3], chemistry: [1, 3], mvp: [1, 4] } ] },
  { id: 'retirement_question', trigger: 'random', question: { en: "You're not getting any younger. How much longer do you want to play?", zh: "岁月不饶人。你还想再打多久？" },
    choices: [
      { text: { en: '"Until they rip the jersey off me. I love this game."', zh: '"打到他们把我的球衣扒下来为止，我爱这项运动。"' }, tone: 'proud', fan_base: [2, 6], clout: [1, 4], chemistry: [2, 5], mvp: [0, 3] },
      { text: { en: '"I\'ll know when it\'s time. It\'s not time yet."', zh: '"该退的时候我会知道，现在还不到时候。"' }, tone: 'candid', fan_base: [0, 3], clout: [0, 2], chemistry: [0, 2], mvp: [0, 1] },
      { text: { en: '"A few more rings and I\'m gone. Legacy matters."', zh: '"再拿几枚戒指我就走，遗产很重要。"' }, tone: 'ambitious', fan_base: [-3, 2], clout: [1, 5], chemistry: [-4, 0], mvp: [0, 3] } ] },
  { id: 'load_management_q', trigger: 'mid_season', question: { en: "Fans are upset you sat out a nationally televised game. Defend yourself.", zh: "球迷因为你缺席一场全国直播比赛而不满。为自己辩护一下吧。" },
    choices: [
      { text: { en: '"Long-term health wins rings. That\'s the priority."', zh: '"长期的健康才能换戒指，这才是重点。"' }, tone: 'focused', fan_base: [-2, 2], clout: [0, 2], chemistry: [1, 3], mvp: [0, 2] },
      { text: { en: '"I play when I can. I don\'t owe anyone an explanation."', zh: '"我能上就上，不需要向任何人解释。"' }, tone: 'dismissive', fan_base: [-6, -1], clout: [0, 3], chemistry: [-2, 1], mvp: [-3, 0] },
      { text: { en: '"I\'d rather be out there. It\'s not my call alone."', zh: '"我更想上场，但这不全是我的决定。"' }, tone: 'diplomatic', fan_base: [0, 3], clout: [0, 1], chemistry: [0, 2], mvp: [0, 1] } ] },
  { id: 'disgruntled', trigger: 'random', question: { en: "Your frustration has been showing — you've been short with teammates and the media. What's going on?", zh: "你的不满已经藏不住了——你对队友和媒体都越来越不耐烦。到底怎么了？" },
    choices: [
      { text: { en: '"I\'m not happy with my situation here."', zh: '"我对这里的处境不满意。"' }, tone: 'ambitious', fan_base: [-4, 0], clout: [0, 3], chemistry: [-6, -1], mvp: [-3, 1] },
      { text: { en: '"Just a rough stretch. I\'ll grind through it."', zh: '"只是段低谷，我会咬牙撑过去。"' }, tone: 'focused', fan_base: [1, 3], clout: [0, 2], chemistry: [2, 5], mvp: [0, 2] },
      { text: { en: '"The locker room still believes. We\'ll figure it out."', zh: '"更衣室依然相信彼此，我们会解决的。"' }, tone: 'leader', fan_base: [0, 3], clout: [0, 2], chemistry: [3, 6], mvp: [0, 2] },
    ] },
];

const NARRATIVES = {
  accountable: { en: 'You earned respect by owning the loss. The locker room notices your leadership.', zh: '你主动揽下失利，赢得了尊重。更衣室注意到了你的担当。' },
  diplomatic: { en: 'Your words came across as deflecting blame. Some teammates seemed frustrated.', zh: '你的话听起来像在推卸责任，一些队友面露不悦。' },
  dismissive: { en: 'Fans and media felt brushed off. Your image took a minor hit.', zh: '球迷和媒体觉得被冷落，你的形象受了点小伤。' },
  humble: { en: 'Your humility played well with voters and fans alike. Respect grows quietly.', zh: '你的谦逊赢得了投票人和球迷的好感，尊重在悄然累积。' },
  confident: { en: 'The bold statement raised eyebrows — some admire the swagger, others see arrogance.', zh: '这番豪言让人侧目——有人欣赏这份狂气，也有人看成傲慢。' },
  'team-first': { en: 'Putting the team first resonated deeply. The coaching staff took note.', zh: '把团队放在第一位，引起了深深共鸣。教练组记在了心里。' },
  loyal: { en: 'Your commitment shut down the trade rumors. The city loves you for it.', zh: '你的忠诚表态平息了交易流言，这座城市因此更爱你。' },
  neutral: { en: 'A safe answer that neither hurt nor helped. The story will likely die down.', zh: '一个不痛不痒的安全答案。这件事大概会慢慢过去。' },
  ambitious: { en: 'Your honesty about chasing rings stirred controversy. Management is on edge.', zh: '你直言想要总冠军，惹来争议。管理层有些不安。' },
  sincere: { en: 'A sincere apology went over well. Most people respect growth.', zh: '真诚的道歉反响不错，大多数人尊重成长。' },
  defensive: { en: 'Your combative response amplified the controversy. Not the best look.', zh: '你针锋相对的回应放大了争议，观感并不好。' },
  silent: { en: 'Silence left a vacuum. Speculation continues, but it\'ll fade with time.', zh: '沉默留下了空白。猜测还在继续，但终会随时间淡去。' },
  candid: { en: 'Your raw honesty was refreshing. Fans appreciate the realness.', zh: '你坦诚得让人耳目一新，球迷欣赏这份真实。' },
  defiant: { en: 'Your defiance turned heads. Critics call it arrogance; supporters call it fire.', zh: '你的倔强令人侧目。批评者说是傲慢，支持者说是血性。' },
  focused: { en: 'Your single-minded focus steadied the room. The team rallied around it.', zh: '你的专注让更衣室安定下来，球队因此团结。' },
  leader: { en: 'You spoke like a leader and the locker room followed. Respect grows.', zh: '你像领袖一样发言，更衣室愿意跟随。敬意在增长。' },
  proud: { en: 'Your pride in the game is contagious. Fans and teammates feel it.', zh: '你对这项运动的热爱很有感染力，球迷和队友都感受到了。' },
};

// Notable-performance interviews — media now fires ONLY on big moments (a broken
// record, an All-Star nod, 50+ points, a triple-double), not randomly. Each is a
// question with choices; tone feeds the values axis like any media answer.
const NOTABLE_MEDIA = {
  record: {
    question: (ctx) => `You just set a new all-time record — ${ctx.label}: ${ctx.achieved}. The whole arena is on its feet. How do you feel?`,
    choices: [
      { text: '"This one\'s for my teammates. I couldn\'t have done it alone."', tone: 'team-first', fan_base: [2, 5], clout: [0, 3], chemistry: [3, 7], mvp: [1, 4] },
      { text: '"Records are meant to be broken — I\'m glad it\'s me."', tone: 'confident', fan_base: [0, 4], clout: [3, 8], chemistry: [-3, 0], mvp: [4, 8] },
      { text: '"I\'m just grateful to play this game at this level."', tone: 'humble', fan_base: [2, 5], clout: [1, 4], chemistry: [1, 4], mvp: [2, 5] },
    ],
  },
  allstar: {
    question: () => `You were just named an All-Star. What do you want to say to the fans?`,
    choices: [
      { text: '"It\'s an honor. The fans voted me in — I won\'t forget that."', tone: 'humble', fan_base: [2, 6], clout: [1, 4], chemistry: [1, 4], mvp: [2, 5] },
      { text: '"I\'ve been at this level all year. It\'s about time."', tone: 'confident', fan_base: [0, 4], clout: [3, 7], chemistry: [-3, 0], mvp: [4, 8] },
      { text: '"This is a team award. My guys made me look good."', tone: 'team-first', fan_base: [2, 5], clout: [0, 3], chemistry: [3, 7], mvp: [1, 4] },
    ],
  },
  '50pts': {
    question: (ctx) => `You just dropped ${ctx.pts} points. The locker room is buzzing. What got into you tonight?`,
    choices: [
      { text: '"I was in a zone. When it\'s flowing like that, you just ride it."', tone: 'confident', fan_base: [0, 4], clout: [3, 7], chemistry: [-2, 1], mvp: [4, 8] },
      { text: '"The ball found the open man. I just finished the plays."', tone: 'team-first', fan_base: [1, 4], clout: [0, 3], chemistry: [3, 6], mvp: [1, 3] },
      { text: '"Hard work pays off. I\'ll be back in the gym tomorrow."', tone: 'focused', fan_base: [1, 4], clout: [1, 3], chemistry: [1, 3], mvp: [2, 4] },
    ],
  },
  triple_double: {
    question: (ctx) => `A triple-double — ${ctx.pts} points, ${ctx.reb} boards, ${ctx.ast} dimes. How do you do it all?`,
    choices: [
      { text: '"I try to read the game and fill whatever the team needs."', tone: 'team-first', fan_base: [1, 4], clout: [0, 3], chemistry: [3, 6], mvp: [1, 3] },
      { text: '"I\'ve always been able to do it all. Tonight you saw it."', tone: 'confident', fan_base: [0, 4], clout: [3, 7], chemistry: [-2, 1], mvp: [3, 6] },
      { text: '"Just playing hard and trusting my teammates."', tone: 'humble', fan_base: [2, 5], clout: [1, 3], chemistry: [1, 4], mvp: [2, 4] },
    ],
  },
};

// Resolve a pending notable-performance interview (set by simulateGame).
function handleNotableMedia(playerId, choiceIndex) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p?.media_pending) throw httpError(400, 'No pending media interview.');
  const notable = JSON.parse(p.media_pending);
  const scene = NOTABLE_MEDIA[notable.type];
  if (!scene || choiceIndex < 0 || choiceIndex >= scene.choices.length) throw httpError(400, 'Invalid choice');
  const choice = scene.choices[choiceIndex];
  const effects = {};
  for (const key of ['fan_base', 'clout']) {
    if (key in choice) effects[key] = clamp((p[key] ?? 50) + randInt(choice[key][0], choice[key][1]), 0, 100);
  }
  if ('chemistry' in choice) nudgeBonds(playerId, randInt(choice.chemistry[0], choice.chemistry[1]));
  if ('mvp' in choice) effects.mvp_votes = clamp((p.mvp_votes ?? 0) + randInt(choice.mvp[0], choice.mvp[1]), 0, 100);
  addValues(playerId, MEDIA_TONE_VALUES[choice.tone] || {});
  const lang = getLeagueState(playerId).lang || 'en';
  const narrative = pick(NARRATIVES[choice.tone], lang) || 'Your words had a subtle impact on those around you.';
  const parts = []; const vals = [];
  for (const [key, val] of Object.entries(effects)) { parts.push(`${key}=?`); vals.push(val); }
  parts.push('morale=?'); vals.push(clamp(p.morale + randInt(-3, 5), 10, 100));
  parts.push('media_pending=NULL');
  parts.push("updated_at=datetime('now')");
  vals.push(playerId);
  db.prepare(`UPDATE players SET ${parts.join(', ')} WHERE id=?`).run(...vals);
  const question = scene.question(notable);
  db.prepare("INSERT INTO media_events (player_id,season_number,scenario_id,event_type,description,choice_made,narrative_result) VALUES (?,?,?,'interview',?,?,?)")
    .run(playerId, getLeagueState(playerId).current_season, 'notable_' + notable.type, question, choice.text, pick(NARRATIVES[choice.tone], 'en'));
  return { question, choice: choice.text, narrative, tone: choice.tone };
}

function handleMediaEvent(playerId, scenarioId, choiceIndex) {
  const scenario = MEDIA_SCENARIOS.find(s => s.id === scenarioId);
  if (!scenario || choiceIndex < 0 || choiceIndex >= scenario.choices.length) throw httpError(400, 'Invalid scenario or choice');
  const choice = scenario.choices[choiceIndex];
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  const effects = {};
  for (const key of ['fan_base', 'clout']) {
    if (key in choice) effects[key] = clamp((p[key] ?? 50) + randInt(choice[key][0], choice[key][1]), 0, 100);
  }
  if ('chemistry' in choice) {
    // Chemistry now lives in the locker room — nudge every teammate's bond
    // (which resyncs players.chemistry via the aggregate).
    nudgeBonds(playerId, randInt(choice.chemistry[0], choice.chemistry[1]));
  }
  if ('mvp' in choice) effects.mvp_votes = clamp((p.mvp_votes ?? 0) + randInt(choice.mvp[0], choice.mvp[1]), 0, 100);
  // Media answers quietly shape the values axis (who you are).
  addValues(playerId, MEDIA_TONE_VALUES[choice.tone] || {});
  const lang = getLeagueState(playerId).lang || 'en';
  const narrative = pick(NARRATIVES[choice.tone], lang) || 'Your words had a subtle impact on those around you.';
  const parts = []; const vals = [];
  for (const [key, val] of Object.entries(effects)) { parts.push(`${key}=?`); vals.push(val); }
  parts.push('morale=?'); vals.push(clamp(p.morale + randInt(-3, 5), 10, 100));
  parts.push("updated_at=datetime('now')");
  vals.push(playerId);
  db.prepare(`UPDATE players SET ${parts.join(', ')} WHERE id=?`).run(...vals);
  db.prepare("INSERT INTO media_events (player_id,season_number,scenario_id,event_type,description,choice_made,narrative_result) VALUES (?,?,?,'interview',?,?,?)")
    .run(playerId, getLeagueState(playerId).current_season, scenarioId, pick(scenario.question, 'en'), pick(choice.text, 'en'), pick(NARRATIVES[choice.tone], 'en'));
  return { scenario: pick(scenario.question, lang), choice: pick(choice.text, lang), narrative, tone: choice.tone };
}

function getRandomMediaScenario(playerId) {
  const state = getLeagueState(playerId);
  const phase = state.current_phase;
  let candidates;
  if (phase === 'playoffs') candidates = MEDIA_SCENARIOS.filter(s => s.trigger === 'playoffs' || s.trigger === 'random');
  else if (phase === 'regular_season' && state.games_played_in_season > 40) candidates = MEDIA_SCENARIOS.filter(s => ['mid_season', 'random', 'after_loss', 'after_win'].includes(s.trigger));
  else candidates = MEDIA_SCENARIOS.filter(s => ['random', 'after_loss', 'after_win'].includes(s.trigger));
  if (candidates.length === 0) candidates = MEDIA_SCENARIOS.slice();

  // Context-aware gating: a bench player shouldn't get MVP/All-Star questions,
  // a non-rookie shouldn't hit the "rookie wall", etc.
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  const g = Math.max(1, p.s_games);
  const ppg = p.s_pts / g;
  const star = ppg + p.s_reb / g * 0.8 + p.s_ast / g * 0.8 + p.s_stl / g * 1.5 + p.s_blk / g * 1.5;
  const winPct = (p.s_wins + p.s_losses) > 0 ? p.s_wins / (p.s_wins + p.s_losses) : 0;
  const madeAllStar = db.prepare("SELECT id FROM career_progress WHERE player_id=? AND season_number=? AND event_type='allstar'").get(playerId, state.current_season);
  const contract = db.prepare('SELECT years FROM contracts WHERE player_id=? ORDER BY signed_at DESC, id DESC LIMIT 1').get(playerId);

  // all_star_snub: only a plausible snub — a near-All-Star line who didn't make it.
  if (madeAllStar || ppg < 18) candidates = candidates.filter(s => s.id !== 'all_star_snub');
  // mvp_campaign: only if genuinely in the conversation (elite production + winning).
  if (star < 28 || winPct < 0.5) candidates = candidates.filter(s => s.id !== 'mvp_campaign');
  // rookie_wall: only rookies, mid-season.
  if ((p.experience || 0) !== 0 || g < 30) candidates = candidates.filter(s => s.id !== 'rookie_wall');
  // load_management_q: only if the player is actually on load management.
  if (!p.load_management) candidates = candidates.filter(s => s.id !== 'load_management_q');
  // contract_talk: only in the final year of a contract.
  if (!contract || (contract.years ?? 0) !== 1) candidates = candidates.filter(s => s.id !== 'contract_talk');
  // disgruntled: only when morale is genuinely low.
  if ((p.morale ?? 75) >= 30) candidates = candidates.filter(s => s.id !== 'disgruntled');
  // retirement_question: only veterans.
  if ((p.age ?? 0) < 32) candidates = candidates.filter(s => s.id !== 'retirement_question');
  // finals_media: only in the NBA Finals (round 4).
  if (phase === 'playoffs' && state.playoff_round !== 4) candidates = candidates.filter(s => s.id !== 'finals_media');

  // Respect the actual last result so a win never triggers "Tough loss tonight".
  const last = db.prepare('SELECT result FROM game_logs WHERE player_id=? AND is_playoff=0 ORDER BY season_number DESC, game_number DESC LIMIT 1').get(playerId);
  if (last) {
    candidates = candidates.filter(s => !((last.result === 'W' && s.trigger === 'after_loss') || (last.result === 'L' && s.trigger === 'after_win')));
  }
  // If everything got gated out, fall back to the always-safe generic pool.
  if (candidates.length === 0) candidates = MEDIA_SCENARIOS.filter(s => ['random', 'after_loss', 'after_win'].includes(s.trigger));

  // Prefer scenarios the player hasn't answered yet this season.
  const answered = new Set(db.prepare('SELECT scenario_id FROM media_events WHERE player_id=? AND season_number=?').all(playerId, state.current_season).map(r => r.scenario_id).filter(Boolean));
  const fresh = candidates.filter(s => !answered.has(s.id));
  return { scenario: choice(fresh.length ? fresh : candidates) };
}

// ------------------------------------------------------------
// Off-court life system — relationships (family / partner / friends)
// ------------------------------------------------------------
// Life events are chain-style: an intro event creates a named person (a row in
// `relationships`), and choices can set `pending_event` to continue the chain.
// Each choice applies effects (like media) plus a bond delta, and optionally a
// new status or a "miss N games" consequence. `bond` is the growing 0-100 measure.
// Each life choice's "tone" nudges a hidden 4-axis values coordinate — family /
// career / money / fame. Accumulated silently, revealed at retirement as a
// "who you are" reflection. Tones not listed here contribute nothing.
const TONE_VALUES = {
  pursue: { family: 2 }, commit: { family: 2 }, propose: { family: 2 }, private: { family: 2 },
  family: { family: 3 }, close: { family: 1 }, coach: { family: 1 }, defend: { family: 1 },
  lend: { family: 1, money: -2 }, help: { family: 1, money: -1 },
  decline: { career: 2 }, career: { career: 3 }, end: { career: 1 }, delegate: { career: 2 },
  learn: { career: 1 }, dismiss: { career: 1 }, 'hands-off': { career: 1 }, practical: { career: 1, money: 1 },
  accept: { career: 1 },
  public: { fame: 2, money: 1 }, duel: { fame: 2 }, fuel: { fame: 1 },
  sign: { money: 1 }, trust: { money: 1 },
};

// Media tones feed the same hidden values axis — same coordinate as life choices.
const MEDIA_TONE_VALUES = {
  'team-first': { career: 2 }, leader: { career: 1, fame: 1 }, focused: { career: 1 }, humble: { career: 1 },
  accountable: { career: 1 }, diplomatic: { career: 1 },
  loyal: { family: 1 }, sincere: { family: 1 }, candid: { family: 1 },
  ambitious: { fame: 2 }, confident: { fame: 2 }, defiant: { fame: 1 }, proud: { fame: 1 },
};

// Add a delta to the player's hidden values axis (family/career/money/fame).
function addValues(playerId, delta) {
  const keys = ['family', 'career', 'money', 'fame'].filter(k => (delta[k] || 0) !== 0);
  if (!keys.length) return;
  const p = db.prepare('SELECT life_values FROM players WHERE id=?').get(playerId);
  const values = JSON.parse(p?.life_values || '{}');
  for (const k of keys) values[k] = (values[k] || 0) + delta[k];
  db.prepare("UPDATE players SET life_values=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify(values), playerId);
}

const LIFE_EVENTS = [
  // --- Love / partner chain ---
  { id: 'meet_partner', type: 'partner', intro: true, min_age: 22,
    names: ['Jordan', 'Riley', 'Sam', 'Taylor', 'Casey'],
    question: { en: "At a teammate's party you met someone who talked to you like a person, not a highlight reel. It's been on your mind since. What do you do?", zh: "在队友的聚会上，你遇到了一个把你当普通人而不是球星来聊天的人。之后你一直忘不掉。你打算怎么做？" },
    choices: [
      { text: { en: "Ask them out — see where it goes.", zh: "约对方出来——看看会怎样。" }, tone: 'pursue', effects: { morale: [2, 5] }, bond: 8, next: 'dating' },
      { text: { en: "Keep your head down — focus on basketball.", zh: "保持低调——专注篮球。" }, tone: 'decline', attr_effects: { work_ethic: [1, 2] }, decline: true },
    ] },
  { id: 'dating', type: 'partner',
    question: { en: "Things are going well, but the road schedule is hard on a new relationship. How do you handle it?", zh: "一切进展顺利，但漫长的客场赛程让这段新关系很吃力。你怎么处理？" },
    choices: [
      { text: { en: "Make time — this one matters.", zh: "挤出时间——这个人值得。" }, tone: 'commit', effects: { morale: [1, 3] }, bond: 10, next: 'proposal' },
      { text: { en: "Keep it casual for now.", zh: "先保持轻松，不急着定义。" }, tone: 'casual', effects: { morale: [0, 2] }, bond: 2 },
      { text: { en: "End it cleanly before it gets complicated.", zh: "在变得复杂之前，体面地结束。" }, tone: 'end', effects: { morale: [-4, -1] }, bond: -30, status: 'ended' },
    ] },
  { id: 'proposal', type: 'partner',
    question: { en: "You're ready to settle down. Do you propose?", zh: "你准备好安定了。要求婚吗？" },
    choices: [
      { text: { en: "Yes — get engaged.", zh: "求婚——订婚。" }, tone: 'propose', effects: { morale: [3, 6], fan_base: [1, 3] }, bond: 10, next: 'marriage' },
      { text: { en: "Not yet — a little more time.", zh: "再等等——多一点时间。" }, tone: 'wait', effects: { morale: [0, 1] }, bond: 2 },
    ] },
  { id: 'marriage', type: 'partner',
    question: { en: "The wedding is planned. A quiet ceremony, or a big media event?", zh: "婚礼已经排上了日程。办一场安静的仪式，还是公开的媒体盛宴？" },
    choices: [
      { text: { en: "Private ceremony — just family.", zh: "私密仪式——只有家人。" }, tone: 'private', effects: { morale: [2, 4] }, attr_effects: { composure: [1, 3] }, bond: 8, status: 'married', next: 'kids' },
      { text: { en: "Go public — a celebrity wedding.", zh: "公开办——一场名人婚礼。" }, tone: 'public', effects: { fan_base: [4, 8], clout: [1, 3], wealth: [-3, -1] }, bond: 4, status: 'married', next: 'kids' },
    ] },
  { id: 'kids', type: 'partner',
    question: { en: "Your partner brings up starting a family. How do you feel?", zh: "伴侣提起了组建家庭的事。你怎么想？" },
    choices: [
      { text: { en: "Let's do it — family is everything.", zh: "好，生——家庭比什么都重要。" }, tone: 'family', effects: { morale: [3, 6] }, attr_effects: { composure: [1, 3] }, bond: 10, next: 'kids_grow' },
      { text: { en: "Not yet — my window is now.", zh: "再等等——我的巅峰期就是现在。" }, tone: 'career', attr_effects: { work_ethic: [1, 2] }, bond: -4 },
    ] },
  { id: 'fame_pressure', type: 'partner', blocked_by: 'never',
    question: { en: "Your partner is struggling with the spotlight — the constant attention, the rumors, the strangers. It's wearing on them.", zh: "聚光灯让你的伴侣喘不过气——无休止的关注、流言、陌生人的目光。他/她越来越疲惫。" },
    choices: [
      { text: { en: "Step back from some of the fame.", zh: "为对方适当远离聚光灯。" }, tone: 'private', effects: { fan_base: [-3, -1], morale: [2, 4] }, bond: 12 },
      { text: { en: "Tell them to toughen up.", zh: "让他/她学着坚强一点。" }, tone: 'dismiss', effects: { morale: [-3, -1] }, bond: -8 },
      { text: { en: "Get them real help — a counselor.", zh: "认真帮对方——请个心理咨询师。" }, tone: 'practical', effects: { wealth: [-2, -1], morale: [1, 2] }, bond: 6 },
    ] },

  // --- Family chain ---
  { id: 'parent_illness', type: 'family', intro: true, min_age: 20, name: 'Mom',
    question: { en: "Your mom's test results came back, and the doctors want to keep her a few more days. There's a game in two days.", zh: "妈妈的检查结果出来了，医生想让她再住院观察几天。而你两天后有一场比赛。" },
    choices: [
      { text: { en: "Fly home to be there — miss two games.", zh: "飞回去陪她——缺席两场比赛。" }, tone: 'family', effects: { fan_base: [2, 5], morale: [-6, -2] }, attr_effects: { composure: [-2, -1] }, bond: 12, miss_games: 2, next: 'family_care' },
      { text: { en: "Stay with the team — she'll understand.", zh: "留在队里——她会理解的。" }, tone: 'career', effects: { morale: [-3, -1] }, attr_effects: { work_ethic: [1, 2] }, bond: -8, next: 'family_care' },
    ] },
  { id: 'family_care', type: 'family',
    question: { en: "Your mom is recovering slowly and keeps telling you not to worry. How do you handle it from afar?", zh: "妈妈恢复得很慢，却总叫你别担心。远在千里之外，你该怎么照顾她？" },
    choices: [
      { text: { en: "Check in daily, keep her close.", zh: "每天打电话，保持联系。" }, tone: 'close', effects: { morale: [1, 3] }, bond: 6 },
      { text: { en: "Hire a full-time caregiver and focus on the game.", zh: "雇一个全职护工，然后专注比赛。" }, tone: 'practical', effects: { wealth: [-2, -1] }, attr_effects: { work_ethic: [1, 2] }, bond: 2 },
    ] },
  { id: 'sibling_success', type: 'family', intro: true, min_experience: 4, name: 'Your Sibling',
    question: { en: "Your younger sibling just landed a big job on their own — no help from you. They're doing fine, and there's a quiet distance between you now.", zh: "你的弟弟/妹妹凭自己拿到了一份很好的工作，没靠你任何关系。他/她过得不错，但你们之间多了一层微妙的距离。" },
    choices: [
      { text: { en: "Reach out — bridge the gap.", zh: "主动联系——弥合这段距离。" }, tone: 'close', effects: { morale: [1, 3] }, bond: 10 },
      { text: { en: "Let them have their space.", zh: "给他/她空间，顺其自然。" }, tone: 'hands-off', effects: { morale: [0, 1] }, bond: 2 },
    ] },

  // --- Friend chain ---
  { id: 'childhood_friend', type: 'friend', intro: true, min_age: 20,
    names: ['Chris', 'Jay', 'Dre', 'Devon', 'Marcus'],
    question: { en: "The phone rings — it's the friend you grew up with, the one who knew you before any of this. He's in financial trouble and asking for a loan.", zh: "电话响了——是和你一起长大的朋友，那个在你成名之前就认识你的人。他遇到了经济困难，想找你借钱。" },
    choices: [
      { text: { en: "Lend them the money.", zh: "借钱给他。" }, tone: 'lend', effects: { wealth: [-3, -1] }, bond: 10, next: 'friend_trouble' },
      { text: { en: "Say no — you can't bail everyone out.", zh: "拒绝——你不可能帮所有人兜底。" }, tone: 'decline', effects: { morale: [-2, 0] }, decline: true },
    ] },
  { id: 'friend_trouble', type: 'friend',
    question: { en: "Your friend is back — this time asking for much more, and something feels off.", zh: "朋友又来了——这次要的更多，而且你感觉有些不对劲。" },
    choices: [
      { text: { en: "Cut them off. This is a pattern.", zh: "断绝往来。这已经是惯犯了。" }, tone: 'firm', effects: { clout: [0, 1] }, bond: -20, status: 'ended' },
      { text: { en: "Help once more, but draw the line.", zh: "再帮一次，但把话说清楚。" }, tone: 'help', effects: { wealth: [-5, -2], morale: [-2, 0] }, bond: 4 },
    ] },
  { id: 'friend_jealousy', type: 'friend',
    question: { en: "Your old friend has been distant lately — a little cold in texts, skipping your calls. Someone says he's jealous of everything you have now.", zh: "老朋友最近变得疏远——短信很冷淡，也总是错过你的电话。有人说，他是嫉妒你现在拥有的一切。" },
    choices: [
      { text: { en: "Confront it honestly.", zh: "坦诚地聊一聊。" }, tone: 'close', effects: { morale: [-2, 2] }, bond: 8 },
      { text: { en: "Give him time to come around.", zh: "给他时间，等他缓过来。" }, tone: 'calm', effects: { morale: [0, 1] }, bond: 2 },
      { text: { en: "Drift apart — you've outgrown this.", zh: "渐行渐远——你们已经不在一个世界了。" }, tone: 'hands-off', bond: -10, status: 'ended' },
    ] },

  // --- Mentor chain ---
  { id: 'meet_mentor', type: 'mentor', intro: true, min_experience: 1,
    names: ['Coach Rivers', 'Veteran Carter', 'Old Head Davis'],
    question: { en: "A grizzled veteran pulls you aside after practice and says you have 'it' — and wants to teach you the rest.", zh: "一位身经百战的老将训练后把你拉到一边，说你有'那种东西'——他想把剩下的都教给你。" },
    choices: [
      { text: { en: "Take the mentorship.", zh: "接受这份指导。" }, tone: 'accept', effects: { morale: [1, 3] }, bond: 8, next: 'mentor_wisdom' },
      { text: { en: "You've got this on your own.", zh: "你自己能行。" }, tone: 'decline', attr_effects: { work_ethic: [1, 2] }, decline: true },
    ] },
  { id: 'mentor_wisdom', type: 'mentor',
    question: { en: "Your mentor is teaching you the nuances — but he also wants you to carry the torch when he's gone.", zh: "导师在教你那些微妙之处——但他也希望，当他离开后，你能接过火炬。" },
    choices: [
      { text: { en: "Learn everything you can.", zh: "尽你所能地学。" }, tone: 'learn', attr_effects: { bbiq: [1, 2], leadership: [0, 1] }, bond: 8, next: 'mentor_retire' },
      { text: { en: "Just play — instincts beat lectures.", zh: "上场打球就行——直觉胜过说教。" }, tone: 'dismiss', effects: { morale: [-1, 1] }, bond: -4 },
    ] },
  { id: 'mentor_retire', type: 'mentor',
    question: { en: "Your mentor is retiring. He offers to publicly endorse you as the franchise's next leader.", zh: "导师要退役了。他提出要公开力挺你，成为球队的下一个领袖。" },
    choices: [
      { text: { en: "Accept his endorsement.", zh: "接受他的力挺。" }, tone: 'accept', effects: { clout: [1, 3], fan_base: [1, 3] }, attr_effects: { leadership: [1, 2] }, bond: 6 },
      { text: { en: "Politely decline — make your own name.", zh: "婉拒——你想靠自己打出名堂。" }, tone: 'decline', effects: { morale: [0, 1] }, bond: 2 },
    ] },

  // --- Agent chain ---
  { id: 'meet_agent', type: 'agent', intro: true, min_experience: 1,
    names: ['Rich Paul', 'Agent Lee', 'Tommy the Fixer'],
    question: { en: "A slick agent wants to represent you — he promises bigger contracts but takes a hefty cut.", zh: "一位精明的经纪人想代理你——他承诺更大的合同，但要抽成不菲。" },
    choices: [
      { text: { en: "Sign with him.", zh: "签下他。" }, tone: 'sign', effects: { clout: [0, 2] }, bond: 6, next: 'agent_push' },
      { text: { en: "Keep handling your own deals.", zh: "继续自己打理合同。" }, tone: 'decline', effects: { wealth: [0, 1] }, decline: true },
    ] },
  { id: 'agent_push', type: 'agent',
    question: { en: "Your agent is pushing a questionable endorsement and pressuring you to sign.", zh: "经纪人正在推一个来路不明的代言，还不断施压让你签字。" },
    choices: [
      { text: { en: "Trust him — he knows the market.", zh: "相信他——他懂市场。" }, tone: 'trust', effects: { wealth: [1, 4], fan_base: [-2, 0] }, bond: 4 },
      { text: { en: "Fire him and find someone honest.", zh: "炒了他，找一个诚实的人。" }, tone: 'fire', effects: { wealth: [-1, -2] }, bond: -15, status: 'ended' },
    ] },

  // --- Rival chain ---
  { id: 'meet_rival', type: 'rival', intro: true, min_experience: 0,
    names: ['The Next Big Thing', 'Your Draft-Mate', 'The Golden Boy'],
    question: { en: "A player from your draft class is being crowned the future of the league — and he's taken shots at you in interviews.", zh: "和你同届的一个新秀被捧成联盟的未来——而且他在采访里对你冷嘲热讽。" },
    choices: [
      { text: { en: "Make it personal.", zh: "把这事放在心上。" }, tone: 'fuel', effects: { morale: [1, 3] }, attr_effects: { work_ethic: [1, 2] }, bond: -5, next: 'rival_clash' },
      { text: { en: "Ignore the noise.", zh: "无视这些噪音。" }, tone: 'calm', attr_effects: { composure: [1, 2] }, bond: -5, next: 'rival_clash' },
    ] },
  { id: 'rival_clash', type: 'rival',
    question: { en: "You face your rival tonight. The whole league is watching.", zh: "今晚你对阵宿敌。整个联盟都在盯着。" },
    choices: [
      { text: { en: "Turn it into a duel — dominate him.", zh: "把它变成一场决斗——碾压他。" }, tone: 'duel', effects: { clout: [1, 4] }, attr_effects: { clutch_factor: [0, 1] }, bond: -6, next: 'rival_revenge' },
      { text: { en: "Treat it like any other game.", zh: "当成普通比赛来打。" }, tone: 'cool', attr_effects: { composure: [2, 3] }, bond: 2, set_flag: 'cooled_rival' },
    ] },
  { id: 'rival_revenge', type: 'rival', blocked_by: 'cooled_rival',
    question: { en: "Your rival is at it again — throwing shade and challenging you publicly. The rivalry has followed you.", zh: "宿敌又来了——公开挑衅你。这段恩怨一直缠着你。" },
    choices: [
      { text: { en: "Answer him on the court.", zh: "在球场上回应他。" }, tone: 'duel', effects: { clout: [1, 3] }, bond: -5 },
      { text: { en: "You're past this. Let it go.", zh: "你早就看开了。算了吧。" }, tone: 'cool', attr_effects: { composure: [1, 2] }, bond: 2, set_flag: 'cooled_rival' },
    ] },

  // --- Family depth ---
  { id: 'kids_grow', type: 'family',
    question: { en: "Your child is old enough to pick up a basketball — and they're obsessed with your game.", zh: "你的孩子已经大到能抱起篮球了——而且对你的比赛痴迷不已。" },
    choices: [
      { text: { en: "Coach them yourself.", zh: "亲自教他/她打球。" }, tone: 'coach', effects: { morale: [2, 4] }, attr_effects: { leadership: [0, 1] }, bond: 6 },
      { text: { en: "Hire a trainer — your career comes first.", zh: "请个训练师——你的职业生涯优先。" }, tone: 'delegate', effects: { wealth: [-1, -2] }, bond: 1 },
    ] },
  { id: 'sibling_ask', type: 'family', intro: true, min_experience: 2, name: 'Your Sibling',
    question: { en: "Your sibling wants you to help them break into the basketball business — as an agent or front-office intern.", zh: "你的兄弟姐妹想靠你进入篮球圈——当经纪人或球队管理层实习生。" },
    choices: [
      { text: { en: "Open doors for them.", zh: "帮他/她打开门路。" }, tone: 'help', effects: { clout: [-1, 0], morale: [1, 3] }, bond: 8, next: 'sibling_trouble' },
      { text: { en: "They need to earn it themselves.", zh: "他/她得靠自己争取。" }, tone: 'decline', effects: { morale: [-2, 0] }, decline: true },
    ] },
  { id: 'sibling_trouble', type: 'family',
    question: { en: "Your sibling's new role is causing locker-room whispers about nepotism.", zh: "你兄弟姐妹的新职位，让更衣室里传起了'任人唯亲'的闲话。" },
    choices: [
      { text: { en: "Publicly defend them.", zh: "公开维护他/她。" }, tone: 'defend', effects: { fan_base: [-3, 0], morale: [1, 2] }, bond: 5 },
      { text: { en: "Let them fight their own battle.", zh: "让他/她自己面对。" }, tone: 'hands-off', effects: { clout: [0, 1] }, bond: -3 },
    ] },

  // --- Mentor (you become the mentor) ---
  { id: 'mentor_protege', type: 'protege', intro: true, min_experience: 3, min_leadership: 70,
    names: ['Jalen', 'Marcus', 'The Kid', 'Devon'],
    question: { en: "A rookie keeps studying your game and asking for advice. The coaches think he could be special — if someone shows him the ropes.", zh: "一个新秀总在研究你的打法，不断向你请教。教练们觉得，只要有人带，他可能成气候。" },
    choices: [
      { text: { en: "Take him under your wing.", zh: "把他收在麾下，亲自带。" }, tone: 'accept', effects: { morale: [1, 3] }, attr_effects: { leadership: [1, 2] }, bond: 8, next: 'protege_growth' },
      { text: { en: "He needs to figure it out himself.", zh: "他得靠自己摸索。" }, tone: 'decline', attr_effects: { work_ethic: [1, 2] }, decline: true },
    ] },
  { id: 'protege_growth', type: 'protege',
    question: { en: "Your protege is turning heads around the league. How much do you invest in his rise?", zh: "你的徒弟在联盟里崭露头角。你愿意在他的成长上投入多少？" },
    choices: [
      { text: { en: "Give him everything I know.", zh: "倾囊相授。" }, tone: 'coach', effects: { morale: [2, 4] }, attr_effects: { leadership: [1, 2] }, bond: 12 },
      { text: { en: "Let him earn it, but be there when he needs me.", zh: "让他自己闯，但需要时我都在。" }, tone: 'close', effects: { morale: [0, 2] }, bond: 6 },
    ] },
];

// Relationship health → a small on-court composure/clutch/morale nudge. Read once
// per game (like effChem); healthy bonds steady the player, broken ones rattle them.
function lifeBondBuffs(playerId) {
  const rels = db.prepare("SELECT bond, status FROM relationships WHERE player_id=? AND status IN ('active','strained','married')").all(playerId);
  let composure = 0, clutch = 0, morale = 0;
  for (const r of rels) {
    let n = ((r.bond || 50) - 50) / 50; // -1..1
    if (r.status === 'strained') n -= 0.4;
    composure += n * 2.5;
    clutch += n * 1.5;
    morale += n * 3;
  }
  return { composure: round1(clamp(composure, -6, 6)), clutch: round1(clamp(clutch, -4, 4)), morale: round1(clamp(morale, -8, 8)) };
}

function getLifeOverview(playerId) {
  const p = db.prepare('SELECT age, experience, flags, leadership FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  const relationships = db.prepare('SELECT * FROM relationships WHERE player_id=? ORDER BY id').all(playerId);
  const seen = new Set(db.prepare('SELECT event_id FROM life_events WHERE player_id=? AND event_id IS NOT NULL').all(playerId).map(r => r.event_id));
  const flags = new Set(JSON.parse(p.flags || '[]'));
  const blocked = ev => ev && ev.blocked_by && flags.has(ev.blocked_by);

  const events = [];
  // Queued chain events — a relationship is waiting on its next step.
  for (const r of relationships) {
    if (r.pending_event && !seen.has(r.pending_event)) {
      const ev = LIFE_EVENTS.find(e => e.id === r.pending_event);
      if (ev && !blocked(ev)) events.push({ relationship_id: r.id, name: r.name, type: r.type, intro: false, event: ev });
    }
  }
  // One fresh intro event — a new person entering the story. A declined intro
  // cools down for a few seasons and can return (unless a relationship of that
  // type is already active).
  const season = getLeagueState(playerId).current_season;
  const intros = LIFE_EVENTS.filter(e => e.intro
    && (e.min_age == null || p.age >= e.min_age)
    && (e.min_experience == null || p.experience >= e.min_experience)
    && (e.min_leadership == null || (p.leadership ?? 0) >= e.min_leadership)
    && !blocked(e)
    && introAvailable(playerId, e, season));
  if (intros.length) {
    const ev = choice(intros);
    events.push({ relationship_id: null, name: null, type: ev.type, intro: true, event: ev });
  }

  return { relationships, events };
}

// An intro event can fire again if the player has no active relationship of that
// type and its last occurrence (e.g. a decline) was >= 3 seasons ago.
function introAvailable(playerId, ev, season) {
  const existing = db.prepare("SELECT id FROM relationships WHERE player_id=? AND type=? AND status IN ('active','strained','married') LIMIT 1").get(playerId, ev.type);
  if (existing) return false;
  const last = db.prepare('SELECT season_number FROM life_events WHERE player_id=? AND event_id=? ORDER BY id DESC LIMIT 1').get(playerId, ev.id);
  return !last || (season - (last.season_number || 0)) >= 3;
}

// Whether a relationship chain is waiting on the player's next choice — a
// "stuck" life event that should pause the simulation. Fresh intros are handled
// separately (soft ticker marker, not a hard pause).
function hasPendingLifeEvent(playerId) {
  const seen = new Set(db.prepare('SELECT event_id FROM life_events WHERE player_id=? AND event_id IS NOT NULL').all(playerId).map(r => r.event_id));
  const flags = new Set(JSON.parse(db.prepare('SELECT flags FROM players WHERE id=?').get(playerId)?.flags || '[]'));
  const rels = db.prepare('SELECT pending_event FROM relationships WHERE player_id=?').all(playerId);
  return rels.some(r => {
    if (!r.pending_event || seen.has(r.pending_event)) return false;
    const ev = LIFE_EVENTS.find(e => e.id === r.pending_event);
    return ev && !(ev.blocked_by && flags.has(ev.blocked_by));
  });
}

// A fresh intro (a new person entering the story) is available — surfaced as a
// soft ticker marker, not a hard pause.
function hasIntroLifeEvent(playerId) {
  const p = db.prepare('SELECT age, experience, flags, leadership FROM players WHERE id=?').get(playerId);
  if (!p) return false;
  const season = getLeagueState(playerId).current_season;
  const flags = new Set(JSON.parse(p.flags || '[]'));
  const blocked = ev => ev && ev.blocked_by && flags.has(ev.blocked_by);
  return LIFE_EVENTS.some(e => e.intro
    && (e.min_age == null || p.age >= e.min_age)
    && (e.min_experience == null || p.experience >= e.min_experience)
    && (e.min_leadership == null || (p.leadership ?? 0) >= e.min_leadership)
    && !blocked(e)
    && introAvailable(playerId, e, season));
}

function resolveLifeEvent(playerId, eventId, choiceIndex, relationshipId = null) {
  const ev = LIFE_EVENTS.find(e => e.id === eventId);
  if (!ev || choiceIndex < 0 || choiceIndex >= ev.choices.length) throw httpError(400, 'Invalid life event or choice');
  const ch = ev.choices[choiceIndex];
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  const season = getLeagueState(playerId).current_season;

  let rel = relationshipId != null
    ? db.prepare('SELECT * FROM relationships WHERE id=? AND player_id=?').get(relationshipId, playerId)
    : null;

  if (ev.intro) {
    if (!ch.decline) {
      const name = ev.names ? choice(ev.names) : ev.name;
      const ins = db.prepare('INSERT INTO relationships (player_id,name,type,bond,status) VALUES (?,?,?,?,?)')
        .run(playerId, name, ev.type, 50, 'active');
      rel = db.prepare('SELECT * FROM relationships WHERE id=?').get(Number(ins.lastInsertRowid));
    }
  } else if (!rel) {
    throw httpError(400, 'This event needs an existing relationship.');
  }

  // Gauge effects (fan_base/clout/chemistry/morale) + wealth (money).
  const effects = {};
  const eff = ch.effects || {};
  for (const key of ['fan_base', 'clout', 'chemistry', 'morale']) {
    if (key in eff) {
      const def = key === 'morale' ? 75 : key === 'fan_base' ? 5 : 50;
      effects[key] = clamp((p[key] ?? def) + randInt(eff[key][0], eff[key][1]), 0, 100);
    }
  }
  if ('wealth' in eff) effects.wealth = Math.max(0, round2((p.wealth || 0) + randInt(eff.wealth[0], eff.wealth[1])));
  // Attribute effects (composure, work_ethic, …).
  for (const [k, range] of Object.entries(ch.attr_effects || {})) {
    effects[k] = clamp((p[k] ?? 50) + randInt(range[0], range[1]), 10, 99);
  }
  // Missing games (e.g., a family emergency) — reuse the injury slots so the
  // player actually sits out, without showing the treatment card.
  if (ch.miss_games) {
    effects.injury_status = 'Personal matter';
    effects.injury_games_remaining = ch.miss_games;
    effects.injury_treatment = 'rest';
  }

  if (Object.keys(effects).length) {
    const parts = []; const vals = [];
    for (const [k, v] of Object.entries(effects)) { parts.push(`${k}=?`); vals.push(v); }
    parts.push("updated_at=datetime('now')"); vals.push(playerId);
    db.prepare(`UPDATE players SET ${parts.join(', ')} WHERE id=?`).run(...vals);
  }

  // Hidden 4-axis values (family/career/money/fame) accumulate silently from the
  // choice's tone — they shape the retirement reflection, not any visible stat.
  addValues(playerId, TONE_VALUES[ch.tone] || MEDIA_TONE_VALUES[ch.tone] || {});
  // Flags: some choices change the story going forward (e.g., a cooled-down
  // rivalry skips future rival events).
  if (ch.set_flag) {
    const flags = new Set(JSON.parse(p.flags || '[]'));
    flags.add(ch.set_flag);
    db.prepare("UPDATE players SET flags=?, updated_at=datetime('now') WHERE id=?").run(JSON.stringify([...flags]), playerId);
  }

  let newBond = null, newStatus = null, nextEvent = null;
  if (rel) {
    newBond = clamp((rel.bond || 50) + (ch.bond || 0), 0, 100);
    newStatus = ch.status || rel.status;
    const pending = ch.next || null;
    db.prepare('UPDATE relationships SET bond=?, status=?, pending_event=? WHERE id=?').run(newBond, newStatus, pending, rel.id);
    if (pending) nextEvent = LIFE_EVENTS.find(e => e.id === pending);
  }

  db.prepare('INSERT INTO life_events (player_id,season_number,event_id,relationship_id,description,choice_made) VALUES (?,?,?,?,?,?)')
    .run(playerId, season, ev.id, rel ? rel.id : null, pick(ev.question, 'en'), pick(ch.text, 'en'));

  const lang = getLeagueState(playerId).lang || 'en';
  return {
    event: pick(ev.question, lang), choice: pick(ch.text, lang),
    relationship: rel ? { id: rel.id, name: rel.name, type: rel.type, bond: newBond, status: newStatus } : null,
    effects,
    next_event: nextEvent ? nextEvent.id : null,
  };
}

// ------------------------------------------------------------
// Clout actions
// ------------------------------------------------------------
function requestTrade(playerId, desiredTeamId) {
  if (!TEAMS[desiredTeamId]) throw httpError(400, `Unknown team id: ${desiredTeamId}`);
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  const state = getLeagueState(playerId);
  if (state.current_phase === 'playoffs') throw httpError(400, 'Trades are not allowed during the playoffs.');
  if (p.clout < 25) return { success: false, message: "You don't have enough influence yet. Build your reputation first." };
  const chem = teamChemistry(playerId);
  const success = Math.random() < Math.min(0.9, p.clout / 120.0 + Math.max(0, 50 - chem) / 150);
  if (success) {
    // Move the player, sync their contract, and inherit the new team's actual
    // record (from team_records) instead of resetting to 0-0 — otherwise a late
    // trade makes the playoffs unreachable and shows a bogus 0-0 in the standings.
    const season = getLeagueState(playerId).current_season;
    const rec = db.prepare('SELECT wins, losses FROM team_records WHERE player_id=? AND team_id=? AND season_number=?').get(playerId, desiredTeamId, season);
    db.prepare('UPDATE players SET team_id=?,clout=MAX(0,clout-12),chemistry=50,s_wins=?,s_losses=? WHERE id=?').run(desiredTeamId, rec?.wins || 0, rec?.losses || 0, playerId);
    const contract = db.prepare('SELECT id FROM contracts WHERE player_id=? ORDER BY signed_at DESC, id DESC LIMIT 1').get(playerId);
    if (contract) db.prepare('UPDATE contracts SET team_id=? WHERE id=?').run(desiredTeamId, contract.id);
    db.prepare("INSERT INTO career_progress (player_id,season_number,event_type,description) VALUES (?,?,'trade',?)")
      .run(playerId, season, `Forced trade to ${TEAMS[desiredTeamId].name}`);
    syncTeammates(playerId, true);
    return { success: true, new_team: TEAMS[desiredTeamId].name, message: "The trade demand worked. You've been moved — a fresh start awaits." };
  }
  db.prepare('UPDATE players SET clout=MAX(0,clout-6),chemistry=MAX(10,chemistry-12),morale=MAX(10,morale-8) WHERE id=?').run(playerId);
  return { success: false, message: 'Management refused your request. The fallout has hurt team chemistry.' };
}

// ------------------------------------------------------------
// Career overview
// ------------------------------------------------------------
// Turn the hidden values axis into a "who you were" sentence for the career page.
function valuesReflection(valuesJson) {
  const v = JSON.parse(valuesJson || '{}');
  const labels = { family: 'family', career: 'the game', money: 'wealth', fame: 'the spotlight' };
  const entries = [['family', v.family || 0], ['career', v.career || 0], ['money', v.money || 0], ['fame', v.fame || 0]]
    .sort((a, b) => b[1] - a[1]);
  const [top, second] = entries;
  if (top[1] <= 0) return 'You drifted through your career without leaning hard into any one thing.';
  const topLabel = labels[top[0]];
  if (second[1] <= 0) return `Above all, you were defined by ${topLabel}.`;
  return `Above all, you were defined by ${topLabel} — and, close behind, ${labels[second[0]]}.`;
}

function getCareerOverview(playerId) {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  const seasons = db.prepare('SELECT * FROM season_summaries WHERE player_id=? ORDER BY season_number').all(playerId);
  const awards = db.prepare('SELECT * FROM awards WHERE player_id=? ORDER BY season_number DESC').all(playerId);
  const cg = seasons.reduce((s, x) => s + x.games_played, 0);
  const cp = seasons.reduce((s, x) => s + x.ppg * x.games_played, 0);
  const cr = seasons.reduce((s, x) => s + x.rpg * x.games_played, 0);
  const ca = seasons.reduce((s, x) => s + x.apg * x.games_played, 0);
  const cst = seasons.reduce((s, x) => s + x.spg * x.games_played, 0);
  const cbl = seasons.reduce((s, x) => s + x.bpg * x.games_played, 0);
  const cto = seasons.reduce((s, x) => s + x.topg * x.games_played, 0);
  const cmin = seasons.reduce((s, x) => s + x.mpg * x.games_played, 0);

  // Shooting splits come from game logs (season summaries only store percentages).
  const shoot = db.prepare('SELECT SUM(fgm) fgm, SUM(fga) fga, SUM(tpm) tpm, SUM(tpa) tpa, SUM(ftm) ftm, SUM(fta) fta FROM game_logs WHERE player_id=?').get(playerId);
  const cFg = shoot.fga ? round3(shoot.fgm / shoot.fga) : 0;
  const cTp = shoot.tpa ? round3(shoot.tpm / shoot.tpa) : 0;
  const cFt = shoot.fta ? round3(shoot.ftm / shoot.fta) : 0;

  // Playoff aggregates from season summaries.
  const pg = seasons.reduce((s, x) => s + (x.p_games || 0), 0);
  const ppt = seasons.reduce((s, x) => s + (x.p_ppg || 0) * (x.p_games || 0), 0);
  const prb = seasons.reduce((s, x) => s + (x.p_rpg || 0) * (x.p_games || 0), 0);
  const pas = seasons.reduce((s, x) => s + (x.p_apg || 0) * (x.p_games || 0), 0);
  const pst = seasons.reduce((s, x) => s + (x.p_spg || 0) * (x.p_games || 0), 0);
  const pbl = seasons.reduce((s, x) => s + (x.p_bpg || 0) * (x.p_games || 0), 0);
  const pto = seasons.reduce((s, x) => s + (x.p_topg || 0) * (x.p_games || 0), 0);
  const pmin = seasons.reduce((s, x) => s + (x.p_mpg || 0) * (x.p_games || 0), 0);

  const highs = db.prepare('SELECT MAX(pts) pts, MAX(reb) reb, MAX(ast) ast, MAX(stl) stl, MAX(blk) blk FROM game_logs WHERE player_id=?').get(playerId);
  const chips = awards.filter(a => a.award_name === 'NBA Champion').length;
  const mvps = awards.filter(a => a.award_name === 'MVP').length;
  const allNba = awards.filter(a => a.award_name.includes('All-NBA')).length;
  const goat = chips * 25 + mvps * 20 + allNba * 8 + (cp / 1000) * 3 + (cr / 500) * 1 + (ca / 500) * 2;
  const goatPct = Math.min(100, (goat + (p.goat_bonus || 0)) / 6.5);
  const pgAvg = g => (g > 0 ? round1(g / pg) : 0);
  return {
    player: { name: p.name, position: p.position, age: p.age, height: p.height, weight: p.weight, team: (TEAMS[p.team_id] || {}).name || 'FA', experience: p.experience, clout: p.clout, fan_base: p.fan_base, wealth: round2(p.wealth), morale: p.morale },
    career_totals: { games: cg, pts: Math.round(cp), reb: Math.round(cr), ast: Math.round(ca), stl: Math.round(cst), blk: Math.round(cbl), tov: Math.round(cto) },
    career_averages: { ppg: cg ? round1(cp / cg) : 0, rpg: cg ? round1(cr / cg) : 0, apg: cg ? round1(ca / cg) : 0, spg: cg ? round1(cst / cg) : 0, bpg: cg ? round1(cbl / cg) : 0, topg: cg ? round1(cto / cg) : 0, mpg: cg ? round1(cmin / cg) : 0, fg_pct: cFg, tp_pct: cTp, ft_pct: cFt },
    playoff_totals: { games: pg, pts: Math.round(ppt), reb: Math.round(prb), ast: Math.round(pas), stl: Math.round(pst), blk: Math.round(pbl), tov: Math.round(pto) },
    playoff_averages: { ppg: pgAvg(ppt), rpg: pgAvg(prb), apg: pgAvg(pas), spg: pgAvg(pst), bpg: pgAvg(pbl), topg: pgAvg(pto), mpg: pgAvg(pmin) },
    career_highs: { pts: highs?.pts || 0, reb: highs?.reb || 0, ast: highs?.ast || 0, stl: highs?.stl || 0, blk: highs?.blk || 0 },
    goat_score: round1(goatPct), championships: chips, mvps, all_nba: allNba, seasons, awards,
    values: JSON.parse(p.life_values || '{}'), values_reflection: valuesReflection(p.life_values),
  };
}

// ------------------------------------------------------------
// Save / load
// ------------------------------------------------------------
// Tables that are player-scoped and must be rolled back together on load, so a
// loaded save never leaves S2/S3 data mixed in with a rolled-back S1 player.
// team_records is league-wide but is snapshotted/restored too so standings match.
const SNAPSHOT_TABLES = ['game_logs', 'season_summaries', 'contracts', 'contract_offers', 'endorsements', 'investments', 'media_events', 'career_progress', 'awards', 'relationships', 'life_events', 'ai_players', 'teammates', 'shoes'];

function snapshotPlayerTables(playerId) {
  const snap = {};
  for (const t of SNAPSHOT_TABLES) snap[t] = db.prepare(`SELECT * FROM ${t} WHERE player_id=?`).all(playerId);
  snap.team_records = db.prepare('SELECT * FROM team_records WHERE player_id=?').all(playerId);
  return snap;
}

function restorePlayerTables(playerId, snap) {
  for (const t of SNAPSHOT_TABLES) {
    db.prepare(`DELETE FROM ${t} WHERE player_id=?`).run(playerId);
    const rows = snap[t] || [];
    if (rows.length) {
      const cols = Object.keys(rows[0]);
      const stmt = db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) stmt.run(...cols.map(c => r[c]));
    }
  }
  db.prepare('DELETE FROM team_records WHERE player_id=?').run(playerId);
  const tr = snap.team_records || [];
  if (tr.length) {
    const cols = Object.keys(tr[0]);
    const hasPid = cols.includes('player_id');
    const insertCols = hasPid ? cols : ['player_id', ...cols];
    const stmt = db.prepare(`INSERT INTO team_records (${insertCols.join(',')}) VALUES (${insertCols.map(() => '?').join(',')})`);
    for (const r of tr) stmt.run(...insertCols.map(c => (c === 'player_id' ? playerId : r[c])));
  }
}

function saveGame(playerId, saveName, description = '') {
  const state = getLeagueState(playerId);
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(playerId);
  if (!p) throw httpError(404, 'Player not found');
  const snapshot = JSON.stringify({ player: p, league: state, tables: snapshotPlayerTables(playerId) });
  const ex = db.prepare('SELECT id FROM save_files WHERE player_id=? AND save_name=?').get(playerId, saveName);
  let sid;
  if (ex) { sid = ex.id; db.prepare("UPDATE save_files SET season_number=?,description=?,snapshot=?,created_at=datetime('now') WHERE id=?").run(state.current_season, description, snapshot, sid); }
  else { sid = crypto.randomBytes(4).toString('hex'); db.prepare('INSERT INTO save_files (id,player_id,save_name,season_number,description,snapshot) VALUES (?,?,?,?,?,?)').run(sid, playerId, saveName, state.current_season, description, snapshot); }
  return { save_id: sid, save_name: saveName, season: state.current_season };
}

function loadGame(playerId, saveId) {
  const row = db.prepare('SELECT * FROM save_files WHERE id=? AND player_id=?').get(saveId, playerId);
  if (!row) throw httpError(404, 'Save not found');
  const snap = JSON.parse(row.snapshot);
  const p = snap.player, lg = snap.league;
  db.exec('BEGIN');
  try {
    const cols = Object.keys(p).filter(c => c !== 'id');
    const setClause = cols.map(c => `${c}=?`).join(', ') + ", updated_at=datetime('now')";
    const vals = cols.map(c => p[c]).concat([playerId]);
    db.prepare(`UPDATE players SET ${setClause} WHERE id=?`).run(...vals);
    db.prepare(`INSERT INTO league_state (player_id,current_season,current_phase,games_played_in_season,playoff_round,series_wins,series_losses,playoff_opponent,player_seed,opponent_seed)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(player_id) DO UPDATE SET current_season=excluded.current_season, current_phase=excluded.current_phase, games_played_in_season=excluded.games_played_in_season, playoff_round=excluded.playoff_round, series_wins=excluded.series_wins, series_losses=excluded.series_losses, playoff_opponent=excluded.playoff_opponent, player_seed=excluded.player_seed, opponent_seed=excluded.opponent_seed`)
      .run(playerId, lg.current_season, lg.current_phase, lg.games_played_in_season, lg.playoff_round ?? 0, lg.series_wins ?? 0, lg.series_losses ?? 0, lg.playoff_opponent ?? 0, lg.player_seed ?? 0, lg.opponent_seed ?? 0);
    restorePlayerTables(playerId, snap.tables || {});
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { loaded: true, save_id: saveId, season: lg.current_season, phase: lg.current_phase };
}

function listSaves(playerId) {
  return db.prepare('SELECT id,save_name,season_number,description,created_at FROM save_files WHERE player_id=? ORDER BY created_at DESC').all(playerId);
}

function listAllSaves() {
  return db.prepare(`SELECT s.id, s.save_name, s.season_number, s.description, s.created_at, s.player_id,
                    p.name AS player_name, p.position AS player_position
                    FROM save_files s JOIN players p ON p.id = s.player_id
                    ORDER BY s.created_at DESC`).all();
}

function deleteSave(saveId, playerId = null) {
  const where = playerId ? 'id=? AND player_id=?' : 'id=?';
  const params = playerId ? [saveId, playerId] : [saveId];
  const info = db.prepare(`DELETE FROM save_files WHERE ${where}`).run(...params);
  if (info.changes === 0) throw httpError(404, 'Save not found');
  return { deleted: true, save_id: saveId };
}

function loadGameById(saveId) {
  const row = db.prepare('SELECT * FROM save_files WHERE id=?').get(saveId);
  if (!row) throw httpError(404, 'Save not found');
  const result = loadGame(row.player_id, saveId);
  result.player_id = row.player_id;
  result.player_name = row.save_name;
  return result;
}

function exportCareerJson(playerId) {
  const career = getCareerOverview(playerId);
  const games = db.prepare('SELECT * FROM game_logs WHERE player_id=? ORDER BY season_number,game_number').all(playerId);
  const media = db.prepare('SELECT * FROM media_events WHERE player_id=? ORDER BY created_at DESC LIMIT 50').all(playerId);
  career.game_logs = games;
  career.media_events = media;
  return career;
}

// ------------------------------------------------------------
// Helpers for API layer
// ------------------------------------------------------------
function sanitizePlayer(p) {
  const skip = new Set(['s_pts', 's_reb', 's_ast', 's_stl', 's_blk', 's_tov', 's_fga', 's_fgm', 's_3pa', 's_3pm', 's_fta', 's_ftm', 's_games', 's_min', 's_pf', 's_wins', 's_losses']);
  const r = {};
  for (const [k, v] of Object.entries(p)) {
    if (skip.has(k)) continue;
    r[k] = (typeof v === 'number' && !Number.isInteger(v)) ? round2(v) : v;
  }
  r.team_name = (TEAMS[p.team_id] || {}).name || 'Free Agent';
  r.team_abbr = (TEAMS[p.team_id] || {}).abbr || 'FA';
  r.overall = calculateOverallRating(p);
  r.tier = playerTier(r.overall);
  r.team_tier = teamTier(TEAMS[p.team_id] ? TEAMS[p.team_id].ovr : 0);
  const c = db.prepare('SELECT annual_salary, years, team_id, contract_type FROM contracts WHERE player_id=? ORDER BY signed_at DESC, id DESC LIMIT 1').get(p.id);
  r.contract = c ? { annual_salary: c.annual_salary, years: c.years, team: (TEAMS[c.team_id] || {}).name || 'Free Agent', contract_type: c.contract_type } : null;
  r.free_agent = !c || (c.years ?? 0) <= 0;
  return r;
}

// ------------------------------------------------------------
// Express app + routes
// ------------------------------------------------------------
const app = express();
app.use(express.json());

function wrap(fn) {
  return (req, res) => {
    try {
      const result = fn(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (e) {
      if (e instanceof HttpError) return res.status(e.status).json({ detail: e.message });
      console.error(e);
      res.status(500).json({ detail: 'Internal server error' });
    }
  };
}

// Player
app.post('/api/player/create', wrap((req) => {
  const { name, position, age = 19, height, weight, allocations, luck_bonus, background, nationality = 'USA' } = req.body || {};
  if (!POSITION_PROFILES[position]) throw httpError(400, 'Invalid position');
  if (!(age >= 19 && age <= 23)) throw httpError(400, `Age must be 19-23, got ${age}`);
  const profile = POSITION_PROFILES[position];
  if (!(height >= profile.height_range[0] - 0.03 && height <= profile.height_range[1] + 0.03)) throw httpError(400, `Height ${height}m outside range for ${position}`);
  if (!(weight >= profile.weight_range[0] - 5 && weight <= profile.weight_range[1] + 5)) throw httpError(400, `Weight ${weight}kg outside range for ${position}`);
  const poolInfo = calculatePointPool(position, height, weight, luck_bonus ?? null);
  const totalAllocated = Object.values(allocations || {}).reduce((a, b) => a + b, 0);
  if (totalAllocated !== poolInfo.total_points) throw httpError(400, `Allocation total ${totalAllocated} does not match point pool ${poolInfo.total_points}`);
  const pid = createPlayerWithPoints(name, position, age, height, weight, allocations, luck_bonus ?? null, background, nationality);
  const player = db.prepare('SELECT * FROM players WHERE id=?').get(pid);
  return { player_id: pid, player: sanitizePlayer(player), pool_info: poolInfo };
}));

app.get('/api/player/backgrounds', wrap(() => ({ backgrounds: BACKGROUNDS })));

app.get('/api/player/:id', wrap((req) => {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
  if (!p) throw httpError(404, 'Not found');
  return { player: sanitizePlayer(p) };
}));

app.get('/api/players/all', wrap(() => {
  const rows = db.prepare('SELECT id, name, position, team_id, age, experience, draft_pick FROM players ORDER BY updated_at DESC').all();
  return { players: rows.map(p => ({ ...p, team: (TEAMS[p.team_id] || {}).name || 'FA' })) };
}));

app.delete('/api/player/:id', wrap((req) => {
  const pid = req.params.id;
  const p = db.prepare('SELECT id FROM players WHERE id=?').get(pid);
  if (!p) throw httpError(404, 'Player not found');
  for (const t of SNAPSHOT_TABLES) db.prepare(`DELETE FROM ${t} WHERE player_id=?`).run(pid);
  db.prepare('DELETE FROM endorsement_offers WHERE player_id=?').run(pid);
  db.prepare('DELETE FROM save_files WHERE player_id=?').run(pid);
  db.prepare('DELETE FROM players WHERE id=?').run(pid);
  return { deleted: true, player_id: pid };
}));

app.get('/api/player/:id/attributes', wrap((req) => {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
  return {
    static: { height: p.height, weight: p.weight, wingspan: p.wingspan, standing_reach: p.standing_reach, hand_size: p.hand_size, frame_build: p.frame_build, body_fat_pct: p.body_fat_pct },
    athleticism: { vertical_jump: p.vertical_jump, speed: p.speed, lateral_quickness: p.lateral_quickness, strength: p.strength, core_stability: p.core_stability, stamina: p.stamina, durability: p.durability },
    defense: { perimeter_defense: p.perimeter_defense, help_defense: p.help_defense, steal: p.steal, rim_protection: p.rim_protection, box_out: p.box_out },
    rebounding: { rebounding: p.rebounding },
    scoring: { first_step: p.first_step, finishing: p.finishing, mid_range: p.mid_range, catch_shoot_3pt: p.catch_shoot_3pt, pull_up_3pt: p.pull_up_3pt, off_ball: p.off_ball, drawing_fouls: p.drawing_fouls, free_throw: p.free_throw },
    playmaking: { ball_security: p.ball_security, pnr_vision: p.pnr_vision, passing_accuracy: p.passing_accuracy },
    mental: { bbiq: p.bbiq, clutch_factor: p.clutch_factor, work_ethic: p.work_ethic, leadership: p.leadership, composure: p.composure },
  };
}));

app.get('/api/player/:id/season-stats', wrap((req) => {
  const p = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
  const g = Math.max(1, p.s_games), m = Math.max(1, p.s_min);
  const pg = Math.max(1, p.p_games), pm = Math.max(1, p.p_min);
  const per36 = tot => round1(tot * 36 / m);
  const fga = p.s_fga, three = p.s_3pa, mid = p.s_fga_mid ?? 0;
  const paint = Math.max(0, fga - three - mid);
  const shotPct = v => fga > 0 ? Math.round(v / fga * 100) : 0;
  return {
    games: p.s_games, mpg: round1(m / g), ppg: round1(p.s_pts / g), rpg: round1(p.s_reb / g), apg: round1(p.s_ast / g), spg: round1(p.s_stl / g), bpg: round1(p.s_blk / g), topg: round1(p.s_tov / g),
    fg_pct: round3(p.s_fgm / Math.max(1, p.s_fga)), tp_pct: round3(p.s_3pm / Math.max(1, p.s_3pa)), ft_pct: round3(p.s_ftm / Math.max(1, p.s_fta)),
    per36: { ppg: per36(p.s_pts), rpg: per36(p.s_reb), apg: per36(p.s_ast), spg: per36(p.s_stl), bpg: per36(p.s_blk), topg: per36(p.s_tov) },
    shot_profile: { paint, mid, three, paint_pct: shotPct(paint), mid_pct: shotPct(mid), three_pct: shotPct(three) },
    team_wins: p.s_wins, team_losses: p.s_losses,
    playoffs: { games: p.p_games, mpg: round1(pm / pg), ppg: round1(p.p_pts / pg), rpg: round1(p.p_reb / pg), apg: round1(p.p_ast / pg), spg: round1(p.p_stl / pg), bpg: round1(p.p_blk / pg), topg: round1(p.p_tov / pg), fg_pct: round3(p.p_fgm / Math.max(1, p.p_fga)), tp_pct: round3(p.p_3pm / Math.max(1, p.p_3pa)), ft_pct: round3(p.p_ftm / Math.max(1, p.p_fta)), team_wins: p.p_wins, team_losses: p.p_losses },
  };
}));

app.get('/api/player/:id/records', wrap((req) => careerRecords(req.params.id)));

app.put('/api/player/:id/tactics', wrap((req) => {
  const validDef = ['balanced', 'lockdown_star', 'protect_paint', 'switch_everything'];
  const validOff = ['balanced', 'push_pace', 'grind_halfcourt', 'three_heavy'];
  const defense = req.query.defense || 'balanced';
  const offense = req.query.offense || 'balanced';
  if (!validDef.includes(defense)) throw httpError(400, `Invalid defense. Options: ${validDef}`);
  if (!validOff.includes(offense)) throw httpError(400, `Invalid offense. Options: ${validOff}`);
  // Constantly changing the system grates on the coaching staff and locker room.
  const cur = db.prepare('SELECT tactics_defense, tactics_offense FROM players WHERE id=?').get(req.params.id);
  if (cur && (cur.tactics_defense !== defense || cur.tactics_offense !== offense)) {
    db.prepare('UPDATE players SET morale=MAX(10,morale-2) WHERE id=?').run(req.params.id);
  }
  db.prepare("UPDATE players SET tactics_defense=?, tactics_offense=?, updated_at=datetime('now') WHERE id=?").run(defense, offense, req.params.id);
  return { tactics_defense: defense, tactics_offense: offense };
}));

app.put('/api/player/:id/role', wrap((req) => {
  const valid = ['Ball-Dominant Creator', 'Off-Ball Finisher', 'Rim Protector', 'Two-Way Wing', '3-and-D Specialist', 'Point Forward', 'Stretch Big', 'Defensive Anchor'];
  const role = req.query.role;
  if (!valid.includes(role)) throw httpError(400, `Invalid role. Options: ${valid}`);
  const p = db.prepare('SELECT role FROM players WHERE id=?').get(req.params.id);
  // Changing role rubs the locker room the wrong way — a small bond cost (routed
  // through teammate bonds, not a direct chemistry write).
  if (p && p.role !== role) {
    db.prepare("UPDATE players SET role=?,updated_at=datetime('now') WHERE id=?").run(role, req.params.id);
    nudgeBonds(req.params.id, -2);
    return { role, chemistry_cost: 2 };
  }
  db.prepare("UPDATE players SET role=?,updated_at=datetime('now') WHERE id=?").run(role, req.params.id);
  return { role };
}));

app.put('/api/player/:id/load-management', wrap((req) => {
  const enabled = req.query.enabled === 'true' ? 1 : 0;
  const p = db.prepare('SELECT load_management, fan_base FROM players WHERE id=?').get(req.params.id);
  // Turning load management on grumbles the fans (they paid to see a star).
  if (p && p.load_management !== enabled && enabled) {
    db.prepare("UPDATE players SET load_management=?, fan_base=MAX(0,fan_base-2), updated_at=datetime('now') WHERE id=?").run(enabled, req.params.id);
    return { load_management: true, fan_cost: 2 };
  }
  db.prepare("UPDATE players SET load_management=?,updated_at=datetime('now') WHERE id=?").run(enabled, req.params.id);
  return { load_management: enabled === 1 };
}));
app.post('/api/player/:id/injury-treatment', wrap((req) => applyInjuryTreatment(req.params.id, req.query.option)));
app.post('/api/player/:id/retire', wrap((req) => resolveRetirement(req.params.id, req.query.choice)));
app.get('/api/season/allstar-weekend-options/:id', wrap(() => ({ dunks: DUNK_ACTIONS, spots: THREE_SPOTS })));
app.post('/api/season/allstar-weekend/:id', wrap((req) => resolveAllStarWeekend(req.params.id, req.query.choice, req.query.action)));
app.get('/api/player/:id/second-life', wrap((req) => ({ options: getSecondLifeOptions(req.params.id), chosen: db.prepare('SELECT second_life, legacy_score FROM players WHERE id=?').get(req.params.id) })));
app.post('/api/player/:id/second-life', wrap((req) => chooseSecondLife(req.params.id, req.query.path)));
app.post('/api/player/:id/second-life-advance', wrap((req) => advanceSecondLife(req.params.id)));

// Development focus — the player picks one attribute to accelerate mid-season.
app.get('/api/player/:id/focus', wrap((req) => {
  const p = db.prepare('SELECT dev_focus FROM players WHERE id=?').get(req.params.id);
  return { dev_focus: p?.dev_focus || null, options: DEVELOPABLE_ATTRS };
}));
app.put('/api/player/:id/focus', wrap((req) => {
  const attr = req.query.attr || null;
  if (attr && !DEVELOPABLE_ATTRS.includes(attr)) throw httpError(400, `Invalid focus attribute. Options: ${DEVELOPABLE_ATTRS.join(', ')}`);
  db.prepare("UPDATE players SET dev_focus=?,updated_at=datetime('now') WHERE id=?").run(attr, req.params.id);
  return { dev_focus: attr, options: DEVELOPABLE_ATTRS };
}));

// Draft
app.get('/api/draft/point-pool', wrap((req) => {
  const { position, height, weight } = req.query;
  if (!POSITION_PROFILES[position]) throw httpError(400, 'Invalid position');
  return calculatePointPool(position, parseFloat(height), parseFloat(weight));
}));
app.post('/api/draft/simulate/:id', wrap((req) => simulateDraft(req.params.id)));

// Draft scouting preview: generate a draft class and show where the player
// projects, so they can see the competition before entering the draft.
app.get('/api/draft/preview/:id', wrap((req) => {
  const player = db.prepare('SELECT * FROM players WHERE id=?').get(req.params.id);
  if (!player) throw httpError(404, 'Player not found');
  const overall = calculateOverallRating(player);
  const draftClass = generateDraftClass();
  const allProspects = draftClass.map(p => ({ ...p })).concat([
    { name: player.name, position: player.position, overall, potential: player.potential ?? 50, is_player: true },
  ]);
  allProspects.sort((a, b) => b.overall - a.overall);
  const projection = allProspects.findIndex(p => p.is_player) + 1;
  const top10 = allProspects.slice(0, 10).map((p, i) => ({
    rank: i + 1, name: p.name, position: p.position, overall: p.overall, potential: p.potential, is_player: !!p.is_player,
  }));
  return { top10, projection, player_overall: overall };
}));
app.get('/api/draft/estimate', wrap((req) => {
  const position = req.query.position;
  let allocations = {};
  try { allocations = JSON.parse(req.query.allocations || '{}'); } catch {}
  if (!POSITION_PROFILES[position]) throw httpError(400, 'Invalid position');
  const attrs = {};
  for (const [cat, catInfo] of Object.entries(ATTRIBUTE_CATEGORIES)) {
    const catPoints = allocations[cat] ?? 30;
    const avg = 22 + catPoints * 0.8;
    for (const attr of catInfo.attrs) attrs[attr] = clamp(Math.round(avg), 18, 94);
  }
  const overall = calculateOverallRating(attrs);
  return { overall, tier: playerTier(overall), role: POSITION_ROLE[position] || 'Two-Way Wing' };
}));
app.get('/api/draft/class', wrap(() => ({ prospects: generateDraftClass().slice(0, 30) })));

// Game
app.post('/api/game/simulate/:id', wrap((req) => {
  const opponentId = req.query.opponent_id ? Number(req.query.opponent_id) : null;
  const isPlayoff = req.query.is_playoff === 'true';
  return simulateGame(req.params.id, opponentId, isPlayoff);
}));
app.post('/api/game/simulate-batch/:id', wrap((req) => {
  const state = getLeagueState(req.params.id);
  if (state.current_phase !== 'regular_season') throw httpError(400, 'Batch simulation is only available during the regular season.');
  let count = Math.min(Number(req.query.count) || 5, 82);
  // Clamp to the games actually left so we never half-commit past the 82-game cap.
  count = Math.max(0, Math.min(count, 82 - state.games_played_in_season));
  const games = [];
  let paused = null;
  for (let i = 0; i < count; i++) {
    // A pending decision blocks the run until the player acts — the batch stops
    // before simulating past the decision point.
    const p = db.prepare('SELECT pending_weekend, retirement_pending, pending_option, media_pending FROM players WHERE id=?').get(req.params.id);
    if (p.pending_weekend) { paused = { type: 'weekend', label: '🌟 All-Star Weekend', message: 'Enter the dunk contest, the three-point contest, or skip?' }; break; }
    if (p.retirement_pending) { paused = { type: 'retire', label: '🕊️ Retirement', message: 'Retire now, or play one more year?' }; break; }
    if (p.pending_option) { paused = { type: 'option', label: '📄 Player Option', message: 'Exercise your option, or hit free agency?' }; break; }
    if (hasPendingLifeEvent(req.params.id)) { paused = { type: 'life', label: '👥 Life Event', message: 'Someone in your life is waiting on your answer.' }; break; }
    if (p.media_pending) { paused = { type: 'media', label: '🎤 Media', message: 'A big moment — the media wants your reaction.' }; break; }
    games.push(simulateGame(req.params.id));
  }
  return { games, count: games.length, paused };
}));
app.get('/api/game/logs/:id', wrap((req) => {
  const season = req.query.season ? Number(req.query.season) : null;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = season
    ? db.prepare('SELECT * FROM game_logs WHERE player_id=? AND season_number=? ORDER BY game_number DESC LIMIT ?').all(req.params.id, season, limit)
    : db.prepare('SELECT * FROM game_logs WHERE player_id=? ORDER BY season_number DESC,game_number DESC LIMIT ?').all(req.params.id, limit);
  return { games: rows };
}));

// Season
app.get('/api/season/state', wrap((req) => getLeagueState(req.query.player_id)));
app.post('/api/season/advance-phase', wrap((req) => { advanceLeaguePhase(req.query.player_id); return getLeagueState(req.query.player_id); }));
app.post('/api/season/finalize/:id', wrap((req) => finalizeSeason(req.params.id)));
app.post('/api/season/playoff-game/:id', wrap((req) => simulatePlayoffGame(req.params.id)));
app.get('/api/season/schedule/:teamId', wrap((req) => {
  const teamId = Number(req.params.teamId);
  const sched = generateSeasonSchedule(teamId, req.query.player_id);
  return { team_id: teamId, team: (TEAMS[teamId] || {}).name, schedule: sched.map(o => ({ opponent_id: o, opponent_name: TEAMS[o].name, opponent_abbr: TEAMS[o].abbr, opponent_ovr: TEAMS[o].ovr })) };
}));
app.get('/api/season/summaries/:id', wrap((req) => ({ seasons: db.prepare('SELECT * FROM season_summaries WHERE player_id=? ORDER BY season_number').all(req.params.id) })));

// Training
app.get('/api/training/programs', wrap(() => ({ programs: Object.fromEntries(Object.entries(TRAINING_PROGRAMS).map(([k, v]) => [k, { desc: v.desc, primary: v.primary, secondary: v.secondary, intensity: v.intensity, injury_risk: v.inj_risk }])) })));
app.post('/api/training/apply/:id', wrap((req) => {
  const programs = req.query.programs ? String(req.query.programs).split(',').filter(Boolean) : (req.query.program ? [req.query.program] : []);
  return applyTraining(req.params.id, programs);
}));

// Economy
app.get('/api/economy/endorsements/:id', wrap((req) => ({ offers: getEndorsementOffers(req.params.id) })));
app.post('/api/economy/sign-endorsement/:id', wrap((req) => signEndorsement(req.params.id, Number(req.query.offer_id))));
app.post('/api/economy/negotiate-endorsement/:id', wrap((req) => negotiateEndorsement(req.params.id, Number(req.query.offer_id))));
app.get('/api/economy/endorsements-active/:id', wrap((req) => ({ endorsements: db.prepare('SELECT * FROM endorsements WHERE player_id=? AND years_remaining>0').all(req.params.id) })));
app.post('/api/economy/tour/:id', wrap((req) => takeTour(req.params.id, req.query.destination)));
app.get('/api/economy/shoe/:id', wrap((req) => ({ shoe: getShoe(req.params.id), brands: SHOE_BRANDS, need_clout: 60 })));
app.post('/api/economy/sign-shoe/:id', wrap((req) => signShoe(req.params.id, req.query.brand, req.query.name, req.query.colorway)));
app.get('/api/economy/intl/:id', wrap((req) => ({ tournament: getLeagueState(req.params.id).intl_tournament || null, options: INTL_TOURNAMENTS })));
app.post('/api/economy/play-intl/:id', wrap((req) => playIntlTournament(req.params.id)));

// Game mode: story (more narrative), classic (default), sandbox (edit attributes).
app.get('/api/settings/:id', wrap((req) => ({ game_mode: getLeagueState(req.params.id).game_mode || 'classic', lang: getLeagueState(req.params.id).lang || 'en', modes: ['story', 'classic', 'sandbox'], langs: ['en', 'zh'] })));
app.put('/api/settings/:id', wrap((req) => {
  const state = getLeagueState(req.params.id);
  const mode = req.query.mode || state.game_mode || 'classic';
  const lang = req.query.lang || state.lang || 'en';
  if (!['story', 'classic', 'sandbox'].includes(mode)) throw httpError(400, 'Invalid mode. Options: story, classic, sandbox');
  if (!['en', 'zh'].includes(lang)) throw httpError(400, 'Invalid language. Options: en, zh');
  db.prepare('UPDATE league_state SET game_mode=?, lang=? WHERE player_id=?').run(mode, lang, req.params.id);
  return { game_mode: mode, lang };
}));
app.put('/api/player/:id/attribute', wrap((req) => {
  if ((getLeagueState(req.params.id).game_mode || 'classic') !== 'sandbox') throw httpError(400, 'Attribute editing is only available in Sandbox mode.');
  const attr = req.query.attr;
  const value = Number(req.query.value);
  if (!DEVELOPABLE_ATTRS.includes(attr)) throw httpError(400, `Attribute must be one of: ${DEVELOPABLE_ATTRS.join(', ')}`);
  if (!Number.isFinite(value) || value < 10 || value > 99) throw httpError(400, 'Value must be 10-99.');
  db.prepare(`UPDATE players SET ${attr}=?, updated_at=datetime('now') WHERE id=?`).run(value, req.params.id);
  return { attr, value };
}));
app.get('/api/economy/assets', wrap(() => ({ assets: ASSET_TYPES })));
app.post('/api/economy/invest/:id', wrap((req) => makeInvestment(req.params.id, req.query.asset_type || 'stocks', Number(req.query.amount))));
app.post('/api/economy/redeem-investment/:id', wrap((req) => redeemInvestment(req.params.id, Number(req.query.investment_id))));
app.get('/api/economy/investments/:id', wrap((req) => ({ investments: db.prepare('SELECT * FROM investments WHERE player_id=?').all(req.params.id) })));

// Free agency
app.get('/api/contract/offers/:id', wrap((req) => {
  const rows = db.prepare('SELECT * FROM contract_offers WHERE player_id=? AND accepted=0').all(req.params.id);
  return { offers: rows.map(o => { const t = TEAMS[o.team_id] || {}; const dynStr = teamStrength(req.params.id, o.team_id); const proj = teamProjection(req.params.id, o.team_id); return { id: o.id, team: t.name || 'Team', team_abbr: t.abbr || '—', years: o.years, annual_value: o.annual_value, total_value: o.total_value, ovr: Math.round(dynStr), title_shot: proj.title_pct > 0, proj_wins: proj.proj_wins, title_pct: proj.title_pct }; }).sort((a, b) => b.annual_value - a.annual_value) };
}));
app.post('/api/contract/sign/:id', wrap((req) => signContract(req.params.id, Number(req.query.offer_id))));
app.post('/api/contract/negotiate/:id', wrap((req) => negotiateContract(req.params.id, Number(req.query.offer_id))));
app.post('/api/contract/player-option/:id', wrap((req) => resolvePlayerOption(req.params.id, req.query.choice)));

// Media
app.get('/api/media/scenario/:id', wrap((req) => getRandomMediaScenario(req.params.id)));
app.post('/api/media/respond/:id', wrap((req) => handleMediaEvent(req.params.id, req.query.scenario_id, Number(req.query.choice_index))));
app.get('/api/media/notable/:id', wrap((req) => {
  const p = db.prepare('SELECT media_pending FROM players WHERE id=?').get(req.params.id);
  const notable = p?.media_pending ? JSON.parse(p.media_pending) : null;
  if (!notable || !NOTABLE_MEDIA[notable.type]) return { notable: null };
  const scene = NOTABLE_MEDIA[notable.type];
  return { notable, question: scene.question(notable), choices: scene.choices.map(c => ({ text: c.text, tone: c.tone })) };
}));
app.post('/api/media/respond-notable/:id', wrap((req) => handleNotableMedia(req.params.id, Number(req.query.choice_index))));
app.get('/api/media/history/:id', wrap((req) => ({ events: db.prepare('SELECT * FROM media_events WHERE player_id=? ORDER BY created_at DESC LIMIT ?').all(req.params.id, Math.min(Number(req.query.limit) || 20, 100)) })));

// Life system
app.get('/api/life/overview/:id', wrap((req) => getLifeOverview(req.params.id)));
app.post('/api/life/respond/:id', wrap((req) => resolveLifeEvent(req.params.id, req.query.event_id, Number(req.query.choice_index), req.query.relationship_id ? Number(req.query.relationship_id) : null)));

// Locker room
app.get('/api/player/:id/teammates', wrap((req) => {
  syncTeammates(req.params.id);
  const season = getLeagueState(req.params.id).current_season;
  const p = db.prepare('SELECT locker_actions_used FROM players WHERE id=?').get(req.params.id);
  return { teammates: db.prepare('SELECT id, name, position, bond FROM teammates WHERE player_id=? AND season_number=? ORDER BY bond DESC').all(req.params.id, season), chemistry: teamChemistry(req.params.id), actions_used: p?.locker_actions_used || 0, actions_max: MAX_LOCKER_ACTIONS };
}));
app.post('/api/player/:id/locker-action', wrap((req) => lockerRoomAction(req.params.id, Number(req.query.teammate_id))));

// Lifestyle & advisor
app.get('/api/lifestyle/tiers', wrap(() => ({ tiers: LIFESTYLE_TIERS })));
app.put('/api/player/:id/lifestyle', wrap((req) => setLifestyle(req.params.id, req.query.tier)));
app.post('/api/player/:id/advisor', wrap((req) => {
  const p = db.prepare('SELECT wealth FROM players WHERE id=?').get(req.params.id);
  if (!p) throw httpError(404, 'Player not found');
  const cost = 2;
  if ((p.wealth || 0) < cost) throw httpError(400, 'Not enough money to hire a top advisor ($2M).');
  const trust = randInt(80, 95);
  db.prepare("UPDATE players SET wealth=MAX(0,wealth-?), advisor_trust=?, updated_at=datetime('now') WHERE id=?").run(cost, trust, req.params.id);
  return { advisor_trust: trust, cost };
}));

// Clout
app.post('/api/clout/request-trade/:id', wrap((req) => requestTrade(req.params.id, Number(req.query.desired_team_id))));
app.post('/api/clout/request-buyout/:id', wrap((req) => requestBuyout(req.params.id)));

// Career
app.get('/api/career/:id', wrap((req) => getCareerOverview(req.params.id)));
app.get('/api/career/export/:id', wrap((req) => exportCareerJson(req.params.id)));

// Save / load
app.post('/api/save/:id', wrap((req) => saveGame(req.params.id, req.query.save_name, req.query.description || '')));
app.get('/api/saves/:id', wrap((req) => ({ saves: listSaves(req.params.id) })));
app.get('/api/saves/all', wrap(() => ({ saves: listAllSaves() })));
app.delete('/api/save/:saveId', wrap((req) => deleteSave(req.params.saveId)));
app.post('/api/load/:id', wrap((req) => loadGame(req.params.id, req.query.save_id)));
app.post('/api/load-save/:saveId', wrap((req) => loadGameById(req.params.saveId)));

// Career events / development history feed
app.get('/api/player/:id/events', wrap((req) => ({
  events: db.prepare('SELECT * FROM career_progress WHERE player_id=? ORDER BY created_at DESC LIMIT ?').all(req.params.id, Math.min(Number(req.query.limit) || 20, 100)),
})));

// Misc
app.get('/api/teams', wrap(() => ({ teams: TEAMS })));
app.get('/api/league/standings', wrap((req) => {
  const state = getLeagueState(req.query.player_id);
  const season = state.current_season;
  // Ensure the league-wide records are caught up to the current season point.
  if (req.query.player_id) {
    const p = db.prepare('SELECT team_id, s_wins, s_losses FROM players WHERE id=?').get(req.query.player_id);
    if (p) advanceLeague(req.query.player_id, p.team_id, p.s_wins, p.s_losses);
  }
  const rows = db.prepare('SELECT team_id, wins, losses FROM team_records WHERE player_id=? AND season_number=?').all(req.query.player_id, season);
  const recMap = new Map(rows.map(r => [r.team_id, { wins: r.wins, losses: r.losses }]));
  const standings = [];
  for (const tid of ALL_TEAM_IDS) {
    const t = TEAMS[tid];
    const rec = recMap.get(tid) || { wins: 0, losses: 0 };
    // Live strength (roster-driven), not the frozen TEAMS[].ovr — the league evolves.
    const overall = teamStrength(req.query.player_id, tid);
    standings.push({ team_id: tid, name: t.name, abbr: t.abbr, conference: t.conf, division: t.div, wins: rec.wins, losses: rec.losses, overall });
  }
  const east = standings.filter(t => t.conference === 'East').sort((a, b) => b.wins - a.wins || a.team_id - b.team_id);
  const west = standings.filter(t => t.conference === 'West').sort((a, b) => b.wins - a.wins || a.team_id - b.team_id);
  const gp = state.current_phase === 'regular_season' ? state.games_played_in_season : 82;
  return { east, west, games_played: gp, estimated: false };
}));
app.get('/api/league/players', wrap((req) => ({ players: topAIPlayers(req.query.player_id, Math.min(Number(req.query.limit) || 20, 100)) })));
app.get('/api/league/team/:teamId', wrap((req) => teamRoster(req.query.player_id, Number(req.params.teamId))));
app.get('/api/league/moves/:id', wrap((req) => ({ moves: db.prepare("SELECT season_number, description FROM career_progress WHERE player_id=? AND event_type='league' ORDER BY id DESC LIMIT ?").all(req.params.id, Math.min(Number(req.query.limit) || 15, 50)) })));
app.get('/api/league/mvp-race/:id', wrap((req) => ({ race: mvpRace(req.params.id) })));
app.get('/api/league/leaders/:id', wrap((req) => statLeaders(req.params.id)));

// Playoff bracket: simulate all 4 rounds based on team strength. The player's
// actual series (tracked in league_state) overrides the simulation.
function simulateBracket(playerId) {
  const state = getLeagueState(playerId);
  const standings = getConferenceStandings(playerId);
  const season = state.current_season;
  const playerTeamId = db.prepare('SELECT team_id FROM players WHERE id=?').get(playerId)?.team_id;

  function simSeries(teamA, teamB) {
    if (teamA === playerTeamId || teamB === playerTeamId) {
      if (teamA === playerTeamId || teamB === playerTeamId) {
        const isPlayerA = teamA === playerTeamId;
        const opponent = isPlayerA ? teamB : teamA;
        if (state.playoff_opponent === opponent) {
          return { wins: state.series_wins, losses: state.series_losses, winner: state.series_wins >= 4 ? teamA : state.series_losses >= 4 ? teamB : null };
        }
      }
      // Player's team but not current series — simulate by strength
    }
    const a = teamStrength(playerId, teamA);
    const b = teamStrength(playerId, teamB);
    let aw = 0, bw = 0;
    for (let i = 0; i < 7 && aw < 4 && bw < 4; i++) {
      if (Math.random() < a / (a + b)) aw++; else bw++;
    }
    return { wins: aw, losses: bw, winner: aw >= 4 ? teamA : teamB };
  }

  function buildBracket(conf) {
    const seeds = conferenceSeeds(standings, conf);
    const r1 = [];
    for (let i = 0; i < 4; i++) {
      const home = seeds[i], away = seeds[7 - i];
      if (!home || !away) continue;
      const s = simSeries(home.team_id, away.team_id);
      r1.push({ home: home.team_id, away: away.team_id, ...s, round: 1 });
    }
    const r2 = [];
    for (let i = 0; i < r1.length; i += 2) {
      const a = r1[i]?.winner, b = r1[i + 1]?.winner;
      if (!a || !b) continue;
      const s = simSeries(a, b);
      r2.push({ home: a, away: b, ...s, round: 2 });
    }
    const r3 = [];
    if (r2.length >= 2) {
      const a = r2[0]?.winner, b = r2[1]?.winner;
      if (a && b) { const s = simSeries(a, b); r3.push({ home: a, away: b, ...s, round: 3 }); }
    }
    const confChamp = r3[0]?.winner || null;
    return { conf, seeds, round1: r1, round2: r2, round3: r3, champ: confChamp };
  }

  const eastBracket = buildBracket('East');
  const westBracket = buildBracket('West');
  // Finals
  let finals = null;
  if (eastBracket.champ && westBracket.champ) {
    const s = simSeries(eastBracket.champ, westBracket.champ);
    finals = { home: eastBracket.champ, away: westBracket.champ, ...s, round: 4 };
  }
  return { east: eastBracket, west: westBracket, finals, player_seed: state.player_seed };
}

app.get('/api/playoff/bracket/:id', wrap((req) => simulateBracket(req.params.id)));

// League history: aggregate awards by season (champion, MVP, All-NBA, etc.)
app.get('/api/league/history/:id', wrap((req) => {
  const seasons = db.prepare('SELECT DISTINCT season_number FROM awards WHERE player_id=? ORDER BY season_number DESC').all(req.params.id);
  const history = seasons.map(s => {
    const awards = db.prepare('SELECT award_name FROM awards WHERE player_id=? AND season_number=?').all(req.params.id, s.season_number);
    const champion = awards.find(a => a.award_name === 'NBA Champion') ? true : false;
    const mvp = awards.find(a => a.award_name === 'MVP') ? true : false;
    const allNba = awards.filter(a => a.award_name?.includes('All-NBA')).map(a => a.award_name);
    const allDef = awards.filter(a => a.award_name?.includes('All-Defensive')).map(a => a.award_name);
    return { season: s.season_number, champion, mvp, allNba, allDef, allAwards: awards.map(a => a.award_name) };
  });
  return { history };
}));

app.get('/api/health', wrap(() => ({ status: 'ok', teams: ALL_TEAM_IDS.length })));

// Static frontend
app.use(express.static(FRONTEND_DIR));
app.get('/', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  [BBALL CAREER SIMULATOR]\n  http://localhost:${PORT}\n`);
  });
}

module.exports = {
  db, TEAMS, ALL_TEAM_IDS, POSITION_PROFILES, ATTRIBUTE_CATEGORIES, POSITION_ROLE, POSITION_DEFENSE,
  BACKGROUNDS, DEVELOPABLE_ATTRS, CAREER_EVENTS,
  createPlayerWithPoints, calculatePointPool, calculateOverallRating, simulateDraft,
  simulateGame, simulatePlayoffGame, generateSeasonSchedule, applyTraining, finalizeSeason, applyAging,
  getLeagueState, advanceLeaguePhase, advanceLeague, maybeDevelop, maybeCareerEvent,
  advanceYear, generateContractOffers, signContract, requestBuyout, maybeRetire, resolveRetirement,
  buildDraftOrder, playerTier, teamTier, consistencyRating, deleteSave, app,
  seasonAdvancedStats, hollingerUPER, bracketOpponentSeed, playoffOpponentTeam, getConferenceStandings, conferenceSeeds,
  applyInjuryTreatment, maybeAllStar, allStarQualifies, signEndorsement, negotiateEndorsement,
  makeInvestment, redeemInvestment, maxSalaryFor, getRandomMediaScenario, teamDrift, hashSalt,
  LIFE_EVENTS, lifeBondBuffs, getLifeOverview, resolveLifeEvent,
  LIFESTYLE_TIERS, setLifestyle, maybeAdvisorScam, maybeLifeShock, generateDraftClass,
  ensureLeaguePlayers, teamStrength, advanceLeaguePlayers, topAIPlayers, advanceLeagueMarket, tickLeagueInjuries,
  GROWTH_ARCHETYPES, rollGrowthArchetype, syncTeammates, teamChemistry, driftBonds, nudgeBonds, getLockerRoomBonds,
  ASSET_TYPES, aiSalary, teamSalary, teamRoster, TEAM_SALARY_CAP, teamProjection, maybePassiveTrade,
  homeSchedule, getSecondLifeOptions, chooseSecondLife, mvpRace,
  lockerRoomAction, maybeAllStarWeekend, resolveAllStarWeekend, advanceLeagueCoaching,
  statLeaders, checkMilestones, negotiateContract, resolvePlayerOption, advanceSecondLife,
  careerRecords, checkGameRecords, checkSeasonRecords, LEGEND_RECORDS,
  tacticModifiers, teamOffDef, FRANCHISE_RECORDS,
};
