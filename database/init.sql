-- BBall Career Simulator — database schema
-- Run on startup (idempotent: CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, position TEXT NOT NULL,
    height REAL NOT NULL, weight REAL NOT NULL, age INTEGER DEFAULT 19,
    experience INTEGER DEFAULT 0, team_id INTEGER DEFAULT 0,
    jersey_number INTEGER DEFAULT 0, role TEXT DEFAULT 'Two-Way Wing',
    draft_pick INTEGER DEFAULT 0, draft_year INTEGER DEFAULT 0,
    wingspan REAL NOT NULL, standing_reach REAL NOT NULL,
    hand_size REAL NOT NULL, frame_build REAL NOT NULL,
    body_fat_pct REAL DEFAULT 8.0,
    vertical_jump INTEGER DEFAULT 45, speed INTEGER DEFAULT 45,
    lateral_quickness INTEGER DEFAULT 45, strength INTEGER DEFAULT 45,
    core_stability INTEGER DEFAULT 45, stamina INTEGER DEFAULT 55,
    durability INTEGER DEFAULT 55,
    perimeter_defense INTEGER DEFAULT 40, help_defense INTEGER DEFAULT 40,
    steal INTEGER DEFAULT 35, rim_protection INTEGER DEFAULT 40,
    box_out INTEGER DEFAULT 40, rebounding INTEGER DEFAULT 40,
    first_step INTEGER DEFAULT 40, finishing INTEGER DEFAULT 40,
    mid_range INTEGER DEFAULT 40, catch_shoot_3pt INTEGER DEFAULT 35,
    pull_up_3pt INTEGER DEFAULT 30, off_ball INTEGER DEFAULT 40,
    drawing_fouls INTEGER DEFAULT 35, free_throw INTEGER DEFAULT 65,
    ball_security INTEGER DEFAULT 45, pnr_vision INTEGER DEFAULT 40,
    passing_accuracy INTEGER DEFAULT 40,
    bbiq INTEGER DEFAULT 50, clutch_factor INTEGER DEFAULT 50,
    work_ethic INTEGER DEFAULT 50, leadership INTEGER DEFAULT 40,
    composure INTEGER DEFAULT 50,
    fatigue REAL DEFAULT 0, injury_risk REAL DEFAULT 0,
    morale INTEGER DEFAULT 75, injury_status TEXT,
    injury_games_remaining INTEGER DEFAULT 0,
    hot_streak INTEGER DEFAULT 0, cold_streak INTEGER DEFAULT 0,
    load_management INTEGER DEFAULT 0,
    clout REAL DEFAULT 2, fan_base REAL DEFAULT 5,
    wealth REAL DEFAULT 0.1, chemistry INTEGER DEFAULT 50,
    lifestyle INTEGER DEFAULT 1, advisor_trust INTEGER DEFAULT 65,
    locker_actions_used INTEGER DEFAULT 0,
    pending_weekend INTEGER DEFAULT 0,
    pending_option INTEGER DEFAULT 0,
    mvp_votes REAL DEFAULT 0, trained_season INTEGER DEFAULT 0,
    s_pts REAL DEFAULT 0, s_reb REAL DEFAULT 0, s_ast REAL DEFAULT 0,
    s_stl REAL DEFAULT 0, s_blk REAL DEFAULT 0, s_tov REAL DEFAULT 0,
    s_fga REAL DEFAULT 0, s_fgm REAL DEFAULT 0, s_3pa REAL DEFAULT 0,
    s_3pm REAL DEFAULT 0, s_fga_mid REAL DEFAULT 0, s_fta REAL DEFAULT 0, s_ftm REAL DEFAULT 0,
    s_games INTEGER DEFAULT 0, s_min REAL DEFAULT 0, s_pf INTEGER DEFAULT 0,
    s_wins INTEGER DEFAULT 0, s_losses INTEGER DEFAULT 0,
    p_pts REAL DEFAULT 0, p_reb REAL DEFAULT 0, p_ast REAL DEFAULT 0,
    p_stl REAL DEFAULT 0, p_blk REAL DEFAULT 0, p_tov REAL DEFAULT 0,
    p_fga REAL DEFAULT 0, p_fgm REAL DEFAULT 0, p_3pa REAL DEFAULT 0,
    p_3pm REAL DEFAULT 0, p_fga_mid REAL DEFAULT 0, p_fta REAL DEFAULT 0, p_ftm REAL DEFAULT 0,
    p_games INTEGER DEFAULT 0, p_min REAL DEFAULT 0, p_pf INTEGER DEFAULT 0,
    p_wins INTEGER DEFAULT 0, p_losses INTEGER DEFAULT 0,
    background TEXT DEFAULT 'small_town',
    dev_focus TEXT, last_dev_game INTEGER DEFAULT 0,
    potential INTEGER DEFAULT 50,
    growth TEXT DEFAULT 'steady',
    tactics_defense TEXT DEFAULT 'balanced', tactics_offense TEXT DEFAULT 'balanced',
    life_values TEXT DEFAULT '{}', flags TEXT DEFAULT '[]',
    goat_bonus REAL DEFAULT 0,
    media_pending TEXT,
    retired INTEGER DEFAULT 0,
    retirement_pending INTEGER DEFAULT 0,
    second_life TEXT,
    legacy_score REAL DEFAULT 0,
    injury_treatment TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS game_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER, game_number INTEGER,
    opponent_team_id INTEGER, is_playoff INTEGER DEFAULT 0,
    is_home INTEGER DEFAULT 1, result TEXT DEFAULT 'L',
    team_score INTEGER DEFAULT 0, opponent_score INTEGER DEFAULT 0,
    minutes REAL DEFAULT 0, pts INTEGER DEFAULT 0, reb INTEGER DEFAULT 0,
    oreb INTEGER DEFAULT 0, dreb INTEGER DEFAULT 0, ast INTEGER DEFAULT 0,
    stl INTEGER DEFAULT 0, blk INTEGER DEFAULT 0, tov INTEGER DEFAULT 0,
    pf INTEGER DEFAULT 0, fga INTEGER DEFAULT 0, fgm INTEGER DEFAULT 0,
    tpa INTEGER DEFAULT 0, tpm INTEGER DEFAULT 0, fta INTEGER DEFAULT 0,
    ftm INTEGER DEFAULT 0, plus_minus INTEGER DEFAULT 0,
    per REAL DEFAULT 0, ts_pct REAL DEFAULT 0, usg_pct REAL DEFAULT 0,
    game_score REAL DEFAULT 0, eff INTEGER DEFAULT 0,
    q1_t INTEGER DEFAULT 0, q1_o INTEGER DEFAULT 0,
    q2_t INTEGER DEFAULT 0, q2_o INTEGER DEFAULT 0,
    q3_t INTEGER DEFAULT 0, q3_o INTEGER DEFAULT 0,
    q4_t INTEGER DEFAULT 0, q4_o INTEGER DEFAULT 0,
    team_reb INTEGER DEFAULT 0, team_ast INTEGER DEFAULT 0, team_tov INTEGER DEFAULT 0,
    team_fgm INTEGER DEFAULT 0, team_fga INTEGER DEFAULT 0, team_3pm INTEGER DEFAULT 0, team_3pa INTEGER DEFAULT 0,
    opp_reb INTEGER DEFAULT 0, opp_ast INTEGER DEFAULT 0, opp_tov INTEGER DEFAULT 0,
    opp_fgm INTEGER DEFAULT 0, opp_fga INTEGER DEFAULT 0, opp_3pm INTEGER DEFAULT 0, opp_3pa INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS season_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER, team_id INTEGER,
    age INTEGER, games_played INTEGER DEFAULT 0,
    mpg REAL DEFAULT 0, ppg REAL DEFAULT 0, rpg REAL DEFAULT 0,
    apg REAL DEFAULT 0, spg REAL DEFAULT 0, bpg REAL DEFAULT 0,
    topg REAL DEFAULT 0, fg_pct REAL DEFAULT 0, tp_pct REAL DEFAULT 0,
    ft_pct REAL DEFAULT 0, per REAL DEFAULT 0, ts_pct REAL DEFAULT 0,
    usg_pct REAL DEFAULT 0, ws REAL DEFAULT 0, bpm REAL DEFAULT 0,
    vorp REAL DEFAULT 0, team_wins INTEGER DEFAULT 0,
    team_losses INTEGER DEFAULT 0, playoff_result TEXT,
    p_games INTEGER DEFAULT 0, p_ppg REAL DEFAULT 0, p_rpg REAL DEFAULT 0,
    p_apg REAL DEFAULT 0, p_spg REAL DEFAULT 0, p_bpg REAL DEFAULT 0,
    p_topg REAL DEFAULT 0, p_mpg REAL DEFAULT 0, p_fg_pct REAL DEFAULT 0,
    p_tp_pct REAL DEFAULT 0, p_ft_pct REAL DEFAULT 0,
    role TEXT, awards TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS awards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER,
    award_type TEXT, award_name TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER, team_id INTEGER,
    years INTEGER, total_value REAL, annual_salary REAL,
    contract_type TEXT DEFAULT 'Standard',
    player_option INTEGER DEFAULT 0,
    no_trade INTEGER DEFAULT 0,
    signed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER,
    team_id INTEGER, years INTEGER, annual_value REAL, total_value REAL,
    contract_type TEXT DEFAULT 'Free Agency', accepted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS endorsements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, brand_name TEXT, annual_value REAL,
    years_remaining INTEGER, prestige INTEGER DEFAULT 50,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, name TEXT, amount_invested REAL,
    current_value REAL, annual_return REAL DEFAULT 0,
    risk_level TEXT DEFAULT 'Medium',
    asset_type TEXT DEFAULT 'stocks',
    lock_season INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER,
    scenario_id TEXT, event_type TEXT, description TEXT, choice_made TEXT,
    narrative_result TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS career_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER,
    event_type TEXT, description TEXT, milestone TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS relationships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
    bond INTEGER DEFAULT 50, status TEXT DEFAULT 'active',
    meta TEXT DEFAULT '{}', pending_event TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS life_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER,
    event_id TEXT, relationship_id INTEGER,
    description TEXT, choice_made TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, team_id INTEGER NOT NULL,
    name TEXT NOT NULL, position TEXT NOT NULL,
    age INTEGER NOT NULL, overall INTEGER NOT NULL,
    potential INTEGER NOT NULL, experience INTEGER DEFAULT 0,
    growth TEXT DEFAULT 'steady',
    injury_games INTEGER DEFAULT 0,
    rest_games INTEGER DEFAULT 0,
    salary REAL DEFAULT 0,
    retired INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teammates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER,
    name TEXT NOT NULL, position TEXT NOT NULL,
    bond INTEGER DEFAULT 50,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS save_files (
    id TEXT PRIMARY KEY, player_id TEXT NOT NULL,
    save_name TEXT NOT NULL, season_number INTEGER,
    description TEXT DEFAULT '', snapshot TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS endorsement_offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, season_number INTEGER,
    brand_name TEXT, annual_value REAL, years INTEGER, prestige INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS shoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT NOT NULL, brand TEXT NOT NULL,
    name TEXT NOT NULL, colorway TEXT,
    annual_value REAL DEFAULT 0, signed_season INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS league_state (
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
    market REAL DEFAULT 0,
    intl_tournament TEXT,
    game_mode TEXT DEFAULT 'classic'
);

CREATE TABLE IF NOT EXISTS team_records (
    player_id TEXT NOT NULL, team_id INTEGER NOT NULL, season_number INTEGER NOT NULL,
    wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0,
    PRIMARY KEY (player_id, team_id, season_number)
);

CREATE INDEX IF NOT EXISTS idx_game_logs_player ON game_logs(player_id, season_number);
CREATE INDEX IF NOT EXISTS idx_season_summaries_player ON season_summaries(player_id, season_number);
CREATE INDEX IF NOT EXISTS idx_awards_player ON awards(player_id);
CREATE INDEX IF NOT EXISTS idx_media_player ON media_events(player_id);
CREATE INDEX IF NOT EXISTS idx_endorse_player ON endorsements(player_id);
CREATE INDEX IF NOT EXISTS idx_relationships_player ON relationships(player_id);
CREATE INDEX IF NOT EXISTS idx_life_events_player ON life_events(player_id);
CREATE INDEX IF NOT EXISTS idx_ai_players ON ai_players(player_id, team_id);
