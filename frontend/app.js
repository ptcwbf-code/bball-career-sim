// ============================================================
// STATE
// ============================================================
const API = '/api';
const S = {
  playerId: localStorage.getItem('bball_pid') || null,
  player: null, season: null, teams: null, programs: null,
  tab: 'dashboard', draftStage: null, draftData: null, mediaPending: false,
  create: { name:'', position:'PG', age:19, height:null, weight:null, allocs:{}, background:'small_town', _backgrounds:null },
};

// ============================================================
// UTILS
// ============================================================
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path, opts={}) {
  const res = await fetch(API+path, { headers:{'Content-Type':'application/json', ...opts.headers}, ...opts });
  if (!res.ok) { let d={}; try{d=await res.json()}catch(e){}; throw new Error(d.detail || `HTTP ${res.status}`); }
  return res.json();
}
function toast(msg, type='info') {
  const colors = { info:'border-cyber/40 text-cyber', success:'border-good/40 text-good', error:'border-bad/40 text-bad', warn:'border-warn/40 text-warn' };
  const icons = { info:'ℹ️', success:'✅', error:'⚠️', warn:'⚡' };
  const el = document.createElement('div');
  el.className = `card px-4 py-3 text-sm border ${colors[type]||colors.info} fade`;
  el.innerHTML = `<span class="mr-1">${icons[type]||''}</span>${esc(msg)}`;
  $('#toasts').appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }, 3200);
}

// ============================================================
// TABS
// ============================================================
const TABS = [
  { id:'create', icon:'🎮', label:'New Game', zh:'新游戏', needPlayer:false },
  { id:'dashboard', icon:'📊', label:'Dashboard', zh:'仪表盘', needPlayer:true },
  { id:'attributes', icon:'🧬', label:'Attributes', zh:'属性', needPlayer:true },
  { id:'season', icon:'📅', label:'Season', zh:'赛季', needPlayer:true },
  { id:'game', icon:'🏟️', label:'Play Game', zh:'比赛', needPlayer:true },
  { id:'training', icon:'💪', label:'Training', zh:'训练', needPlayer:true },
  { id:'career', icon:'🏆', label:'Career', zh:'生涯', needPlayer:true },
  { id:'offcourt', icon:'💼', label:'Off-Court', zh:'场外', needPlayer:true },
  { id:'league', icon:'🌐', label:'League', zh:'联盟', needPlayer:true },
  { id:'saves', icon:'💾', label:'Save', zh:'存档', needPlayer:true },
];

function renderTabs() {
  const nav = $('#tab-nav');
  const lang = S.season?.lang || 'en';
  nav.innerHTML = TABS.filter(t => S.player || !t.needPlayer).map(tab => `
    <button class="tab ${S.tab===tab.id?'active':''}" data-tab="${tab.id}">
      ${tab.icon} ${lang==='zh'?(tab.zh||tab.label):tab.label}${tab.id==='offcourt' && S.mediaPending ? '<span class="ml-1 inline-block w-2 h-2 rounded-full bg-bad"></span>' : ''}
    </button>`).join('');
  $$('.tab', nav).forEach(b => b.onclick = () => switchTab(b.dataset.tab));
}

function switchTab(tab) {
  const t = TABS.find(x => x.id === tab);
  if (t && t.needPlayer && !S.player) { toast('Create a player first','warn'); switchTab('create'); return; }
  S.tab = tab;
  renderTabs();
  renderHeader();
  route();
}

function route() {
  const m = $('#main');
  m.innerHTML = '';
  destroyAllCharts();
  switch(S.tab) {
    case 'create': renderCreate(m); break;
    case 'dashboard': renderDashboard(m); break;
    case 'attributes': renderAttributes(m); break;
    case 'season': renderSeason(m); break;
    case 'game': renderGame(m); break;
    case 'training': renderTraining(m); break;
    case 'career': renderCareer(m); break;
    case 'offcourt': renderOffCourt(m); break;
    case 'league': renderLeague(m); break;
    case 'saves': renderSaves(m); break;
    default: renderCreate(m);
  }
}

// Pending decisions that need the player's attention — aggregated for the header
// badge and the decision center.
function pendingDecisions() {
  const list = [];
  const p = S.player;
  if (!p) return list;
  if (p.retirement_pending) list.push({ id: 'retire', icon: '🕊️', label: 'Retirement decision', hint: 'Retire now, or play one more year.', tab: 'dashboard' });
  if (p.free_agent) list.push({ id: 'fa', icon: '🏀', label: 'Free-agency offers', hint: 'Review offers and pick your next team.', tab: 'offcourt' });
  if (p.injury_status && p.injury_games_remaining > 0 && !p.injury_treatment) list.push({ id: 'injury', icon: '🏥', label: 'Injury treatment', hint: `${p.injury_status} — choose how to handle it.`, tab: 'dashboard' });
  if (p.pending_weekend) list.push({ id: 'weekend', icon: '🌟', label: 'All-Star Weekend', hint: 'Enter the dunk contest or three-point contest?', tab: 'dashboard' });
  if (p.pending_option) list.push({ id: 'option', icon: '📄', label: 'Player option', hint: 'Exercise your option, or hit free agency?', tab: 'dashboard' });
  return list;
}

function renderHeader() {
  const hp = $('#hdr-player');
  if (!S.player) { hp.style.display='none'; return; }
  hp.style.display='';
  $('#hdr-name').textContent = S.player.name;
  $('#hdr-team').textContent = `${S.player.team_name} · ${S.player.position} · S${S.season?.current_season||1}`;
  const pi = phaseInfo();
  const chips = [];
  const pending = pendingDecisions();
  if (pending.length) chips.push(`<button class="px-2 py-1 rounded-full bg-bad/15 text-bad border border-bad/30 font-semibold" onclick="openDecisions()" title="Pending decisions">📋 ${pending.length}</button>`);
  chips.push(`<span class="px-2 py-1 rounded-full bg-accent/15 text-accent border border-accent/30" title="${esc(pi.desc)}">${pi.icon} ${pi.label}</span>`);
  if (S.player.injury_status) chips.push(`<span class="px-2 py-1 rounded-full bg-bad/15 text-bad border border-bad/30">🏥 ${t(S.player.injury_status)}</span>`);
  if (S.player.hot_streak>0) chips.push(`<span class="px-2 py-1 rounded-full bg-accent/15 text-accent border border-accent/30">🔥 ${t('Hot')}</span>`);
  if (S.player.cold_streak<0) chips.push(`<span class="px-2 py-1 rounded-full bg-cyber/15 text-cyber border border-cyber/30">❄️ ${t('Cold')}</span>`);
  chips.push(`<span class="px-2 py-1 rounded-full bg-bg-hover text-muted border border-bg-border" title="${t('Fatigue')}">⚡ ${Math.round(S.player.fatigue)}%</span>`);
  chips.push(`<span class="px-2 py-1 rounded-full bg-bg-hover text-muted border border-bg-border" title="${t('Morale')}">😊 ${S.player.morale}</span>`);
  $('#hdr-chips').innerHTML = chips.join('');
}

function openDecisions() {
  const pending = pendingDecisions();
  if (!pending.length) return;
  const overlay = document.createElement('div');
  overlay.id = 'decisions-modal';
  overlay.className = 'fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="card p-5 w-full max-w-md">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold text-white">📋 Decisions</h3>
        <button class="text-muted text-xl" onclick="closeDecisions()">×</button>
      </div>
      <div class="space-y-2">
        ${pending.map(d=>`
          <div class="flex items-center justify-between card p-3">
            <div><div class="text-sm text-white font-semibold">${d.icon} ${esc(d.label)}</div><div class="text-xs text-muted">${esc(d.hint)}</div></div>
            <button class="btn-primary !py-1.5 !px-3 text-xs" onclick="closeDecisions();switchTab('${d.tab}')">Go</button>
          </div>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
function closeDecisions() { $('#decisions-modal')?.remove(); }

// ============================================================
// BOOTSTRAP
// ============================================================
async function boot() {
  try { S.teams = (await api('/teams')).teams; } catch(e) { console.warn('teams load failed', e); }
  try { S.programs = (await api('/training/programs')).programs; } catch(e) { console.warn('programs load failed', e); }
  if (S.playerId) {
    try { const d = await api(`/player/${S.playerId}`); S.player = d.player; } catch(e) { console.warn('player load failed', e); S.playerId=null; localStorage.removeItem('bball_pid'); }
  }
  await refreshSeason();
  renderTabs();
  renderHeader();
  if (S.player) switchTab('dashboard'); else switchTab('create');
}
boot();

async function refreshPlayer() {
  if (!S.playerId) return;
  try { const d = await api(`/player/${S.playerId}`); S.player = d.player; renderHeader(); } catch(e){ console.warn('refreshPlayer', e); }
}
async function refreshSeason() { try { S.season = S.playerId ? await api(`/season/state?player_id=${S.playerId}`) : null; } catch(e) { console.warn('refreshSeason', e); } }

// Current phase + a plain-language hint of what to do next.
function phaseInfo() {
  const phase = S.season?.current_phase||'regular_season';
  const games = S.season?.games_played_in_season||0;
  if (phase === 'offseason') return { phase, label:t('Offseason'), icon:'🌅', desc:t('Train once, then advance to the next season.') };
  if (phase === 'playoffs') {
    const rn = ['', 'First Round', 'Conf Semis', 'Conf Finals', 'NBA Finals'];
    return { phase, label:'Playoffs', icon:'🏆', desc:`${rn[S.season?.playoff_round]||'Playoffs'} — series ${S.season?.series_wins||0}-${S.season?.series_losses||0}.` };
  }
  if (games >= 82) return { phase, label:'Season Complete', icon:'🏁', desc:'Finalize the season to get your awards and enter the offseason.' };
  return { phase, label:'Regular Season', icon:'📅', desc:`Play games — ${games} of 82 done.` };
}

function marketLabel(m) {
  m = m ?? 0;
  if (m <= -0.2) return { t: 'Bear 🐻', c: 'text-bad' };
  if (m >= 0.15) return { t: 'Bull 🐂', c: 'text-good' };
  return { t: 'Neutral ⚖️', c: 'text-muted' };
}

const GROWTH_LABELS = { prodigy:'🌟 Prodigy', steady:'📈 Steady', late:'🌱 Late Bloomer', ageless:'⏳ Aging Gracefully', fizzle:'💨 Flash in the Pan' };

// ============================================================
// SORTABLE TABLE (reusable)
// ============================================================
// Call after innerHTML is set. Sorts by data-sort-value on <td> cells,
// falls back to textContent. Click headers to sort; click again to reverse.
function makeSortable(table) {
  if (!table) return;
  const heads = table.querySelectorAll('thead th');
  let sortCol = -1, sortAsc = true;
  heads.forEach((th, ci) => {
    if (th.dataset.noSort !== undefined) return;
    th.style.cursor = 'pointer';
    th.style.userSelect = 'none';
    th.addEventListener('click', () => {
      if (sortCol === ci) sortAsc = !sortAsc; else { sortCol = ci; sortAsc = true; }
      const tbody = table.querySelector('tbody');
      const rows = [...tbody.querySelectorAll('tr')];
      rows.sort((a, b) => {
        const av = a.children[ci]?.dataset.sortValue ?? a.children[ci]?.textContent?.trim() ?? '';
        const bv = b.children[ci]?.dataset.sortValue ?? b.children[ci]?.textContent?.trim() ?? '';
        const an = parseFloat(av), bn = parseFloat(bv);
        const cmp = (isNaN(an) || isNaN(bn)) ? av.localeCompare(bn) : an - bn;
        return sortAsc ? cmp : -cmp;
      });
      rows.forEach(r => tbody.appendChild(r));
      heads.forEach(h => h.classList.remove('text-accent'));
      th.classList.add('text-accent');
    });
  });
}

// ============================================================
// CHARTS (Chart.js, dark-themed)
// ============================================================
const CHARTS = {};
function destroyChart(id) { if (CHARTS[id]) { try { CHARTS[id].destroy(); } catch(e){} delete CHARTS[id]; } }
function destroyAllCharts() { Object.keys(CHARTS).forEach(destroyChart); }

function renderLineChart(id, labels, datasets) {
  destroyChart(id);
  const el = document.getElementById(id);
  if (!el || typeof Chart === 'undefined') return;
  const ctx = el.getContext('2d');
  CHARTS[id] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8b8ba3', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#8b8ba3' }, grid: { color: '#232336' } },
        y: { ticks: { color: '#8b8ba3' }, grid: { color: '#232336' } },
      },
    },
  });
}

function renderShotProfileChart(sp) {
  destroyChart('shot-profile-chart');
  const el = document.getElementById('shot-profile-chart');
  if (!el || typeof Chart === 'undefined') return;
  const total = (sp?.paint || 0) + (sp?.mid || 0) + (sp?.three || 0);
  if (!total) { el.parentElement.innerHTML = '<p class="text-muted text-sm">No shots yet this season.</p>'; return; }
  const ctx = el.getContext('2d');
  CHARTS['shot-profile-chart'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Paint', 'Mid-range', 'Three'],
      datasets: [{ data: [sp.paint, sp.mid, sp.three], backgroundColor: ['#f59e0b', '#a78bfa', '#06b6d4'], borderColor: '#0f0f1a', borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#8b8ba3', font: { size: 11 } } } },
    },
  });
}

// ============================================================
// CREATE WIZARD (multi-step, point-buy)
// ============================================================
// Reset the creation wizard so "New Game" starts a fresh save, not a re-draft
// of the player who was just created.
const NATIONALITIES = {
  'USA': '🇺🇸 USA', 'Canada': '🇨🇦 Canada', 'France': '🇫🇷 France', 'Spain': '🇪🇸 Spain',
  'Serbia': '🇷🇸 Serbia', 'Greece': '🇬🇷 Greece', 'Germany': '🇩🇪 Germany', 'Australia': '🇦🇺 Australia',
  'China': '🇨🇳 China', 'Argentina': '🇦🇷 Argentina', 'Lithuania': '🇱🇹 Lithuania', 'Slovenia': '🇸🇮 Slovenia',
  'Brazil': '🇧🇷 Brazil', 'Japan': '🇯🇵 Japan', 'Nigeria': '🇳🇬 Nigeria', 'Italy': '🇮🇹 Italy',
};
function resetCreate() {
  S.create = { name:'', position:'PG', age:19, height:null, weight:null, allocs:{}, background:'small_town', nationality:'USA', _backgrounds:null, _step:1, _pool:null };
}

function renderCreate(m) {
  const step = S.create._step || 1;
  const steps = [['Player','Name & position'],['Build','Height & weight'],['Skills','Allocate points'],['Draft','Draft night']];
  m.innerHTML = `
    <div class="max-w-2xl mx-auto">
      <div class="card p-4 mb-5" id="create-saves" style="display:none">
        <p class="text-sm font-semibold text-white mb-2">💾 Resume a career</p>
        <div id="create-saves-list" class="text-sm text-muted">Loading…</div>
      </div>
      ${S.player ? `
      <div class="card p-4 mb-5 border-warn/30 bg-warn/5">
        <p class="text-sm text-warn">⚠️ You already have a career in progress (<b>${esc(S.player.name)}</b>). Creating a new player will start over.</p>
        <button class="btn-secondary mt-2" onclick="switchTab('dashboard')">← Back to My Career</button>
      </div>` : ''}
      <div class="flex items-center gap-2 mb-8">
        ${steps.map((s,i)=>`
          <div class="step-dot ${i+1<step?'done':i+1===step?'current':''}">${i+1<step?'✓':i+1}</div>
          ${i<3?'<div class="step-line '+(i+1<step?'done':'')+'"></div>':''}
        `).join('')}
      </div>
      <div id="create-body"></div>
    </div>`;
  const body = $('#create-body');
  if (step===1) renderCreateStep1(body);
  else if (step===2) renderCreateStep2(body);
  else if (step===3) renderCreateStep3(body);
  else renderDraftNight(body);
  loadAllSaves();
}

async function loadAllSaves() {
  try {
    const wrap = $('#create-saves'), list = $('#create-saves-list');
    if (!wrap || !list) return;
    const players = await api('/players/all');
    const saves = await api('/saves/all').catch(() => ({ saves: [] }));
    const items = [];
    (players.players || []).forEach(p => {
      if (p.id === S.playerId) return;
      items.push(`<div class="flex items-center justify-between py-2 border-b border-bg-border last:border-0">
        <div><span class="text-white font-semibold">${esc(p.name)}</span>
        <span class="text-xs text-muted ml-2">${p.position} · ${esc(p.team)} · Year ${(p.experience||0)+1}</span></div>
        <div class="flex items-center gap-2">
          <button class="btn-primary !py-1 !px-3 text-xs" onclick="resumePlayer('${p.id}')">Resume</button>
          <button class="btn-danger !py-1 !px-2.5 text-xs" onclick="deletePlayer('${p.id}')">Delete</button>
        </div>
      </div>`);
    });
    (saves.saves || []).forEach(s => {
      items.push(`<div class="flex items-center justify-between py-2 border-b border-bg-border last:border-0">
        <div><span class="text-white font-semibold">${esc(s.player_name)}</span>
        <span class="text-xs text-muted ml-2">${s.player_position} · S${s.season_number} · save</span></div>
        <div class="flex items-center gap-2">
          <button class="btn-secondary !py-1 !px-2.5 text-xs" onclick="loadSaveFromInit('${s.id}')">Load</button>
          <button class="btn-danger !py-1 !px-2.5 text-xs" onclick="deleteSaveFromInit('${s.id}')">Delete</button>
        </div>
      </div>`);
    });
    if (!items.length) { wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    list.innerHTML = items.join('');
  } catch(e) { console.warn('loadAllSaves', e); }
}

async function resumePlayer(playerId) {
  S.playerId = playerId; localStorage.setItem('bball_pid', playerId);
  S.player = null; S.create._step = 1;
  await refreshSeason();
  await refreshPlayer();
  toast('Welcome back!','success');
  switchTab('dashboard');
}

async function loadSaveFromInit(saveId) {
  try {
    const r = await api(`/load-save/${saveId}`, { method:'POST' });
    S.playerId = r.player_id; localStorage.setItem('bball_pid', r.player_id);
    S.create._step = 1;
    await refreshSeason();
    S.player = null;
    await refreshPlayer();
    toast('Save loaded','success');
    switchTab('dashboard');
  } catch(e) { toast('Load failed: '+e.message,'error'); }
}

async function deleteSaveFromInit(saveId) {
  if (!confirm('Delete this save? This cannot be undone.')) return;
  try {
    await api(`/save/${saveId}`, { method:'DELETE' });
    toast('Save deleted','success'); loadAllSaves();
  } catch(e) { toast('Delete failed: '+e.message,'error'); }
}

async function deletePlayer(playerId) {
  if (!confirm('Delete this player and all their saves? This cannot be undone.')) return;
  try {
    await api(`/player/${playerId}`, { method:'DELETE' });
    toast('Player deleted','success'); loadAllSaves();
  } catch(e) { toast('Delete failed: '+e.message,'error'); }
}

function renderCreateStep1(m) {
  const positions = { PG:['Point Guard','🎯'], SG:['Shooting Guard','🔥'], SF:['Small Forward','⚡'], PF:['Power Forward','💪'], C:['Center','🏔️'] };
  m.innerHTML = `
    <div class="card p-6">
      <h2 class="text-xl font-bold text-white mb-1">Create Your Player</h2>
      <p class="text-sm text-muted mb-6">Choose your identity. Your position shapes your natural strengths.</p>
      <div class="space-y-5">
        <div>
          <label class="block text-sm font-semibold text-gray-200 mb-1.5">Player Name</label>
          <input id="c-name" type="text" placeholder="e.g. Victor Storm" value="${esc(S.create.name)}"
            class="w-full bg-bg border border-bg-border rounded-lg px-4 py-3 text-white placeholder-gray-600 focus:border-accent outline-none">
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-200 mb-1.5">Nationality</label>
          <select id="c-nat" class="w-full bg-bg border border-bg-border rounded-lg px-3 py-2.5 text-white outline-none">
            ${Object.entries(NATIONALITIES).map(([c,label])=>`<option value="${c}" ${S.create.nationality===c?'selected':''}>${label}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-200 mb-2">Position</label>
          <div class="grid grid-cols-5 gap-2">
            ${Object.entries(positions).map(([p,[label,icon]])=>`
              <button data-pos="${p}" class="pos-btn card ${S.create.position===p?'!border-accent !bg-accent/10':''} p-3 text-center card-hover">
                <div class="text-xl">${icon}</div>
                <div class="font-bold text-white text-sm">${p}</div>
                <div class="text-[10px] text-muted leading-tight mt-0.5">${label}</div>
              </button>`).join('')}
          </div>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-semibold text-gray-200 mb-1.5">Age</label>
            <select id="c-age" class="w-full bg-bg border border-bg-border rounded-lg px-3 py-2.5 text-white outline-none">
              ${[19,20,21,22,23].map(a=>`<option ${S.create.age===a?'selected':''}>${a}</option>`).join('')}
            </select>
          </div>
          <div class="flex items-end pb-1">
            <p class="text-[11px] text-faint">Older prospects are more polished but have less upside.</p>
          </div>
        </div>
        <div>
          <label class="block text-sm font-semibold text-gray-200 mb-1.5">Background / Origin Story</label>
          <p class="text-xs text-muted mb-2">Where you came from shapes your starting intangibles and ceiling.</p>
          <div class="grid grid-cols-1 gap-2" id="c-bg-list">
            <p class="text-xs text-faint">Loading backgrounds…</p>
          </div>
          <p class="text-xs text-faint mt-2" id="c-bg-desc"></p>
        </div>
      </div>
      <div class="mt-6 flex justify-end">
        <button class="btn-primary" id="c-next1">Continue →</button>
      </div>
    </div>`;
  $$('.pos-btn', m).forEach(b => b.onclick = () => { S.create.position = b.dataset.pos; $$('.pos-btn',m).forEach(x=>x.classList.remove('!border-accent','!bg-accent/10')); b.classList.add('!border-accent','!bg-accent/10'); });
  // Load & render background options.
  const renderBg = () => {
    const bgs = S.create._backgrounds;
    const list = $('#c-bg-list');
    if (!bgs || !list) return;
    list.innerHTML = Object.entries(bgs).map(([id,bg])=>`
      <button data-bg="${id}" class="bg-btn text-left card ${S.create.background===id?'!border-accent !bg-accent/10':''} p-3 card-hover">
        <span class="font-bold text-white">${bg.icon} ${esc(bg.label)}</span>
        <span class="block text-xs text-muted mt-0.5">${esc(bg.desc)}</span>
      </button>`).join('');
    $$('.bg-btn', list).forEach(b => b.onclick = () => {
      S.create.background = b.dataset.bg;
      $$('.bg-btn', list).forEach(x=>x.classList.remove('!border-accent','!bg-accent/10'));
      b.classList.add('!border-accent','!bg-accent/10');
      $('#c-bg-desc').textContent = 'Effects: ' + Object.entries(bgs[S.create.background].effects||{}).map(([k,v])=>`${k.replace(/_/g,' ')} ${v>0?'+':''}${v}`).join(', ');
    });
    $('#c-bg-desc').textContent = 'Effects: ' + Object.entries(bgs[S.create.background].effects||{}).map(([k,v])=>`${k.replace(/_/g,' ')} ${v>0?'+':''}${v}`).join(', ');
  };
  if (S.create._backgrounds) renderBg();
  else api('/player/backgrounds').then(d => { S.create._backgrounds = d.backgrounds; renderBg(); }).catch(()=>{ $('#c-bg-list').innerHTML = '<p class="text-xs text-faint">Backgrounds unavailable.</p>'; });
  $('#c-next1').onclick = () => {
    const name = $('#c-name').value.trim();
    if (!name) { toast('Please enter a name','warn'); return; }
    S.create.name = name; S.create.age = parseInt($('#c-age').value); S.create.nationality = $('#c-nat').value;
    S.create._step = 2; renderCreate($('#main'));
  };
}

function renderCreateStep2(m) {
  const pos = S.create.position;
  const profiles = { PG:[1.83,1.96,77,93], SG:[1.91,2.03,84,102], SF:[1.98,2.08,93,112], PF:[2.03,2.13,102,122], C:[2.08,2.21,109,136] };
  const [hlo,hhi,wlo,whi] = profiles[pos];
  if (!S.create.height) S.create.height = Math.round((hlo+hhi)/2*100)/100;
  if (!S.create.weight) S.create.weight = Math.round((wlo+whi)/2);
  m.innerHTML = `
    <div class="card p-6">
      <h2 class="text-xl font-bold text-white mb-1">Set Your Build</h2>
      <p class="text-sm text-muted mb-6">Height and weight affect your available skill points and physical profile.</p>
      <div class="space-y-6">
        <div>
          <div class="flex justify-between mb-2"><label class="text-sm font-semibold text-gray-200">Height</label><span class="mono text-accent font-bold" id="c-height-val">${S.create.height.toFixed(2)}m</span></div>
          <input type="range" id="c-height" min="${hlo}" max="${hhi}" step="0.01" value="${S.create.height}"
            class="w-full">
          <div class="flex justify-between text-[10px] text-faint mt-1"><span>${hlo}m</span><span>${hhi}m</span></div>
        </div>
        <div>
          <div class="flex justify-between mb-2"><label class="text-sm font-semibold text-gray-200">Weight</label><span class="mono text-accent font-bold" id="c-weight-val">${S.create.weight}kg</span></div>
          <input type="range" id="c-weight" min="${wlo}" max="${whi}" step="1" value="${S.create.weight}" class="w-full">
          <div class="flex justify-between text-[10px] text-faint mt-1"><span>${wlo}kg</span><span>${whi}kg</span></div>
        </div>
        <div class="bg-bg-hover border border-bg-border rounded-lg p-4">
          <p class="text-xs text-muted"><span class="text-white font-semibold">Build shapes your body:</span> Height nudges <b class="text-cyber">block</b>, <b class="text-cyber">rebound</b> and <b class="text-warn">speed</b>; weight nudges <b class="text-warn">strength</b> and <b class="text-warn">speed</b>. Pick the body that fits your game.</p>
        </div>
      </div>
      <div class="mt-6 flex justify-between">
        <button class="btn-secondary" id="c-back2">← Back</button>
        <button class="btn-primary" id="c-next2">Allocate Skills →</button>
      </div>
    </div>`;
  $('#c-height').oninput = e => { S.create.height = parseFloat(e.target.value); $('#c-height-val').textContent = S.create.height.toFixed(2)+'m'; };
  $('#c-weight').oninput = e => { S.create.weight = parseInt(e.target.value); $('#c-weight-val').textContent = S.create.weight+'kg'; };
  $('#c-back2').onclick = () => { S.create._step = 1; renderCreate($('#main')); };
  $('#c-next2').onclick = () => { S.create._step = 3; renderCreate($('#main')); };
}

function renderCreateStep3(m) {
  const cats = { athleticism:'⚡', scoring:'🎯', playmaking:'👁️', defense:'🛡️', mental:'🧠' };
  m.innerHTML = `
    <div class="card p-6">
      <div class="flex items-center justify-between mb-1">
        <h2 class="text-xl font-bold text-white">Allocate Skill Points</h2>
        <div class="text-right"><div class="text-2xl font-black text-accent mono" id="c-remaining">—</div><div class="text-[11px] text-muted" id="c-remaining-label">points remaining</div></div>
      </div>
      <p class="text-sm text-muted mb-1">Distribute your points across skill categories. Categories with higher natural aptitude are your position's strengths.</p>
      <p class="text-xs text-faint mb-5" id="c-pool-note">Loading…</p>
      <div class="space-y-3" id="c-cats"></div>
      <div class="mt-6 flex justify-between">
        <button class="btn-secondary" id="c-back3">← Back</button>
        <button class="btn-primary" id="c-next3">Go to Draft →</button>
      </div>
    </div>`;

  $('#c-back3').onclick = () => { S.create._step = 2; renderCreate($('#main')); };
  $('#c-next3').onclick = () => { S.create._step = 4; renderCreate($('#main')); };

  // Fetch point pool
  api(`/draft/point-pool?position=${S.create.position}&height=${S.create.height}&weight=${S.create.weight}`).then(pool => {
    S.create._pool = pool;
    $('#c-pool-note').textContent = `You have ${pool.total_points} points to distribute.`;

    const total = pool.total_points;
    // Initialize from aptitudes, then auto-balance to exactly `total` so the
    // player starts at 0 remaining and the next button is immediately enabled.
    if (Object.keys(S.create.allocs).length === 0) {
      S.create.allocs = { ...pool.aptitudes };
      let used = Object.values(S.create.allocs).reduce((a,b)=>a+b,0);
      let diff = total - used;
      const order = Object.keys(cats).sort((a,b)=>(S.create.allocs[b]||0)-(S.create.allocs[a]||0));
      let i = 0;
      while (diff !== 0 && i < 1000) {
        const cat = order[i % order.length];
        const cur = S.create.allocs[cat] || 0;
        if (diff > 0 && cur < 80) { S.create.allocs[cat] = cur + 1; diff--; }
        else if (diff < 0 && cur > 0) { S.create.allocs[cat] = cur - 1; diff++; }
        i++;
      }
    }

    // Build rows once; every interaction updates values in place (no re-render → no lag).
    $('#c-cats').innerHTML = Object.entries(cats).map(([cat,icon]) => {
      const apt = pool.aptitudes[cat] || 0;
      const isNatural = apt >= 40;
      return `
        <div class="bg-bg-hover border border-bg-border rounded-lg p-3" data-row="${cat}">
          <div class="flex items-center justify-between mb-1.5">
            <div class="flex items-center gap-2">
              <span>${icon}</span>
              <span class="text-sm font-semibold text-white">${cat.replace('_',' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>
              ${isNatural?'<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">natural fit</span>':''}
            </div>
            <span class="mono font-bold text-white" data-val="${cat}">${S.create.allocs[cat]||0}</span>
          </div>
          <div class="flex items-center gap-3">
            <button class="btn-secondary !px-2.5 !py-1" data-dec="${cat}">−</button>
            <input type="range" min="0" max="80" value="${S.create.allocs[cat]||0}" data-cat="${cat}" class="flex-1">
            <button class="btn-secondary !px-2.5 !py-1" data-inc="${cat}">+</button>
          </div>
        </div>`;
    }).join('');

    function updateRemaining() {
      const used = Object.values(S.create.allocs).reduce((a,b)=>a+b,0);
      const rem = total - used;
      const el = $('#c-remaining');
      el.textContent = rem;
      el.style.color = rem < 0 ? '#f87171' : rem === 0 ? '#34d399' : '#f59e0b';
      $('#c-remaining-label').textContent = rem === 0 ? '✓ ready' : rem > 0 ? `${rem} pts left to assign` : `${-rem} pts over — remove`;
      $('#c-next3').disabled = rem !== 0;
    }

    function setVal(cat, val) {
      S.create.allocs[cat] = Math.max(0, Math.min(80, val));
      const row = $(`[data-row="${cat}"]`, m);
      if (row) {
        row.querySelector('[data-val]').textContent = S.create.allocs[cat];
        row.querySelector('input[data-cat]').value = S.create.allocs[cat];
      }
      updateRemaining();
    }

    $$('input[data-cat]', m).forEach(sl => sl.oninput = e => setVal(e.target.dataset.cat, parseInt(e.target.value)));
    $$('button[data-inc]', m).forEach(b => b.onclick = () => setVal(b.dataset.inc, (S.create.allocs[b.dataset.inc]||0)+1));
    $$('button[data-dec]', m).forEach(b => b.onclick = () => setVal(b.dataset.dec, (S.create.allocs[b.dataset.dec]||0)-1));

    updateRemaining();
  });
}

function renderDraftNight(m) {
  m.innerHTML = `
    <div class="card p-8 text-center" id="draft-panel">
      <div class="text-5xl mb-3">🎟️</div>
      <h2 class="text-2xl font-bold text-white mb-2">NBA Draft Night</h2>
      <p class="text-muted mb-6">${esc(S.create.name)}, the draft is about to begin. Your combine results and college career will determine where you land.</p>
      <button class="btn-primary" id="draft-start">Enter the Draft</button>
    </div>`;
  $('#draft-start').onclick = async () => {
    $('#draft-panel').innerHTML = `<div class="py-10 text-center"><div class="spinner mx-auto mb-3"></div><p class="text-muted">Simulating draft combine & lottery…</p></div>`;
    // Create player
    try {
      const res = await api('/player/create', { method:'POST', body: JSON.stringify({
        name:S.create.name, position:S.create.position, age:S.create.age,
        height:S.create.height, weight:S.create.weight, allocations:S.create.allocs,
        luck_bonus: S.create._pool?.luck_bonus ?? null,
        background: S.create.background || 'small_town',
        nationality: S.create.nationality || 'USA'
      })});
      S.playerId = res.player_id; S.player = res.player; localStorage.setItem('bball_pid', res.player_id);
      await refreshSeason();
      // Run draft
      const draft = await api(`/draft/simulate/${S.playerId}`, { method:'POST' });
      resetCreate(); // the wizard is done — "New Game" should start a fresh save next time
      showDraftResult(draft);
    } catch(e) { toast('Draft failed: '+e.message,'error'); renderCreate($('#main')); }
  };
}

function ord(n) { const s=['th','st','nd','rd'], v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }

// Compact dimension summary shown right after the draft — the result, not the
// cause. It deliberately omits any "luck / height / weight / background" math.
function buildSummaryHTML() {
  const p = S.player || {};
  const avg = arr => Math.round(arr.reduce((a,b)=>a+(p[b]??50),0)/arr.length);
  const dims = [
    { icon:'🎯', label:'Scoring', v: avg(['first_step','finishing','mid_range','catch_shoot_3pt','pull_up_3pt','off_ball','drawing_fouls','free_throw']) },
    { icon:'🛡️', label:'Defense', v: avg(['perimeter_defense','help_defense','steal','rim_protection','box_out']) },
    { icon:'⚡', label:'Athleticism', v: avg(['vertical_jump','speed','lateral_quickness','strength','core_stability','stamina','durability']) },
    { icon:'👁️', label:'Playmaking', v: avg(['ball_security','pnr_vision','passing_accuracy']) },
    { icon:'🏀', label:'Rebounding', v: p.rebounding ?? 40 },
    { icon:'🧠', label:'Mental', v: avg(['bbiq','clutch_factor','work_ethic','leadership','composure']) },
  ];
  return `
    <div class="bg-bg-hover border border-bg-border rounded-lg p-4 mb-5 text-left">
      <div class="flex items-center justify-between mb-2">
        <p class="text-xs text-muted font-semibold">Your Build</p>
        <span class="text-sm font-black text-accent mono">OVR ${p.overall ?? '—'}</span>
      </div>
      ${dims.map(d=>`
        <div class="flex items-center gap-2 mb-1.5">
          <span class="w-28 text-xs text-muted shrink-0">${d.icon} ${d.label}</span>
          <div class="bar-track flex-1 h-2"><div class="bar-fill" style="width:${d.v}%;background:linear-gradient(90deg,#06b6d4,#f59e0b)"></div></div>
          <span class="mono text-xs text-white w-7 text-right">${d.v}</span>
        </div>`).join('')}
    </div>`;
}

function showDraftResult(draft) {
  if (draft.undrafted) {
    const top5 = (draft.top_prospects||[]).slice(0,5);
    $('#draft-panel').innerHTML = `
      <div class="py-2">
        <div class="text-6xl mb-3">🛤️</div>
        <h2 class="text-3xl font-black text-white mb-1">Went Undrafted</h2>
        <p class="text-accent font-bold text-lg mb-1">${draft.team}</p>
        <p class="text-muted text-sm mb-4">Two-Way Contract · $${draft.rookie_salary}M/yr</p>
        <div class="bg-bg-hover border border-bg-border rounded-lg p-4 mb-5 text-left">
          <p class="text-xs text-muted mb-2 font-semibold">Top 5 Picks This Year</p>
          ${top5.map((p,i)=>`
            <div class="flex justify-between text-sm py-1 ${i===0?'text-white font-semibold':'text-muted'}">
              <span>${i+1}. ${esc(p.name)}</span><span>${p.position} · OVR ${p.overall}</span>
            </div>`).join('')}
        </div>
        ${buildSummaryHTML()}
        <div class="flex gap-2 justify-center flex-wrap">
          <button class="btn-primary" onclick="switchTab('dashboard')">Start Your Journey →</button>
          <button class="btn-secondary" onclick="switchTab('attributes')">View Full Ratings</button>
        </div>
      </div>`;
    renderTabs(); renderHeader();
    return;
  }
  const round = draft.draft_round===1 ? '1st Round' : '2nd Round';
  const top5 = (draft.top_prospects||[]).slice(0,5);
  $('#draft-panel').innerHTML = `
    <div class="py-2">
      <div class="text-6xl mb-3">🎉</div>
      <h2 class="text-3xl font-black text-white mb-1">${ord(draft.draft_position)} Overall Pick</h2>
      <p class="text-accent font-bold text-lg mb-1">${draft.team}</p>
      <p class="text-muted text-sm mb-4">${round} · Rookie salary $${draft.rookie_salary}M/yr</p>
      <div class="bg-bg-hover border border-bg-border rounded-lg p-4 mb-5 text-left">
        <p class="text-xs text-muted mb-2 font-semibold">Top 5 Picks This Year</p>
        ${top5.map((p,i)=>`
          <div class="flex justify-between text-sm py-1 ${p.is_player?'text-accent font-bold':(i===0?'text-white font-semibold':'')}">
            <span>${i+1}. ${esc(p.name)} ${p.is_player?'⭐ YOU':''}</span><span class="${p.is_player?'text-accent':'text-muted'}">${p.position} · OVR ${p.overall}</span>
          </div>`).join('')}
      </div>
      ${buildSummaryHTML()}
      <div class="flex gap-2 justify-center flex-wrap">
        <button class="btn-primary" onclick="switchTab('dashboard')">Start Your Career →</button>
        <button class="btn-secondary" onclick="switchTab('attributes')">View Full Ratings</button>
      </div>
    </div>`;
  renderTabs(); renderHeader();
}

// ============================================================
// DASHBOARD
// ============================================================
async function renderRetired(m) {
  let c; try { c = await api(`/career/${S.playerId}`); } catch(e){ c = null; }
  const p = S.player;
  const goat = c?.goat_score||0;
  const tier = goat >= 75 ? 'Hall of Famer · G.O.A.T. candidate' : goat >= 45 ? 'Hall of Famer' : 'Retired from the NBA';
  const icon = goat >= 75 ? '🐐' : goat >= 45 ? '🏆' : '🕊️';
  const box = (l,v,c2)=>`<div class="card p-3 text-center"><div class="text-2xl font-black ${c2}">${v}</div><div class="text-[10px] text-muted">${l}</div></div>`;
  m.innerHTML = `
    <div class="space-y-5">
      <div class="card p-8 text-center border-accent/30">
        <div class="text-5xl mb-3">${icon}</div>
        <h2 class="text-3xl font-black text-white mb-1">${esc(p.name)} has retired</h2>
        <p class="text-muted mb-2">${tier} · ${esc(p.position)} · ${(p.experience||0)+1} seasons</p>
        <div class="text-5xl font-black text-accent">${goat.toFixed(1)}%</div>
        <p class="text-xs text-faint mt-1">G.O.A.T. Score</p>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">Career Legacy</h3>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
          ${box('Rings',c?.championships||0,'text-accent')}${box('MVPs',c?.mvps||0,'text-accent')}${box('All-NBA',c?.all_nba||0,'text-accent')}
          ${box('Games',c?.career_totals?.games||0,'text-white')}${box('Points',(c?.career_totals?.pts||0).toLocaleString(),'text-white')}${box('PPG',c?.career_averages?.ppg||0,'text-cyber')}
        </div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🏅 ${t('Awards')}</h3>
        <div class="flex flex-wrap gap-2">
          ${c?.awards?.length ? c.awards.map(a=>`<span class="px-3 py-1.5 rounded-full text-xs font-semibold bg-accent/10 text-accent border border-accent/30">S${a.season_number} · ${a.award_name}</span>`).join('') : '<span class="text-muted text-sm">No awards.</span>'}
        </div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🌅 Second Life</h3>
        <div id="second-life"></div>
      </div>
      <button class="btn-secondary" onclick="switchTab('career')">View Full Career →</button>
    </div>`;
  loadSecondLife();
}

async function loadSecondLife() {
  const el = $('#second-life'); if (!el) return;
  try {
    const r = await api(`/player/${S.playerId}/second-life`);
    if (r.chosen?.second_life) {
      el.innerHTML = `<p class="text-sm text-white">Now a ${r.chosen.second_life.replace(/_/g,' ')}.</p><p class="text-xs text-muted mt-1">Legacy score: <b class="text-accent">${(r.chosen.legacy_score||0).toFixed(1)}%</b></p>
        <button class="btn-secondary !py-1.5 !px-3 text-xs mt-2" onclick="advanceSecondLifeYear()">⏳ Advance a year</button>`;
      return;
    }
    el.innerHTML = r.options?.length ? `<p class="text-xs text-muted mb-3">What will you do with the rest of your life?</p>` +
      r.options.map(o=>`<button class="w-full text-left card card-hover p-3 mb-2 flex items-center justify-between" onclick="chooseSecondLife('${o.id}')">
        <span class="text-sm text-white">${o.icon} ${esc(o.label)}</span><span class="text-xs text-muted text-right max-w-[60%]">${esc(o.desc)}</span>
      </button>`).join('') : '<p class="text-muted text-sm">No second-life paths available.</p>';
  } catch(e) { el.innerHTML = '<p class="text-muted text-sm">—</p>'; }
}

async function advanceSecondLifeYear() {
  try {
    const r = await api(`/player/${S.playerId}/second-life-advance`, { method:'POST' });
    toast(`Year ${r.year} — +${r.fame} fame, +$${r.wealth.toFixed(1)}M (legacy ${r.legacy_score}%)`,'success');
    await refreshPlayer(); loadSecondLife();
  } catch(e) { toast('Failed: '+e.message,'error'); }
}

async function chooseSecondLife(path) {
  try {
    const r = await api(`/player/${S.playerId}/second-life?path=${encodeURIComponent(path)}`, { method:'POST' });
    await refreshPlayer();
    toast(`Second life: ${r.icon} ${r.label} — legacy ${r.legacy_score}%`,'success');
    renderRetired($('#main'));
  } catch(e) { toast('Failed: '+e.message,'error'); }
}

async function renderDashboard(m) {
  await refreshPlayer(); await refreshSeason();
  let ss = null; try { ss = await api(`/player/${S.playerId}/season-stats`); } catch(e){ console.warn('season-stats', e); }
  const p = S.player;
  // Real per-game injury chance (the engine applies injury_risk/100 * 0.045),
  // so we show the honest percentage instead of the raw 0-100 "proneness" number.
  const injPct = Math.round((p.injury_risk||0) * 0.045 * 10) / 10;
  const ctr = p.contract;
  const ctrLabel = ctr ? `💰 $${Number(ctr.annual_salary||0).toFixed(1)}M × ${ctr.years}y` : '💰 Free Agent';
  if (p.retired) { await renderRetired(m); return; }
  const retCard = p.retirement_pending ? `
    <div class="card p-5 border-accent/40 bg-accent/5">
      <h3 class="text-sm font-semibold text-accent mb-1">🕊️ Retirement Decision</h3>
      <p class="text-sm text-white mb-1">At ${p.age}, your body is telling you it might be time to walk away.</p>
      <p class="text-xs text-muted mb-4">Hang it up now and lock in your legacy — or run it back one more year and risk the toll it takes on your body.</p>
      <div class="flex gap-2 flex-wrap">
        <button class="btn-danger" onclick="resolveRetire('retire')">🕊️ Retire Now</button>
        <button class="btn-secondary" onclick="resolveRetire('one_more_year')">🏀 Play One More Year</button>
      </div>
    </div>` : '';
  const injCard = (p.injury_status && p.injury_games_remaining > 0 && !p.injury_treatment) ? `
      <div class="card p-5 border-bad/40 bg-bad/5">
        <h3 class="text-sm font-semibold text-bad mb-2">🏥 Injury Treatment</h3>
        <p class="text-xs text-muted mb-3">${t(p.injury_status)} — out ${p.injury_games_remaining} games. Choose how to handle it.</p>
        <div class="flex gap-2 flex-wrap">
          <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="applyTreatment('rest')">🛌 Rest (full recovery)</button>
          <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="applyTreatment('surgery')">🔪 Surgery (faster, −$1M)</button>
          <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="applyTreatment('play_through')">🏃 Play Through (risky)</button>
        </div>
      </div>` : '';
  const weekendCard = p.pending_weekend ? `
      <div class="card p-5 border-accent/40 bg-accent/5">
        <h3 class="text-sm font-semibold text-accent mb-1">🌟 All-Star Weekend</h3>
        <p class="text-xs text-muted mb-3">The league invited you to the All-Star events. What do you enter?</p>
        <div class="flex gap-2 flex-wrap">
          <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="resolveWeekend('dunk')">🛫 Dunk Contest</button>
          <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="resolveWeekend('three')">🎯 Three-Point Contest</button>
          <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="resolveWeekend('skip')">🛋️ Skip</button>
        </div>
      </div>` : '';
  const optionCard = p.pending_option ? `
      <div class="card p-5 border-cyber/40 bg-cyber/5">
        <h3 class="text-sm font-semibold text-cyber mb-1">📄 Player Option</h3>
        <p class="text-xs text-muted mb-3">Your contract has a player option on the final year. Exercise it, or test free agency?</p>
        <div class="flex gap-2 flex-wrap">
          <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="resolveOption('exercise')">✅ Exercise (one more year)</button>
          <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="resolveOption('decline')">🚪 Decline (free agency)</button>
        </div>
      </div>` : '';
  const tm = S.teams?.[p.team_id];
  const teamCard = tm ? `
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🏀 ${t('Team Overview')} — ${esc(tm.name)}</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><div class="text-xs text-muted">${t('Overall')}</div><div class="font-bold text-white">${tm.ovr} <span class="text-[10px] text-muted">(${t(p.team_tier||'')})</span></div></div>
          <div><div class="text-xs text-muted">${t('Offense')}</div><div class="font-bold text-accent">${tm.off}</div></div>
          <div><div class="text-xs text-muted">${t('Defense')}</div><div class="font-bold text-cyber">${tm.def}</div></div>
          <div><div class="text-xs text-muted">${t('Record')}</div><div class="font-bold text-white">${ss?.team_wins||0}-${ss?.team_losses||0}</div></div>
          <div><div class="text-xs text-muted">${t('Conference')}</div><div class="font-bold text-white">${t(tm.conf)}</div></div>
          <div><div class="text-xs text-muted">${t('Division')}</div><div class="font-bold text-white">${t(tm.div)}</div></div>
          <div><div class="text-xs text-muted">${t('Chemistry')}</div><div class="font-bold ${p.chemistry>=60?'text-good':p.chemistry>=45?'text-warn':'text-bad'}">${p.chemistry}</div></div>
          <div><div class="text-xs text-muted">${t('Your Role')}</div><div class="font-bold text-white">${t(p.role)}</div></div>
        </div>
      </div>` : '';
  const phaseLabel = (S.season?.current_phase||'regular_season').replace('_',' ');
  const gamesDone = S.season?.games_played_in_season||0;

  // Primary next-action based on phase
  const phase = S.season?.current_phase||'regular_season';
  const pi = phaseInfo();
  let action = '';
  let secondary = '';
  if (p.draft_pick === 0 && (p.draft_year || 0) === 0) action = `<button class="btn-primary" onclick="switchTab('create')">🎟️ Simulate Draft</button>`;
  else if (phase === 'offseason') {
    if (p.free_agent) {
      action = `<button class="btn-primary" onclick="switchTab('offcourt')">🏀 Review Free-Agency Offers</button>`;
    } else {
      action = `<button class="btn-primary" onclick="switchTab('training')">💪 Train This Offseason</button>`;
      secondary = `<button class="btn-secondary" onclick="advanceToNextSeason()">➡️ Advance to Next Season</button>`;
    }
  }
  else if (phase === 'playoffs') action = `<button class="btn-primary" onclick="switchTab('game')">🏆 Play Playoff Game</button>`;
  else if (gamesDone >= 82) action = `<button class="btn-primary" onclick="finalizeSeason()">🏁 Finalize Season</button>`;
  else action = `<button class="btn-primary" onclick="switchTab('game')">🏟️ Play Next Game</button>`;
  if (p.retirement_pending) { action = ''; secondary = ''; }

  m.innerHTML = `
    <div class="space-y-5">
      ${retCard}
      <div class="card p-4 flex items-center justify-between flex-wrap gap-3">
        <div><span class="text-sm font-semibold text-gray-300">🎮 ${t('Game Mode')}</span> <span class="text-xs text-faint ml-1">${t(S.season?.game_mode==='story'?'more story, fewer games':S.season?.game_mode==='sandbox'?'edit attributes to test builds':'balanced default')}</span></div>
        <div class="flex gap-2 items-center">
          ${['story','classic','sandbox'].map(m=>`<button class="btn-ghost !py-1 !px-2.5 text-xs ${(S.season?.game_mode||'classic')===m?'!text-accent':''}" onclick="setGameMode('${m}')">${t(m[0].toUpperCase()+m.slice(1))}</button>`).join('')}
          <span class="text-bg-border">|</span>
          <button class="btn-ghost !py-1 !px-2.5 text-xs ${(S.season?.lang||'en')==='en'?'!text-accent':''}" onclick="setLang('en')">EN</button>
          <button class="btn-ghost !py-1 !px-2.5 text-xs ${(S.season?.lang||'en')==='zh'?'!text-accent':''}" onclick="setLang('zh')">中文</button>
        </div>
      </div>
      <!-- Identity + Next action -->
      <div class="card p-6">
        <div class="flex items-start justify-between flex-wrap gap-4">
          <div>
            <p class="text-xs mono text-muted uppercase tracking-wider">${p.team_name} (${p.team_tier||'—'}) · ${p.position} · ${p.draft_pick?`#${p.draft_pick} pick`:'Undrafted'}</p>
            <h2 class="text-3xl font-black text-white mt-1">${esc(p.name)}</h2>
            <div class="flex gap-2 mt-2 flex-wrap text-xs">
              <span class="px-2 py-1 rounded-full bg-bg-hover border border-bg-border text-muted">${t('Age')} ${p.age}</span>
              <span class="px-2 py-1 rounded-full bg-bg-hover border border-bg-border text-muted">${p.height}m / ${p.weight}kg</span>
              <span class="px-2 py-1 rounded-full bg-bg-hover border border-bg-border text-muted">${t('Year')} ${p.experience+1}</span>
              <span class="px-2 py-1 rounded-full bg-accent/15 text-accent border border-accent/30">${t(p.role)}</span>
              <span class="px-2 py-1 rounded-full bg-cyber/15 text-cyber border border-cyber/30">OVR ${p.overall}</span>
              <span class="px-2 py-1 rounded-full bg-bg-hover border border-bg-border text-muted" title="Growth archetype">${t(GROWTH_LABELS[p.growth] || GROWTH_LABELS.steady)}</span>
              <span class="px-2 py-1 rounded-full bg-bg-hover border border-bg-border text-muted">${t(p.tier||'—')}</span>
              <span class="px-2 py-1 rounded-full bg-bg-hover border border-bg-border text-muted">${ctrLabel}</span>
            </div>
          </div>
          <div class="flex gap-4">
            <div class="text-center"><div class="text-2xl font-black text-accent">${ss?.ppg??'—'}</div><div class="text-[10px] text-muted">PPG</div></div>
            <div class="text-center"><div class="text-2xl font-black text-cyber">${ss?.rpg??'—'}</div><div class="text-[10px] text-muted">RPG</div></div>
            <div class="text-center"><div class="text-2xl font-black text-purple-400">${ss?.apg??'—'}</div><div class="text-[10px] text-muted">APG</div></div>
          </div>
        </div>
      </div>

      <!-- Team overview -->
      ${teamCard}

      <!-- Next action (primary) -->
      <div class="card p-5 flex items-center justify-between flex-wrap gap-3 border-accent/30">
        <div>
          <p class="text-xs text-muted uppercase tracking-wider">${pi.icon} ${pi.label}</p>
          <p class="text-white font-semibold mt-0.5">${nextActionText()}</p>
          <p class="text-xs text-faint mt-1">${pi.desc}</p>
        </div>
        <div class="flex gap-2 flex-wrap">${action}${secondary}</div>
      </div>

      <!-- Status -->
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Player Status')}</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          ${meter(t('Fatigue'),'⚡',p.fatigue,100,'#f59e0b')}
          ${meter(t('Morale'),'😊',p.morale,100,'#34d399')}
          <div><div class="flex justify-between text-xs mb-1.5"><span class="text-muted">🩹 ${t('Injury Risk')}</span><span class="mono text-gray-200">${injPct}%</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, injPct*25)}%;background:#f87171"></div></div><p class="text-[10px] text-faint mt-1">${t('chance per game')}</p></div>
          ${meter(t('Clout'),'👑',p.clout,100,'#06b6d4')}
        </div>
      </div>

      <!-- Season progress -->
      ${injCard}
      ${weekendCard}
      ${optionCard}
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Season')} ${S.season?.current_season||1} ${t('Progress')}</h3>
        <div class="bar-track h-3 mb-2"><div class="bar-fill" style="width:${Math.min(100,(gamesDone/82)*100)}%;background:linear-gradient(90deg,#f59e0b,#fbbf24)"></div></div>
        <div class="flex justify-between text-xs text-muted">
          <span>${gamesDone}/82 games</span><span>${phaseLabel}</span><span>${ss?.team_wins||0}-${ss?.team_losses||0}</span>
        </div>
      </div>

      <!-- Recent games -->
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Recent Games')}</h3>
        <div id="dash-games">Loading…</div>
      </div>
    </div>`;

  function nextActionText() {
    if (p.retirement_pending) return 'Your retirement decision is pending — choose above.';
    if (p.draft_pick === 0 && (p.draft_year || 0) === 0) return 'Complete your draft to begin your career.';
    if (phase === 'offseason') return p.free_agent ? 'You are a free agent — sign a contract before the next season.' : t('Train once to improve, then advance to next season.');
    if (phase === 'playoffs') return `Playoffs — series ${S.season?.series_wins||0}-${S.season?.series_losses||0}. Play the next game.`;
    if (gamesDone >= 82) return 'All 82 games played — finalize to see your awards.';
    if (p.injury_status) return `Injured: ${t(p.injury_status)} (${p.injury_games_remaining} games left). Games simulate without you.`;
    return `Next up: Game ${gamesDone+1} of 82.`;
  }

  try {
    const logs = await api(`/game/logs/${S.playerId}?limit=5`);
    cacheGames(logs.games);
    $('#dash-games').innerHTML = logs.games.length ? logs.games.map(g=>`
      <div class="flex items-center gap-3 py-2 border-b border-bg-border text-sm cursor-pointer hover:bg-bg-hover" onclick="showGameDetailCached(${g.id})">
        <span class="w-7 font-bold ${g.result==='W'?'text-good':'text-bad'}">${g.result}</span>
        <span class="flex-1">${t('vs')} ${S.teams?.[g.opponent_team_id]?.name||'Team '+g.opponent_team_id}</span>
        <span class="mono text-white font-semibold w-8 text-right">${g.pts}</span>
        <span class="text-muted w-8 text-right">${g.reb}r</span>
        <span class="text-muted w-8 text-right">${g.ast}a</span>
        <span class="text-faint mono text-xs w-16 text-right">${g.minutes}min</span>
      </div>`).join('') : emptyState('No games yet','Head to Play Game to get started.');
  } catch(e) { $('#dash-games').innerHTML = '<p class="text-muted text-sm">Error</p>'; }
}

function meter(label, icon, val, max, color) {
  const pct = Math.round(val/max*100);
  return `<div><div class="flex justify-between text-xs mb-1.5"><span class="text-muted">${icon} ${label}</span><span class="mono text-gray-200">${Math.round(val)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div></div>`;
}

function emptyState(title, sub) {
  return `<div class="text-center py-8 text-muted"><p class="font-semibold text-gray-300">${title}</p><p class="text-xs mt-1">${sub}</p></div>`;
}

// ============================================================
// ATTRIBUTES
// ============================================================
async function renderAttributes(m) {
  let a; try { a = await api(`/player/${S.playerId}/attributes`); } catch(e){ return m.innerHTML='<p class="text-bad">Error</p>'; }
  const tier = v => v>=90?'#fbbf24':v>=80?'#c084fc':v>=70?'#22d3ee':v>=55?'#4ade80':v>=40?'#8b8ba3':'#f87171';
  const DEVELOPABLE = new Set(['mid_range','catch_shoot_3pt','pull_up_3pt','finishing','first_step','free_throw','ball_security','pnr_vision','passing_accuracy','perimeter_defense','help_defense','steal','box_out','rebounding','vertical_jump','speed','lateral_quickness','strength','stamina','bbiq','composure']);
  const isSandbox = S.season?.game_mode === 'sandbox';
  const group = (title, note, obj) => `
    <div class="card p-5">
      <h3 class="text-sm font-semibold text-gray-300 mb-1">${title}</h3>
      ${note?`<p class="text-xs text-faint mb-3">${note}</p>`:''}
      <div class="space-y-2">
        ${Object.entries(obj).map(([k,v])=>`
          <div><div class="flex justify-between text-xs mb-1"><span class="text-muted">${k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span><span class="mono font-bold" style="color:${tier(v)}">${v}${isSandbox&&DEVELOPABLE.has(k)?` <button class="text-cyber hover:underline" onclick="editAttr('${k}')">✏️</button>`:''}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${v}%;background:${tier(v)}"></div></div></div>`).join('')}
      </div>
    </div>`;
  m.innerHTML = `
    <div class="space-y-5">
      <div class="card p-5 flex items-center justify-between flex-wrap gap-3">
        <div><h2 class="text-lg font-bold text-white">Attribute Matrix</h2><p class="text-xs text-muted">Static physicals are permanent. Dynamic & skills can be developed.</p></div>
        <button class="btn-secondary" onclick="switchTab('training')">💪 Train to Improve</button>
      </div>
      <div class="card p-5 border-cyber/20">
        <h3 class="text-sm font-semibold text-gray-300 mb-1">📐 How Ratings Work</h3>
        <p class="text-xs text-faint mb-3">Your overall rating is a weighted blend, and each skill feeds specific on-court actions — so you can plan a build instead of guessing.</p>
        <div class="grid md:grid-cols-2 gap-4 text-xs">
          <div>
            <p class="font-semibold text-muted mb-1">Overall rating</p>
            <div class="space-y-0.5 text-gray-300">
              <div>🎯 Scoring <span class="text-cyber mono">35%</span></div>
              <div>🛡️ Defense <span class="text-cyber mono">20%</span></div>
              <div>⚡ Athleticism <span class="text-cyber mono">20%</span></div>
              <div>🎪 Playmaking <span class="text-cyber mono">15%</span></div>
              <div>🧠 Mental <span class="text-cyber mono">10%</span></div>
            </div>
          </div>
          <div>
            <p class="font-semibold text-muted mb-1">Key skill → action</p>
            <div class="space-y-0.5 text-gray-300">
              <div>catch_shoot_3pt → catch-and-shoot 3%</div>
              <div>pull_up_3pt → pull-up 3%</div>
              <div>finishing + first_step → drives & iso</div>
              <div>steal → steal chance</div>
              <div>rim_protection → block chance</div>
              <div>rebounding → board chance</div>
            </div>
          </div>
        </div>
      </div>
      <div class="grid md:grid-cols-2 gap-5">
        ${group('🔒 Static Physicals','Fixed at creation — cannot be changed.', a.static)}
        ${group('⚡ Athleticism','Trainable; declines with age.', a.athleticism)}
        ${group('🎯 Scoring', null, a.scoring)}
        ${group('🛡️ Defense', null, a.defense)}
        ${group('🏀 Rebounding','Drives board-crashing and second-chance opportunities.', a.rebounding)}
        ${group('🎪 Playmaking', null, a.playmaking)}
        ${group('🧠 Mental','Grows with experience.', a.mental)}
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🎭 Tactical Role</h3>
        <p class="text-xs text-muted mb-3">Determines your usage rate and play style on the court.</p>
        <div class="flex flex-wrap gap-2">
          ${['Ball-Dominant Creator','Off-Ball Finisher','Rim Protector','Two-Way Wing','3-and-D Specialist','Point Forward','Stretch Big','Defensive Anchor'].map(r=>`
            <button class="btn-secondary ${S.player.role===r?'!bg-accent/15 !text-accent !border-accent/40':''}" onclick="setRole('${r}')">${r}</button>`).join('')}
        </div>
      </div>
      <div class="card p-5 border-cyber/20">
        <h3 class="text-sm font-semibold text-gray-300 mb-1">📈 Development Focus</h3>
        <p class="text-xs text-muted mb-3">Pick one attribute to accelerate. Your focus gets priority during mid-season development spurts (which also depend on your potential and work ethic).</p>
        <div class="flex items-center gap-3 flex-wrap">
          <select id="focus-select" class="bg-bg border border-bg-border rounded-lg px-3 py-2 text-sm text-white outline-none">
            <option value="">— No focus (balanced growth) —</option>
          </select>
          <button class="btn-secondary" onclick="setFocus()">Set Focus</button>
        </div>
        <p class="text-xs text-faint mt-2" id="focus-current"></p>
      </div>
    </div>`;
  loadFocus();
}

async function loadFocus() {
  try {
    const f = await api(`/player/${S.playerId}/focus`);
    const sel = $('#focus-select'); if (!sel) return;
    sel.innerHTML = `<option value="">— No focus (balanced growth) —</option>` +
      f.options.map(a=>`<option value="${a}" ${f.dev_focus===a?'selected':''}>${a.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('');
    $('#focus-current').textContent = f.dev_focus ? `Current focus: ${f.dev_focus.replace(/_/g,' ')}` : 'No focus set.';
  } catch(e){ console.warn('loadFocus', e); }
}

async function setFocus() {
  const attr = $('#focus-select')?.value || '';
  try {
    const r = await api(`/player/${S.playerId}/focus?attr=${encodeURIComponent(attr)}`, { method:'PUT' });
    toast(attr ? `Focus set to ${attr.replace(/_/g,' ')}` : 'Focus cleared','success');
    loadFocus();
  } catch(e){ toast('Failed: '+e.message,'error'); }
}

async function setGameMode(mode) {
  await api(`/settings/${S.playerId}?mode=${mode}`, { method:'PUT' });
  await refreshSeason();
  toast(`Game mode: ${mode}`, 'success');
  switchTab('dashboard');
}

async function setLang(lang) {
  await api(`/settings/${S.playerId}?lang=${lang}`, { method:'PUT' });
  await refreshSeason();
  toast(lang === 'zh' ? '语言已切换为中文' : 'Language set to English', 'success');
  switchTab('dashboard');
}

async function editAttr(attr) {
  const val = prompt(`Set ${attr.replace(/_/g,' ')} (10-99):`);
  if (val == null) return;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 10 || n > 99) { toast('Value must be 10-99.', 'warn'); return; }
  await api(`/player/${S.playerId}/attribute?attr=${attr}&value=${n}`, { method:'PUT' });
  toast(`${attr.replace(/_/g,' ')} set to ${n}`, 'success');
  await refreshPlayer();
  switchTab('attributes');
}

async function setRole(role) {
  await api(`/player/${S.playerId}/role?role=${encodeURIComponent(role)}`, { method:'PUT' });
  S.player.role = role; toast(`Role set to ${role}`,'success'); switchTab('attributes');
}

// ============================================================
// SEASON
// ============================================================
async function renderSeason(m) {
  let ss, logs, sums;
  try { [ss, logs, sums] = await Promise.all([
    api(`/player/${S.playerId}/season-stats`), api(`/game/logs/${S.playerId}?limit=12`), api(`/season/summaries/${S.playerId}`)
  ]); } catch(e){ return m.innerHTML='<p class="text-bad">Error</p>'; }
  cacheGames(logs.games);
  const gamesDone = S.season?.games_played_in_season||0;
  const box = (label,val,color) => `<div class="card p-3 text-center"><div class="text-xl font-black ${color}">${val}</div><div class="text-[10px] text-muted">${label}</div></div>`;
  m.innerHTML = `
    <div class="space-y-5">
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-4">Season ${S.season?.current_season||1} Averages</h3>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
          ${box('PPG',ss.ppg,'text-accent')}${box('RPG',ss.rpg,'text-cyber')}${box('APG',ss.apg,'text-purple-400')}
          ${box('SPG',ss.spg,'text-good')}${box('BPG',ss.bpg,'text-bad')}${box('MPG',ss.mpg,'text-gray-200')}
        </div>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-3 mt-3">
          ${box('FG%',(ss.fg_pct*100).toFixed(1)+'%','text-white')}${box('3P%',(ss.tp_pct*100).toFixed(1)+'%','text-white')}
          ${box('FT%',(ss.ft_pct*100).toFixed(1)+'%','text-white')}${box('TOV',ss.topg,'text-muted')}
          ${box('Team W',ss.team_wins,'text-good')}${box('Team L',ss.team_losses,'text-bad')}
        </div>
        <div class="mt-3 pt-3 border-t border-bg-border">
          <p class="text-[10px] text-faint mb-2">Per-36 — every stat scaled to 36 minutes, so players with different minutes are comparable.</p>
          <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
            ${box('P36 PPG',ss.per36.ppg,'text-accent')}${box('P36 RPG',ss.per36.rpg,'text-cyber')}${box('P36 APG',ss.per36.apg,'text-purple-400')}
            ${box('P36 SPG',ss.per36.spg,'text-good')}${box('P36 BPG',ss.per36.bpg,'text-bad')}${box('P36 TOV',ss.per36.topg,'text-muted')}
          </div>
        </div>
      </div>

      ${ss.playoffs && ss.playoffs.games>0 ? `
      <div class="card p-5 border-accent/20">
        <h3 class="text-sm font-semibold text-gray-300 mb-4">🏆 Playoff Averages (${ss.playoffs.games} games)</h3>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
          ${box('PPG',ss.playoffs.ppg,'text-accent')}${box('RPG',ss.playoffs.rpg,'text-cyber')}${box('APG',ss.playoffs.apg,'text-purple-400')}
          ${box('SPG',ss.playoffs.spg,'text-good')}${box('BPG',ss.playoffs.bpg,'text-bad')}${box('MPG',ss.playoffs.mpg,'text-gray-200')}
        </div>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-3 mt-3">
          ${box('FG%',(ss.playoffs.fg_pct*100).toFixed(1)+'%','text-white')}${box('3P%',(ss.playoffs.tp_pct*100).toFixed(1)+'%','text-white')}
          ${box('FT%',(ss.playoffs.ft_pct*100).toFixed(1)+'%','text-white')}${box('TOV',ss.playoffs.topg,'text-muted')}
          ${box('Team W',ss.playoffs.team_wins,'text-good')}${box('Team L',ss.playoffs.team_losses,'text-bad')}
        </div>
      </div>`:''}

      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">📈 ${t('Recent Scoring')}</h3>
        <div class="h-56"><canvas id="season-chart"></canvas></div>
      </div>

      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🎯 ${t('Shot Profile')}</h3>
        <p class="text-xs text-faint mb-3">Where your field-goal attempts come from this season.</p>
        <div class="h-56"><canvas id="shot-profile-chart"></canvas></div>
      </div>

      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Game Log')}</h3>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead><tr class="text-muted border-b border-bg-border text-left">
              <th class="py-2 pr-2">#</th><th class="pr-2">Opp</th><th class="pr-2">W/L</th><th class="pr-2">MIN</th><th class="pr-2">PTS</th><th class="pr-2">REB</th><th class="pr-2">AST</th><th class="pr-2">STL</th><th class="pr-2">BLK</th><th class="pr-2">FG</th><th class="pr-2">3P</th><th class="pr-2" title="Team scoring margin, not on-court plus/minus">±</th>
            </tr></thead>
            <tbody>${logs.games.map(g=>`
              <tr class="border-b border-bg-border hover:bg-bg-hover cursor-pointer" onclick="showGameDetailCached(${g.id})">
                <td class="py-1.5 pr-2 text-faint">${g.game_number}</td>
                <td class="pr-2">${S.teams?.[g.opponent_team_id]?.abbr||'T'+g.opponent_team_id}</td>
                <td class="pr-2 font-bold ${g.result==='W'?'text-good':'text-bad'}">${g.result}</td>
                <td class="pr-2 mono">${g.minutes}</td>
                <td class="pr-2 font-bold text-white">${g.pts}</td>
                <td class="pr-2">${g.reb}</td><td class="pr-2">${g.ast}</td><td class="pr-2">${g.stl}</td><td class="pr-2">${g.blk}</td>
                <td class="pr-2 text-muted">${g.fgm}/${g.fga}</td><td class="pr-2 text-muted">${g.tpm}/${g.tpa}</td>
                <td class="mono ${g.plus_minus>0?'text-good':g.plus_minus<0?'text-bad':'text-muted'}">${g.plus_minus>0?'+':''}${g.plus_minus}</td>
              </tr>`).join('')||`<tr><td colspan="12" class="py-4 text-center text-muted">No games yet</td></tr>`}</tbody>
          </table>
        </div>
      </div>

      ${sums.seasons.length?`
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Season History')}</h3>
        <div class="overflow-x-auto"><table class="w-full text-xs">
          <thead><tr class="text-muted border-b border-bg-border text-left">
            <th class="py-2 pr-2">S</th><th class="pr-2">PPG</th><th class="pr-2">RPG</th><th class="pr-2">APG</th><th class="pr-2">PER</th><th class="pr-2">WS</th><th class="pr-2">Record</th><th class="pr-2">Playoffs</th><th>Awards</th>
          </tr></thead>
          <tbody>${sums.seasons.map(su=>`
            <tr class="border-b border-bg-border hover:bg-bg-hover">
              <td class="py-1.5 pr-2 font-bold text-accent">${su.season_number}</td>
              <td class="pr-2 font-bold text-white">${su.ppg}</td><td class="pr-2">${su.rpg}</td><td class="pr-2">${su.apg}</td>
              <td class="pr-2 mono">${su.per}</td><td class="pr-2">${su.ws}</td>
              <td class="pr-2">${su.team_wins}-${su.team_losses}</td><td class="pr-2 text-xs">${su.playoff_result||'—'}</td>
              <td class="text-xs text-accent">${(JSON.parse(su.awards||'[]')).join(', ')||'—'}</td>
            </tr>`).join('')}</tbody>
        </table></div>
      </div>`:''}

      ${gamesDone >= 82 ? `<button class="btn-secondary" onclick="finalizeSeason()">🏁 Finalize Season (into Offseason)</button>` : ''}
    </div>`;
  renderSeasonChart(logs.games);
  renderShotProfileChart(ss.shot_profile);
}

function renderSeasonChart(games) {
  if (!games || games.length < 2) {
    const el = $('#season-chart'); if (el) el.parentElement.innerHTML = '<p class="text-muted text-sm">Play a few games to see your scoring trend.</p>';
    return;
  }
  const chrono = games.slice().reverse();
  renderLineChart('season-chart', chrono.map(g => 'G' + g.game_number), [
    { label: 'Points', data: chrono.map(g => g.pts), borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.12)', tension: 0.3, pointRadius: 2, fill: true },
  ]);
}

async function finalizeSeason() {
  if (!confirm('Finalize the season? This calculates awards, applies aging, and moves you into the offseason.')) return;
  try {
    const r = await api(`/season/finalize/${S.playerId}`, { method:'POST' });
    await refreshPlayer(); await refreshSeason();
    let msg = `Season finalized! ${r.awards.length?'Awards: '+r.awards.join(', '):'No awards this season.'}`;
    if (r.year_settlement) {
      const earned = (r.year_settlement.salary_earned||0) + (r.year_settlement.endorsement_income||0);
      if (earned > 0) msg += ` Earned $${earned.toFixed(2)}M this season.`;
    }
    toast(msg,'success');
    switchTab('dashboard');
  } catch(e) { toast('Error: '+e.message,'error'); }
}

async function applyTreatment(option) {
  try {
    const r = await api(`/player/${S.playerId}/injury-treatment?option=${option}`, { method:'POST' });
    toast(r.message, 'info'); await refreshPlayer(); renderDashboard($('#main'));
  } catch(e){ toast('Failed: '+e.message,'error'); }
}

async function resolveRetire(choice) {
  try {
    const r = await api(`/player/${S.playerId}/retire?choice=${choice}`, { method:'POST' });
    await refreshPlayer(); await refreshSeason();
    if (r.retired) { toast('Career over — thanks for the memories.','success'); }
    else { toast('One more year! The body will pay a toll.','warn'); }
    switchTab('dashboard');
  } catch(e) { toast('Failed: '+e.message,'error'); }
}

async function resolveWeekend(choice) {
  if (choice === 'skip') {
    const r = await api(`/season/allstar-weekend/${S.playerId}?choice=skip`, { method:'POST' });
    toast(r.message, 'info');
    await refreshPlayer(); renderDashboard($('#main'));
    return;
  }
  try {
    const opts = await api(`/season/allstar-weekend-options/${S.playerId}`);
    const items = choice === 'dunk' ? opts.dunks : opts.spots;
    const title = choice === 'dunk' ? '🛫 Dunk Contest — pick your dunk' : '🎯 Three-Point Contest — pick your spot';
    const overlay = document.createElement('div');
    overlay.id = 'weekend-modal';
    overlay.className = 'fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
    overlay.innerHTML = `<div class="card p-5 w-full max-w-md">
      <h3 class="text-lg font-bold text-white mb-3">${title}</h3>
      <div class="space-y-2">
        ${items.map(it=>`<button class="w-full text-left card card-hover p-3" onclick="resolveWeekendAction('${choice}','${it.id}')">
          <div class="flex items-center justify-between"><span class="text-white font-semibold">${it.icon} ${it.label}</span><span class="text-xs text-warn mono">${choice==='dunk'?'difficulty '+it.difficulty.toFixed(1):''}</span></div>
          <span class="text-xs text-muted">${esc(it.desc)}</span>
        </button>`).join('')}
      </div>
    </div>`;
    document.body.appendChild(overlay);
  } catch(e) { toast('Failed: '+e.message,'error'); }
}

async function resolveWeekendAction(choice, action) {
  document.getElementById('weekend-modal')?.remove();
  const r = await api(`/season/allstar-weekend/${S.playerId}?choice=${choice}&action=${action}`, { method:'POST' });
  toast(r.message, 'success');
  await refreshPlayer(); renderDashboard($('#main'));
}

async function resolveOption(choice) {
  try {
    const r = await api(`/contract/player-option/${S.playerId}?choice=${choice}`, { method:'POST' });
    toast(r.message, choice==='exercise'?'success':'warn');
    await refreshPlayer(); renderDashboard($('#main'));
  } catch(e) { toast('Failed: '+e.message,'error'); }
}

async function advanceToNextSeason() {
  if (S.player?.retirement_pending) { toast('Resolve your retirement decision first.','warn'); return; }
  if (S.player?.free_agent) { toast('You are a free agent — sign a contract first.','warn'); switchTab('offcourt'); return; }
  if (!confirm('Advance to the next season? Make sure you\'ve done your offseason training first.')) return;
  try {
    await api(`/season/advance-phase?player_id=${S.playerId}`, { method:'POST' });
    await refreshPlayer(); await refreshSeason();
    toast('New season started!','success');
    switchTab('dashboard');
  } catch(e) { toast('Error: '+e.message,'error'); }
}

// ============================================================
// PLAY GAME
// ============================================================
const TACTIC_DESC = {
  defense: {
    balanced: 'No adjustment.',
    lockdown_star: 'Opponent scoring ×0.94, their 3-pt attempts ×1.25.',
    protect_paint: 'Opponent scoring ×0.95, their 3-pt attempts ×1.4.',
    switch_everything: 'Opponent scoring ×0.96, their assists ×0.7, you fatigue +5.',
  },
  offense: {
    balanced: 'No adjustment.',
    push_pace: 'Possessions +16, you fatigue +5, both teams score more.',
    grind_halfcourt: 'Possessions −12, turnovers ×0.8, fatigue −4.',
    three_heavy: 'Your 3-pt attempts ×1.5, 2-pt ×0.9.',
  },
};

async function setTactics(type, value) {
  const def = type === 'defense' ? value : (S.player.tactics_defense || 'balanced');
  const off = type === 'offense' ? value : (S.player.tactics_offense || 'balanced');
  try {
    await api(`/player/${S.playerId}/tactics?defense=${def}&offense=${off}`, { method:'PUT' });
    if (type === 'defense') S.player.tactics_defense = value; else S.player.tactics_offense = value;
    const el = type === 'defense' ? $('#g-tdef-desc') : $('#g-toff-desc');
    if (el) el.textContent = TACTIC_DESC[type][value];
  } catch(e) { toast('Failed to save tactics: '+e.message, 'error'); }
}

async function renderGame(m) {
  await refreshPlayer(); await refreshSeason();
  const gamesDone = S.season?.games_played_in_season||0;
  const phase = S.season?.current_phase||'regular_season';
  const seasonComplete = gamesDone >= 82;

  // Fetch the league schedule so we can show the upcoming opponents.
  let sched = null;
  try { sched = await api(`/season/schedule/${S.player.team_id}?player_id=${S.playerId}`); } catch(e){ console.warn('schedule', e); }
  const upcoming = (sched?.schedule||[]).slice(gamesDone, gamesDone+5);
  const next = upcoming[0];
  let ss = null; try { ss = await api(`/player/${S.playerId}/season-stats`); } catch(e){ console.warn('season-stats', e); }
  const tdef = S.player.tactics_defense || 'balanced';
  const toff = S.player.tactics_offense || 'balanced';

  // Phase gating: no games during the offseason or once the season is done.
  if (phase === 'offseason') {
    m.innerHTML = `
      <div class="card p-8 text-center">
        <div class="text-5xl mb-3">🌅</div>
        <h3 class="text-xl font-bold text-white mb-2">${t('It\'s the Offseason')}</h3>
        <p class="text-muted mb-5">${t('No games are played now. Spend your training slot to improve, then advance to next season.')}</p>
        <button class="btn-primary" onclick="switchTab('training')">${t('💪 Go to Training')}</button>
      </div>`;
    return;
  }
  if (phase === 'playoffs') {
    const st = S.season || {};
    const rn = ['', 'First Round', 'Conf Semis', 'Conf Finals', 'NBA Finals'];
    const opp = S.teams?.[st.playoff_opponent];
    const gameN = (st.series_wins||0) + (st.series_losses||0) + 1;
    const higherIsHome = [1,2,5,7].includes(gameN);
    const playerHigher = (st.player_seed||9) < (st.opponent_seed||9);
    const venue = (higherIsHome ? playerHigher : !playerHigher) ? `@ ${S.player.team_abbr}` : `@ ${opp?.abbr||'OPP'}`;
    m.innerHTML = `
      <div class="space-y-5">
        <div class="card p-6 text-center border-accent/30">
          <div class="text-4xl mb-2">🏆</div>
          <div class="text-xs mono text-muted uppercase tracking-wider mb-1">NBA Playoffs · ${rn[st.playoff_round]||'Playoffs'}</div>
          <h3 class="text-lg font-bold text-white mb-1">#${st.player_seed||'?'} ${S.player.team_name} vs #${st.opponent_seed||'?'} ${opp?.name||'Opponent'}</h3>
          <p class="text-xs text-faint mb-3">Game ${gameN} · ${venue}</p>
          <div class="flex justify-center items-center gap-6 mb-3">
            <div class="text-center"><div class="text-4xl font-black text-accent">${st.series_wins||0}</div><div class="text-[10px] text-muted">${S.player.team_abbr}</div></div>
            <span class="text-muted font-bold text-xl">—</span>
            <div class="text-center"><div class="text-4xl font-black text-white">${st.series_losses||0}</div><div class="text-[10px] text-muted">${opp?.abbr||'OPP'}</div></div>
          </div>
          <p class="text-sm text-muted mb-4">Best of 7 — first to 4 wins.</p>
          <button class="btn-primary text-lg px-8" id="g-pg">🏀 Play Playoff Game</button>
        </div>
        <div class="card p-5">
          <h3 class="text-sm font-semibold text-gray-300 mb-1">🔍 Opponent Scouting Report</h3>
          <p class="text-xs text-faint mb-3">Their current strength and key players — this changes as the league evolves.</p>
          <div id="g-scout">Loading…</div>
        </div>
        <div id="g-result"></div>
      </div>`;
    $('#g-pg').onclick = () => simPlayoffGame($('#g-pg'));
    loadScoutingReport(st.playoff_opponent);
    return;
  }
  if (seasonComplete) {
    m.innerHTML = `
      <div class="card p-8 text-center">
        <div class="text-5xl mb-3">🏁</div>
        <h3 class="text-xl font-bold text-white mb-2">${t('Regular Season Complete')}</h3>
        <p class="text-muted mb-5">${t('All 82 games are done. Finalize the season to calculate your awards and move into the offseason.')}</p>
        <button class="btn-primary" onclick="finalizeSeason()">${t('🏁 Finalize Season')}</button>
      </div>`;
    return;
  }

  const oppName = next ? next.opponent_name : '—';
  const oppOvr = next ? next.opponent_ovr : '—';
  m.innerHTML = `
    <div class="space-y-5">
      <div class="card p-6 text-center">
        <div class="text-xs mono text-muted uppercase tracking-wider mb-1" id="g-gamenum">${t('Regular Season')} · ${t('Game')} ${gamesDone+1} ${t('of')} 82</div>
        <h3 class="text-lg font-bold text-white mb-4">${t('Next Game')}</h3>
        <div class="flex items-center justify-center gap-5 mb-1">
          <div class="text-center">
            <div class="font-bold text-white text-lg">${S.player.team_name}</div>
            <div class="text-xs text-muted">${t('You')} · ${t(S.player.role)}</div>
          </div>
          <span class="text-2xl font-black text-muted">${t('vs')}</span>
          <div class="text-center">
            <div class="font-bold text-white text-lg">${oppName}</div>
            <div class="text-xs text-muted">OVR ${oppOvr}</div>
          </div>
        </div>
        ${S.player.injury_status ? `<div class="mt-2 text-sm text-bad">🏥 ${t(S.player.injury_status)} — out ${S.player.injury_games_remaining} game(s)</div>` : ''}
        <div class="flex gap-3 justify-center flex-wrap mt-4">
          <button class="btn-primary text-lg px-8" id="g-sim">🏀 Play Game</button>
          <button class="btn-secondary" id="g-batch5">Sim 5</button>
          <button class="btn-secondary" id="g-batch10">Sim 10</button>
          ${gamesDone < 41 ? `<button class="btn-secondary" id="g-batch-asg">⭐ Sim to All-Star</button>` : ''}
          <button class="btn-secondary" id="g-batch-end">🏁 Sim to End</button>
        </div>
        <label class="flex items-center justify-center gap-2 mt-4 text-sm text-muted cursor-pointer">
          <input type="checkbox" ${S.player.load_management?'checked':''} id="g-load">
          Load Management (fewer minutes, less fatigue & injury risk)
        </label>
        <p class="text-xs text-faint mt-3" id="g-progress">Team Record: <b class="text-white">${ss?.team_wins||0}-${ss?.team_losses||0}</b> · ${gamesDone}/82 games played</p>
      </div>

      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-1">🎯 Game Plan</h3>
        <p class="text-xs text-faint mb-3">Choose your approach before you play. Each is a trade-off — nothing is free.</p>
        <div class="grid md:grid-cols-2 gap-4">
          <div>
            <label class="text-xs font-semibold text-muted">Defense</label>
            <select id="g-tdef" class="w-full mt-1 bg-card border border-bg-border text-white rounded-lg p-2 text-sm">
              <option value="balanced" ${tdef==='balanced'?'selected':''}>Balanced</option>
              <option value="lockdown_star" ${tdef==='lockdown_star'?'selected':''}>Lock Down Their Star</option>
              <option value="protect_paint" ${tdef==='protect_paint'?'selected':''}>Protect the Paint</option>
              <option value="switch_everything" ${tdef==='switch_everything'?'selected':''}>Switch Everything</option>
            </select>
            <p class="text-[11px] text-faint mt-1" id="g-tdef-desc">${TACTIC_DESC.defense[tdef]}</p>
          </div>
          <div>
            <label class="text-xs font-semibold text-muted">Offense</label>
            <select id="g-toff" class="w-full mt-1 bg-card border border-bg-border text-white rounded-lg p-2 text-sm">
              <option value="balanced" ${toff==='balanced'?'selected':''}>Balanced</option>
              <option value="push_pace" ${toff==='push_pace'?'selected':''}>Push the Pace</option>
              <option value="grind_halfcourt" ${toff==='grind_halfcourt'?'selected':''}>Grind the Half-Court</option>
              <option value="three_heavy" ${toff==='three_heavy'?'selected':''}>Three-Heavy</option>
            </select>
            <p class="text-[11px] text-faint mt-1" id="g-toff-desc">${TACTIC_DESC.offense[toff]}</p>
          </div>
        </div>
      </div>

      ${upcoming.length ? `
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Upcoming Schedule')}</h3>
        <div class="space-y-1">
          ${upcoming.map((g,i)=>`
            <div class="flex items-center justify-between py-2 ${i===0?'text-white':'text-muted'} border-b border-bg-border last:border-0">
              <span class="text-sm">${i===0?'▶ ':''}${t('Game')} ${gamesDone+i+1} · ${t('vs')} ${g.opponent_name}</span>
              <span class="text-xs mono ${g.opponent_ovr>=80?'text-cyber':g.opponent_ovr>=70?'text-gray-300':'text-faint'}">OVR ${g.opponent_ovr}</span>
            </div>`).join('')}
        </div>
        <p class="text-xs text-faint mt-3">Opponents follow a standard NBA-style schedule — they're assigned, not chosen.</p>
      </div>` : ''}
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">📅 ${t('Season')} ${S.season?.current_season||1} ${t('Progress')}</h3>
        <div id="g-season-bar" class="mb-2"></div>
        <div class="bar-track h-2"><div class="bar-fill" style="width:${Math.min(100,(gamesDone/82)*100)}%;background:linear-gradient(90deg,#f59e0b,#fbbf24)"></div></div>
        <p class="text-[10px] text-faint mt-1" id="g-progress">Team Record: <b class="text-white">${ss?.team_wins||0}-${ss?.team_losses||0}</b> · ${gamesDone}/82 games played</p>
      </div>
      <div id="g-result"></div>
    </div>`;

  // Render the 82-game color bar (green=win, red=loss, gray=not played).
  try {
    const logs = await api(`/game/logs/${S.playerId}?season=${S.season?.current_season||1}&limit=82`);
    const byNum = {};
    (logs.games||[]).forEach(g => byNum[g.game_number] = g.result);
    const bar = $('#g-season-bar');
    if (bar) {
      bar.innerHTML = `<div style="display:flex;gap:1px;flex-wrap:wrap">${Array.from({length:82}, (_,i) => {
        const r = byNum[i+1];
        const bg = r === 'W' ? '#34d399' : r === 'L' ? '#f87171' : '#232336';
        return `<div style="width:8px;height:8px;border-radius:2px;background:${bg}" title="Game ${i+1}${r ? ': '+r : ''}"></div>`;
      }).join('')}</div>`;
    }
  } catch(e) {}

  $('#g-sim').onclick = () => simGame($('#g-sim'));
  $('#g-batch5').onclick = (e) => simBatch(5, e.currentTarget);
  $('#g-batch10').onclick = (e) => simBatch(10, e.currentTarget);
  const asgBtn = $('#g-batch-asg'); if (asgBtn) asgBtn.onclick = (e) => simBatch(Math.max(0, 41 - gamesDone), e.currentTarget);
  $('#g-batch-end').onclick = (e) => simBatch(Math.max(0, 82 - gamesDone), e.currentTarget);
  $('#g-load').onchange = e => { api(`/player/${S.playerId}/load-management?enabled=${e.target.checked}`,{method:'PUT'}); S.player.load_management=e.target.checked; };
  $('#g-tdef').onchange = e => setTactics('defense', e.target.value);
  $('#g-toff').onchange = e => setTactics('offense', e.target.value);
}

async function simGame(btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Simulating…';
  try {
    const r = await api(`/game/simulate/${S.playerId}`, { method:'POST' });
    $('#g-result').innerHTML = gameResult(r);
    if (r.passive_trade) toast(`🔁 Traded to ${r.passive_trade.to} — ${r.passive_trade.reason}.`,'warn');
    await refreshPlayer(); await refreshSeason(); renderHeader(); await refreshGameProgress();
  } catch(e) { toast('Failed: '+e.message,'error'); }
  finally { btn.disabled = false; btn.innerHTML = '🏀 Play Game'; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Pick a localized string from an {en, zh} pair (or pass through a plain string).
function pick(v, lang) {
  if (v && typeof v === 'object' && !Array.isArray(v) && ('en' in v || 'zh' in v)) return v[lang] || v.en || '';
  return v;
}
// UI i18n dictionary — every player-facing string in one place. Extend freely.
const UI = {
  // tabs
  'New Game':       { zh: '新游戏' },
  'Dashboard':      { zh: '仪表盘' },
  'Attributes':     { zh: '属性' },
  'Season':         { zh: '赛季' },
  'Play Game':      { zh: '比赛' },
  'Training':       { zh: '训练' },
  'Career':         { zh: '生涯' },
  'Off-Court':      { zh: '场外' },
  'League':         { zh: '联盟' },
  'Save':           { zh: '存档' },
  // header
  'Create a player first': { zh: '请先创建球员' },
  'Regular Season': { zh: '常规赛' },
  'Offseason':      { zh: '休赛期' },
  'Playoffs':       { zh: '季后赛' },
  // dashboard
  'Team Overview':  { zh: '球队概览' },
  'Overall':        { zh: '综合' },
  'Offense':        { zh: '进攻' },
  'Defense':        { zh: '防守' },
  'Record':         { zh: '战绩' },
  'Conference':     { zh: '分区' },
  'Division':       { zh: '赛区' },
  'East':           { zh: '东部' },
  'West':           { zh: '西部' },
  'Atlantic':       { zh: '大西洋' },
  'Southeast':      { zh: '东南' },
  'Central':        { zh: '中部' },
  'Southwest':      { zh: '西南' },
  'Northwest':      { zh: '西北' },
  'Pacific':        { zh: '太平洋' },
  'Chemistry':      { zh: '化学反应' },
  'Your Role':      { zh: '场上角色' },
  'Morale':         { zh: '士气' },
  'Fatigue':        { zh: '疲劳' },
  'Injury Risk':    { zh: '伤病风险' },
  'Games Played':   { zh: '已赛' },
  'Team Record':    { zh: '球队战绩' },
  'PPG':            { zh: '场均得分' },
  'RPG':            { zh: '场均篮板' },
  'APG':            { zh: '场均助攻' },
  'SPG':            { zh: '场均抢断' },
  'BPG':            { zh: '场均盖帽' },
  'MPG':            { zh: '场均时间' },
  'PTS':            { zh: '得分' },
  'REB':            { zh: '篮板' },
  'AST':            { zh: '助攻' },
  'STL':            { zh: '抢断' },
  'BLK':            { zh: '盖帽' },
  'TOV':            { zh: '失误' },
  'PF':             { zh: '犯规' },
  'MIN':            { zh: '分钟' },
  'EFF':            { zh: '效率' },
  'PER':            { zh: 'PER' },
  'GmSc':           { zh: '比赛评分' },
  'Game Mode':      { zh: '游戏模式' },
  'NBA Draft':      { zh: 'NBA 选秀' },
  // gameplay
  'Play Game':      { zh: '进行比赛' },
  'Sim 5':          { zh: '模拟5场' },
  'Sim 10':         { zh: '模拟10场' },
  'Sim to All-Star':{ zh: '模拟至全明星' },
  'Sim to End':     { zh: '模拟至结束' },
  'Load Management':{ zh: '负荷管理' },
  'Finalize Season':{ zh: '结算赛季' },
  'Game Plan':      { zh: '赛前战术' },
  'Defense':        { zh: '防守' },
  'Offense':        { zh: '进攻' },
  'Simulating…':    { zh: '模拟中…' },
  'Done':           { zh: '完成' },
  'Paused':         { zh: '已暂停' },
  // training
  'Offseason Training': { zh: '休赛期训练' },
  'Training Complete': { zh: '训练完成' },
  '1 slot available': { zh: '1个槽位可用' },
  'Selected':       { zh: '已选' },
  // career
  'G.O.A.T. Tracker': { zh: 'GOAT 追踪' },
  'Career Totals':  { zh: '生涯总计' },
  'Career Averages':{ zh: '生涯场均' },
  'Career Highs':   { zh: '生涯最高' },
  'Career Trajectory': { zh: '生涯曲线' },
  'Playoff Career': { zh: '季后赛生涯' },
  'All-Time Records': { zh: '历史纪录' },
  'Awards':         { zh: '荣誉' },
  'Career Timeline':{ zh: '生涯时间线' },
  'Season History': { zh: '赛季历史' },
  'Championships':  { zh: '总冠军' },
  'MVPs':           { zh: 'MVP' },
  'All-NBA':        { zh: '最佳阵容' },
  'Seasons':        { zh: '赛季数' },
  'Games':          { zh: '出场' },
  'Points':         { zh: '总得分' },
  'Rebounds':       { zh: '总篮板' },
  'Assists':        { zh: '总助攻' },
  'Steals':         { zh: '总抢断' },
  'Blocks':         { zh: '总盖帽' },
  'GOAT':           { zh: 'GOAT' },
  // league
  'Standings':      { zh: '排名' },
  "League's Best Players": { zh: '联盟最佳球员' },
  'MVP Race':       { zh: 'MVP 竞争' },
  'Stat Leaders':   { zh: '数据领袖' },
  'League Moves':   { zh: '联盟动态' },
  // off-court
  'Media':          { zh: '媒体' },
  'Endorsements':   { zh: '代言' },
  'Signature Shoe': { zh: '签名鞋' },
  'Commercial Tour':{ zh: '商业巡回' },
  'International Play': { zh: '国际赛事' },
  'Investments':    { zh: '投资' },
  'Lifestyle':      { zh: '生活方式' },
  'Life & Relationships': { zh: '人生与关系' },
  'Locker Room':    { zh: '更衣室' },
  'Influence':      { zh: '影响力' },
  'Demand Trade':   { zh: '要求交易' },
  'Request Buyout': { zh: '请求买断' },
  // game page
  'Game':           { zh: '第' },
  'of':             { zh: '/' },
  'Next Game':      { zh: '下一场比赛' },
  'You':            { zh: '你' },
  'Upcoming Schedule': { zh: '接下来的赛程' },
  'Load Management':{ zh: '负荷管理' },
  'fewer minutes, less fatigue & injury risk': { zh: '减少上场时间，降低疲劳和伤病风险' },
  'Team Record':    { zh: '球队战绩' },
  'games played':   { zh: '场比赛' },
  'It\'s the Offseason': { zh: '现在是休赛期' },
  'No games are played now. Spend your training slot to improve, then advance to next season.': { zh: '现在不打比赛。花你的训练槽来提升，然后推进到下赛季。' },
  '💪 Go to Training': { zh: '💪 去训练' },
  'Regular Season Complete': { zh: '常规赛结束' },
  'All 82 games are done. Finalize the season to calculate your awards and move into the offseason.': { zh: '82场比赛全部结束。结算赛季来计算你的荣誉，进入休赛期。' },
  '🏁 Finalize Season': { zh: '🏁 结算赛季' },
  'Opponent Scouting Report': { zh: '对手侦察报告' },
  'Load Management': { zh: '负荷管理' },
  'Recent Scoring': { zh: '近期得分' },
  'Shot Profile':   { zh: '出手分布' },
  'Game Log':       { zh: '比赛记录' },
  'Saved Games':    { zh: '已存档' },
  'Career Legacy':  { zh: '生涯遗产' },
  'Second Life':    { zh: '第二人生' },
  'No media right now.': { zh: '现在没有媒体采访。' },
  'No international tournament this offseason.': { zh: '本休赛期没有国际赛事。' },
  'Trained this offseason': { zh: '本休赛期已训练' },
  'Player Status':  { zh: '球员状态' },
  'Recent Games':   { zh: '近期比赛' },
  'chance per game':{ zh: '每场伤病概率' },
  'Clout':          { zh: '影响力' },
  'Hot':            { zh: '火热' },
  'Cold':           { zh: '冰冷' },
  // game mode
  'Story':          { zh: '故事' },
  'Classic':        { zh: '经典' },
  'Sandbox':        { zh: '沙盒' },
  'more story, fewer games': { zh: '更多故事，更少比赛' },
  'edit attributes to test builds': { zh: '编辑属性，测试搭配' },
  'balanced default': { zh: '平衡默认' },
  // player info
  'Age':            { zh: '年龄' },
  'Year':           { zh: '第' },
  'years old':      { zh: '岁' },
  // roles
  'Ball-Dominant Creator': { zh: '持球进攻核心' },
  'Off-Ball Finisher': { zh: '无球终结者' },
  'Rim Protector':  { zh: '护框者' },
  'Two-Way Wing':   { zh: '攻防兼备侧翼' },
  '3-and-D Specialist': { zh: '三分防守专家' },
  'Point Forward':  { zh: '持球前锋' },
  'Stretch Big':    { zh: '空间型大个' },
  'Defensive Anchor': { zh: '防守核心' },
  // tiers
  'Superstar':      { zh: '超级巨星' },
  'All-Star':       { zh: '全明星' },
  'Starter':        { zh: '首发' },
  'Rotation':       { zh: '轮换' },
  'Bench':          { zh: '替补' },
  'Fringe':         { zh: '边缘' },
  'Title Contender':{ zh: '争冠球队' },
  'Playoff Team':   { zh: '季后赛球队' },
  'Play-In Fringe': { zh: '附加赛边缘' },
  'Lottery / Rebuild': { zh: '摆烂重建' },
  // growth archetypes
  'Prodigy':        { zh: '天才' },
  'Steady':         { zh: '稳健' },
  'Late Bloomer':   { zh: '晚成' },
  'Ageless':        { zh: '不老' },
  'Fizzle':         { zh: '昙花一现' },
  // phase info
  'Offseason':      { zh: '休赛期' },
  'Playoffs':       { zh: '季后赛' },
  'Train once to improve, then advance to next season.': { zh: '训练一次提升自己，然后推进到下赛季。' },
  'Train once, then advance to the next season.': { zh: '训练一次，然后推进到下赛季。' },
  'Season':         { zh: '赛季' },
  'Progress':       { zh: '进度' },
  'games':          { zh: '场比赛' },
  // injuries
  'Minor sprain':   { zh: '轻微扭伤' },
  'Moderate strain': { zh: '中度拉伤' },
  'Serious sprain': { zh: '严重扭伤' },
  'Major injury':   { zh: '重大伤病' },
  'Season-ending injury': { zh: '赛季报销' },
  'Personal matter': { zh: '个人事务' },
  // off-court descriptions
  'No media right now.': { zh: '现在没有媒体采访。' },
  'No international tournament this offseason.': { zh: '本休赛期没有国际赛事。' },
  'Media shows up when you do something big — 50+ points, a triple-double, a broken record, an All-Star nod.': { zh: '媒体会在你干出大事时出现——50+分、三双、破纪录、全明星入选。' },
  'Available during the offseason.': { zh: '仅休赛期可用。' },
  'You\'ve already used your offseason (training, tour, or international play).': { zh: '你已使用了休赛期（训练、巡回或国际赛事）。' },
  // new game
  'No games yet':   { zh: '暂无比赛' },
  'Head to Play Game to get started.': { zh: '前往比赛页面开始。' },
  // stat labels
  'PTS':            { zh: '得分' },
  'REB':            { zh: '篮板' },
  'AST':            { zh: '助攻' },
  'STL':            { zh: '抢断' },
  'BLK':            { zh: '盖帽' },
  'TOV':            { zh: '失误' },
  'PF':             { zh: '犯规' },
  'MIN':            { zh: '分钟' },
  'FG':             { zh: '命中' },
  '3PT':            { zh: '三分' },
  'FT':             { zh: '罚球' },
  // retired
  'Retired':        { zh: '已退役' },
  'Choose a Second Life': { zh: '选择你的第二人生' },
  'Begin Retirement': { zh: '开始退役' },
  // career page
  'Who You Are':    { zh: '你是什么样的人' },
  'records held':   { zh: '保持纪录' },
  // growth labels
  '🌟 Prodigy':     { zh: '🌟 天才' },
  '📈 Steady':      { zh: '📈 稳健' },
  '🌱 Late Bloomer': { zh: '🌱 大器晚成' },
  '⏳ Aging Gracefully': { zh: '⏳ 优雅老去' },
  '💨 Flash in the Pan': { zh: '💨 昙花一现' },
  // attributes
  'Attribute Matrix': { zh: '属性矩阵' },
  'Static Physicals are permanent. Dynamic & skills can be developed.': { zh: '身体静态无法改变。运动能力与技能可以提升。' },
  'Train to Improve': { zh: '训练提升' },
  'Fixed at creation — cannot be changed.': { zh: '创建时固定——无法更改。' },
  'Drives board-crashing and second-chance opportunities.': { zh: '驱动拼抢篮板和二次进攻。' },
  'Grows with experience.': { zh: '随经验增长。' },
  'Tactical Role':  { zh: '战术角色' },
  'Determines your usage rate and play style on the court.': { zh: '决定你在场上的使用率和打法风格。' },
  'Development Focus': { zh: '发展重心' },
  'Pick one attribute to accelerate. Your focus gets priority during mid-season development spurts (which also depend on your potential and work ethic).': { zh: '选一个属性优先发展。赛季中期的成长突进会优先考虑你的重心（也取决于你的潜力和工作态度）。' },
  // training
  'Offseason Training': { zh: '休赛期训练' },
  '1 slot available': { zh: '1个槽位可用' },
  'You\'ve already used your offseason (training or a tour). One or the other.': { zh: '你已使用了休赛期（训练或巡回）。二选一。' },
  'Training is only available during the offseason.': { zh: '训练仅在休赛期可用。' },
  'Apply Training Plan': { zh: '执行训练计划' },
  'Selected':       { zh: '已选' },
  'Slot':           { zh: '槽位' },
  'gains':          { zh: '收益' },
  'full':           { zh: '完整' },
  'Risk':           { zh: '风险' },
  'Training Complete': { zh: '训练完成' },
  // career
  'G.O.A.T. Tracker': { zh: 'GOAT 追踪' },
  'Rings':          { zh: '总冠军' },
  'All-NBA':        { zh: '最佳阵容' },
  'Career Totals':  { zh: '生涯总计' },
  'Career Averages':{ zh: '生涯场均' },
  'Career Highs':   { zh: '生涯最高' },
  '📈 Career Trajectory': { zh: '📈 生涯曲线' },
  'Playoff Career': { zh: '季后赛生涯' },
  'All-Time Records': { zh: '历史纪录' },
  'Single-game':    { zh: '单场' },
  'Single-season':  { zh: '单季' },
  'Awards':         { zh: '荣誉' },
  'Career Timeline':{ zh: '生涯时间线' },
  'Season History': { zh: '赛季历史' },
  // league
  'Standings':      { zh: '排名' },
  'Records update as the season progresses. Your team shows your actual record; other teams are projections.': { zh: '随着赛季进行更新战绩。你的球队显示真实战绩，其他球队是预测。' },
  "League's Best Players": { zh: '联盟最佳球员' },
  'The rest of the NBA develops, ages, and turns over every offseason.': { zh: 'NBA的其他球员每年休赛期都在成长、老去、更替。' },
  'MVP Race':       { zh: 'MVP 竞争' },
  'How you stack up against the league\'s stars this season.': { zh: '你本赛季与联盟球星的对比。' },
  'Stat Leaders':   { zh: '数据领袖' },
  'Points / rebounds / assists / steals / blocks — your real numbers vs the league\'s stars.': { zh: '得分 / 篮板 / 助攻 / 抢断 / 盖帽——你的真实数据 vs 联盟球星。' },
  'League Moves':   { zh: '联盟动态' },
  'Trades and free-agent signings from the last offseason.': { zh: '上个休赛期的交易和自由球员签约。' },
  // off-court
  'Media':          { zh: '媒体' },
  'Endorsements':   { zh: '代言' },
  'Signature Shoe': { zh: '签名鞋' },
  'Commercial Tour':{ zh: '商业巡回' },
  'Spend your offseason growing your global brand instead of training — one or the other.': { zh: '用你的休赛期扩大全球品牌影响力——与训练二选一。' },
  'International Play': { zh: '国际赛事' },
  'In a tournament year, you can represent your country — national glory, but it costs your training slot.': { zh: '在大赛年，你可以代表国家出战——为国争光，但会占用训练槽。' },
  'Investments':    { zh: '投资' },
  'Lifestyle':      { zh: '生活方式' },
  'Life & Relationships': { zh: '人生与关系' },
  'The people around you. Healthy bonds steady your game; broken ones rattle it.': { zh: '你身边的人。健康的关系稳定你的比赛；破裂的关系动摇它。' },
  'Locker Room':    { zh: '更衣室' },
  'Your teammates and how you gel with them. Wins bring the room together; losses and selfishness fray it.': { zh: '你的队友和你们的默契。胜利让更衣室团结；失败和自私让它瓦解。' },
  // saves
  'Saves':          { zh: '存档' },
  'Export Career':  { zh: '导出生涯' },
  // create wizard
  'Create Your Player': { zh: '创建你的球员' },
  'Choose your identity. Your position shapes your natural strengths.': { zh: '选择你的身份。你的位置塑造你的天然优势。' },
  'Player Name':    { zh: '球员名' },
  'e.g. Victor Storm': { zh: '例如：Victor Storm' },
  'Nationality':    { zh: '国籍' },
  'Position':       { zh: '位置' },
  'Age':            { zh: '年龄' },
  'Older prospects are more polished but have less upside.': { zh: '年龄更大的新秀更成熟，但上限更低。' },
  'Background / Origin Story': { zh: '出身背景' },
  'Where you came from shapes your starting intangibles and ceiling.': { zh: '你的出身塑造你的初始心智属性和天花板。' },
  'Continue →':     { zh: '继续 →' },
  'NBA Draft Night':{ zh: 'NBA 选秀之夜' },
  'Enter the Draft':{ zh: '参加选秀' },
  // global
  'Back':           { zh: '返回' },
  'Loading…':       { zh: '加载中…' },
  'Error':          { zh: '错误' },
  'vs':             { zh: '对' },
  'point':          { zh: '分' },
  'rebounds':       { zh: '篮板' },
  'assists':        { zh: '助攻' },
  'No awards yet.': { zh: '暂无荣誉。' },
  'No games yet':   { zh: '暂无比赛' },
  'Head to Play Game to get started.': { zh: '前往比赛页面开始。' },
  'Could not load data.': { zh: '无法加载数据。' },
};
function t(s) { const lang = S.season?.lang || 'en'; const entry = UI[s]; const result = (entry && (entry[lang] || s)) || s; return result; }

function tickerLine(g) {
  const b = g.box_score || {};
  const flags = [];
  if (g.records_broken?.length) flags.push('🏆RECORD');
  if (g.franchise_record) flags.push('🏛️FRANCHISE');
  if (g.personal_record) flags.push('📈HIGH');
  if (g.life_intro) flags.push('👥');
  if (g.all_star) flags.push('⭐All-Star');
  if (g.injury) flags.push('🏥'+g.injury.type);
  if (g.passive_trade) flags.push('🔁traded');
  if (g.development) flags.push('📈dev');
  if (g.event) flags.push('📰');
  return `<div class="flex items-center gap-2 py-0.5 border-b border-bg-border last:border-0">
    <span class="mono text-faint w-7 shrink-0">G${g.game_number}</span>
    <span class="font-bold w-5 shrink-0 ${g.result==='W'?'text-good':'text-bad'}">${g.result}</span>
    <span class="mono text-white w-14 shrink-0">${g.team_score}-${g.opponent_score}</span>
    <span class="text-muted w-9 shrink-0">${g.opponent_abbr}</span>
    <span class="mono text-gray-300">${b.pts}p ${b.reb}r ${b.ast}a ${b.stl}s ${b.blk}b</span>
    <span class="text-[10px] text-faint flex-1 text-right">${flags.join(' ')}</span>
  </div>`;
}

function showPauseModal(paused) {
  document.getElementById('pause-modal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'pause-modal';
  overlay.className = 'fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `<div class="card p-5 w-full max-w-md border-accent/40">
    <h3 class="text-lg font-bold text-white mb-1">⏸️ ${paused.label}</h3>
    <p class="text-sm text-muted mb-4">${paused.message}</p>
    <div class="flex gap-2">
      <button class="btn-primary flex-1" onclick="resolvePause('${paused.type}')">Handle now</button>
      <button class="btn-secondary" onclick="document.getElementById('pause-modal').remove()">Not now</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

function resolvePause(type) {
  document.getElementById('pause-modal')?.remove();
  if (type === 'life') switchTab('offcourt');
  else if (type === 'media') openNotableMedia();
  else openDecisions();
}

async function openNotableMedia() {
  const r = await api(`/media/notable/${S.playerId}`);
  if (!r.notable) { toast('No pending media.','warn'); return; }
  const overlay = document.createElement('div');
  overlay.id = 'notable-media-modal';
  overlay.className = 'fixed inset-0 z-[75] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `<div class="card p-5 w-full max-w-md">
    <h3 class="text-lg font-bold text-white mb-1">🎤 Media</h3>
    <p class="text-sm text-gray-200 mb-4">${esc(r.question)}</p>
    <div class="space-y-2">
      ${r.choices.map((c,i)=>`<button class="w-full text-left card card-hover p-3 text-sm text-white" onclick="answerNotableMedia(${i})">${esc(c.text)}</button>`).join('')}
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

async function answerNotableMedia(idx) {
  const r = await api(`/media/respond-notable/${S.playerId}?choice_index=${idx}`, { method:'POST' });
  document.getElementById('notable-media-modal')?.remove();
  const card = $('#oc-media');
  if (card) card.innerHTML = `<div class="card p-4 border-cyber/30"><p class="text-sm text-white">"${esc(r.choice)}"</p><p class="text-sm text-cyber mt-2">${esc(r.narrative)}</p></div>`;
  toast(r.narrative || 'You answered.', 'success');
  await refreshPlayer(); renderHeader();
}

async function simBatch(count, btn) {
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Simulating…'; }
  try {
    const CHUNK = 8;
    let done = 0;
    let paused = null;
    // Pop-up streaming ticker so results aren't buried at the page bottom.
    document.getElementById('sim-modal')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'sim-modal';
    overlay.className = 'fixed inset-0 z-[65] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
    overlay.innerHTML = `<div class="card p-5 w-full max-w-lg max-h-[80vh] flex flex-col">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-sm font-semibold text-gray-300">Simulating…</h3>
        <button class="text-muted text-xl leading-none" onclick="document.getElementById('sim-modal').remove()">×</button>
      </div>
      <div class="bar-track h-2 mb-2"><div id="sim-bar" class="bar-fill" style="width:0%;background:linear-gradient(90deg,#f59e0b,#fbbf24)"></div></div>
      <div id="sim-ticker" class="flex-1 overflow-y-auto text-xs space-y-0"></div>
    </div>`;
    document.body.appendChild(overlay);
    const tickerEl = $('#sim-ticker');
    while (done < count) {
      const n = Math.min(CHUNK, count - done);
      const r = await api(`/game/simulate-batch/${S.playerId}?count=${n}`, { method:'POST' });
      const games = r.games || [];
      for (const g of games) {
        tickerEl.insertAdjacentHTML('beforeend', tickerLine(g));
        tickerEl.scrollTop = tickerEl.scrollHeight;
        await sleep(140);
      }
      done += games.length;
      const bar = $('#sim-bar'); if (bar) bar.style.width = Math.min(100, Math.round(done / count * 100)) + '%';
      if (r.paused) { paused = r.paused; break; }
      if (!games.length) break; // nothing left (season done or blocked)
    }
    if (paused) {
      tickerEl.insertAdjacentHTML('beforeend', `<div class="py-1 text-accent font-bold">⏸️ Paused — ${paused.label}</div>`);
      tickerEl.scrollTop = tickerEl.scrollHeight;
      showPauseModal(paused);
    } else {
      tickerEl.insertAdjacentHTML('beforeend', `<div class="py-1 text-muted">Done — ${done} game${done===1?'':'s'} simulated.</div>`);
      tickerEl.scrollTop = tickerEl.scrollHeight;
      setTimeout(() => document.getElementById('sim-modal')?.remove(), 1500);
    }
    await refreshPlayer(); renderHeader(); await refreshGameProgress();
  } catch(e) { toast('Batch sim failed: '+e.message,'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = orig; } }
}

// Immediately reflect the updated team record + games played on the game page.
async function refreshGameProgress() {
  await refreshSeason();
  try {
    const ss = await api(`/player/${S.playerId}/season-stats`);
    const games = ss.games || 0;
    if (games >= 82) { switchTab('game'); return; } // re-render to surface the Finalize button
    const gnum = $('#g-gamenum');
    if (gnum) gnum.textContent = games >= 82 ? 'Regular Season · Complete (82 games)' : `Regular Season · Game ${games+1} of 82`;
    const gp = $('#g-progress');
    if (gp) gp.innerHTML = `Team Record: <b class="text-white">${ss.team_wins}-${ss.team_losses}</b> · ${games}/82 games played`;
  } catch(e){ console.warn('refreshGameProgress', e); }
}

async function loadScoutingReport(teamId) {
  const el = $('#g-scout'); if (!el) return;
  try {
    const [r, mine] = await Promise.all([
      api(`/league/team/${teamId}?player_id=${S.playerId}`),
      api(`/league/team/${S.player.team_id}?player_id=${S.playerId}`),
    ]);
    const vs = r.strength - mine.strength;
    const top = (r.top_players || []).map(p=>`${p.name} (${p.position} · ${p.overall})${p.injury_games>0?' 🏥':''}`).join(', ');
    el.innerHTML = `
      <div class="flex items-center gap-6 mb-2">
        <div class="text-center"><div class="text-2xl font-black ${vs>=0?'text-bad':'text-good'}">${r.strength}</div><div class="text-[10px] text-muted">${r.abbr}</div></div>
        <div class="text-muted">vs</div>
        <div class="text-center"><div class="text-2xl font-black text-white">${mine.strength}</div><div class="text-[10px] text-muted">your team</div></div>
      </div>
      <p class="text-xs text-muted mb-1">Their key players: <span class="text-white">${top || '—'}</span></p>
      <p class="text-[10px] text-faint">${r.abbr} payroll $${r.salary?.toFixed(1)||'0'}M · your payroll $${mine.salary?.toFixed(1)||'0'}M (cap $${r.cap||'—'}M)</p>`;
  } catch(e) { el.innerHTML = '<p class="text-muted text-sm">Scouting report unavailable.</p>'; }
}

function devEventNotice(r) {
  let html = '';
  if (r.development) {
    const gains = Object.entries(r.development.changes||{}).map(([a,d])=>`${a.replace(/_/g,' ')} +${d.gain}`).join(', ');
    html += `<div class="mt-3 p-3 rounded-lg bg-cyber/10 border border-cyber/30 text-cyber text-sm">📈 Development: ${gains}${r.development.focus?' (focus: '+r.development.focus.replace(/_/g,' ')+')':''}</div>`;
  }
  if (r.event) {
    const e = r.event.event;
    html += `<div class="mt-3 p-3 rounded-lg ${e.tone==='positive'?'bg-good/10 border-good/30 text-good':'bg-warn/10 border-warn/30 text-warn'} text-sm">${e.tone==='positive'?'✨':'⚠️'} ${esc(e.title)}: ${esc(e.text)}</div>`;
  }
  if (r.all_star) {
    html += `<div class="mt-3 p-3 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm">⭐ All-Star selection! (${r.all_star.ppg} PPG)${r.all_star.as_game?` — All-Star game: ${r.all_star.as_game.pts} pts, ${r.all_star.as_game.reb} reb, ${r.all_star.as_game.ast} ast`:''}</div>`;
  }
  if (r.passive_trade) {
    html += `<div class="mt-3 p-3 rounded-lg bg-warn/10 border border-warn/30 text-warn text-sm">🔁 Traded to ${esc(r.passive_trade.to)} — ${esc(r.passive_trade.reason)}.</div>`;
  }
  if (r.allstar_weekend) {
    html += `<div class="mt-3 p-3 rounded-lg bg-accent/10 border border-accent/30 text-accent text-sm">🌟 All-Star Weekend — enter the dunk or three-point contest? <button class="underline ml-1" onclick="switchTab('dashboard')">Decide</button></div>`;
  }
  return html;
}

function gameResult(r) {
  const b = r.box_score, a = r.advanced;
  const q = r.quarters || { team: [], opp: [] };
  const tb = r.team_box || {}, ob = r.opp_box || {};
  const box = (l,v,c)=>`<div class="card p-3 text-center"><div class="text-xl font-black ${c}">${v}</div><div class="text-[10px] text-muted">${l}</div></div>`;
  return `
    <div class="card p-5 fade">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold text-white">Game ${r.game_number} vs ${r.opponent}</h3>
        <span class="text-2xl font-black ${r.result==='W'?'text-good':'text-bad'}">${r.result}</span>
      </div>
      <div class="text-center text-3xl font-black text-white mb-4">${r.team_score} – ${r.opponent_score}${r.overtime?`<span class="text-accent text-lg align-middle ml-2">(${r.overtime}OT)</span>`:''}</div>

      ${q.team?.length ? `
      <table class="w-full text-xs text-center mb-4">
        <thead><tr class="text-muted border-b border-bg-border">
          <th class="text-left py-1 font-semibold"></th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th class="text-accent">T</th>
        </tr></thead>
        <tbody>
          <tr><td class="text-left font-semibold text-white py-1">You</td>${q.team.map(v=>`<td class="mono text-white">${v}</td>`).join('')}<td class="mono font-bold text-accent">${r.team_score}</td></tr>
          <tr><td class="text-left font-semibold text-white py-1">Opp</td>${q.opp.map(v=>`<td class="mono text-white">${v}</td>`).join('')}<td class="mono font-bold text-accent">${r.opponent_score}</td></tr>
        </tbody>
      </table>` : ''}

      <div class="grid grid-cols-4 md:grid-cols-8 gap-2 mb-3">
        ${box('MIN',r.minutes,'text-white')}${box('PTS',b.pts,'text-accent')}${box('REB',b.reb,'text-cyber')}${box('AST',b.ast,'text-purple-400')}
        ${box('STL',b.stl,'text-good')}${box('BLK',b.blk,'text-bad')}${box('TOV',b.tov,'text-warn')}${box('PF',b.pf,'text-muted')}
      </div>
      <div class="text-xs text-muted text-center mb-3">FG ${b.fgm}/${b.fga}${b.fga?` (${(b.fgm/b.fga*100).toFixed(1)}%)`:''} · 3PT ${b.tpm}/${b.tpa}${b.tpa?` (${(b.tpm/b.tpa*100).toFixed(1)}%)`:''} · FT ${b.ftm}/${b.fta}${b.fta?` (${(b.ftm/b.fta*100).toFixed(1)}%)`:''}</div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        ${box('OREB',b.oreb||0,'text-white')}${box('DREB',b.dreb||0,'text-white')}${box('±',(r.plus_minus>0?'+':'')+r.plus_minus,'text-white')}${box('EFF',a.eff,'text-white')}
      </div>
      <div class="grid grid-cols-3 gap-2 mb-3">
        ${box('PER',a.per,'text-accent')}${box('TS%',(a.ts_pct*100).toFixed(1)+'%','text-white')}${box('GmSc',a.game_score,'text-white')}
      </div>

      <div class="border-t border-bg-border pt-3">
        <p class="text-[10px] text-muted uppercase tracking-wider mb-1 text-left">Team Comparison</p>
        <table class="w-full text-xs text-center">
          <thead><tr class="text-muted border-b border-bg-border"><th class="text-left py-1 font-semibold"></th><th>REB</th><th>AST</th><th>TOV</th><th>FG</th><th>3P</th></tr></thead>
          <tbody>
            <tr><td class="text-left font-semibold text-white py-1">You</td><td class="mono text-white">${tb.reb??'—'}</td><td class="mono text-white">${tb.ast??'—'}</td><td class="mono text-white">${tb.tov??'—'}</td><td class="mono text-white">${tb.fgm??0}/${tb.fga??0}</td><td class="mono text-white">${tb.tpm??0}/${tb.tpa??0}</td></tr>
            <tr><td class="text-left font-semibold text-white py-1">Opp</td><td class="mono text-white">${ob.reb??'—'}</td><td class="mono text-white">${ob.ast??'—'}</td><td class="mono text-white">${ob.tov??'—'}</td><td class="mono text-white">${ob.fgm??0}/${ob.fga??0}</td><td class="mono text-white">${ob.tpm??0}/${ob.tpa??0}</td></tr>
          </tbody>
        </table>
      </div>
      ${r.injury?`<div class="mt-3 p-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm">🏥 Injured: ${r.injury.type} — out ${r.injury.games} games</div>`:''}
      ${r.fouled_out?`<div class="mt-3 p-3 rounded-lg bg-bad/10 border border-bad/30 text-bad text-sm">🚫 Fouled out (${b.pf} fouls)</div>`:''}
      ${r.records_broken?.length?`<div class="mt-3 p-3 rounded-lg bg-accent/10 border border-accent/40 text-accent text-sm">🏆 NEW ALL-TIME RECORD: ${r.records_broken.map(x=>`${x.label} — ${x.achieved}`).join(' · ')}</div>`:''}
      ${devEventNotice(r)}
    </div>`;
}

async function simPlayoffGame(btn) {
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Simulating…';
  try {
    const r = await api(`/season/playoff-game/${S.playerId}`, { method:'POST' });
    await refreshPlayer(); await refreshSeason(); renderHeader();
    if (r.champion) {
      $('#g-result').innerHTML = gameResult(r.game) + playoffSeriesResult(r);
      toast('🏆 NBA CHAMPION!','success'); setTimeout(()=>switchTab('dashboard'), 1800);
    } else if (r.eliminated) {
      $('#g-result').innerHTML = gameResult(r.game) + playoffSeriesResult(r);
      toast(`Eliminated — ${r.playoff_result}.`,'warn'); setTimeout(()=>switchTab('dashboard'), 1800);
    } else {
      // Re-render the playoff panel so series score / round / opponent update
      // immediately, then inject this game's box score on top.
      await renderGame($('#main'));
      $('#g-result').innerHTML = gameResult(r.game) + playoffSeriesResult(r);
      if (r.advanced) toast(`Series won! Next: ${r.next_opponent}.`,'success');
    }
  } catch(e) { toast('Failed: '+e.message,'error'); }
  finally { btn.disabled = false; }
}

function playoffSeriesResult(r) {
  const s = r.series;
  return `
    <div class="card p-4 mt-3 border-accent/30">
      <p class="text-sm font-semibold text-white">${s.round_name} · #${s.player_seed} vs #${s.opponent_seed} · ${s.wins}-${s.losses} vs ${s.opponent}</p>
      ${r.champion ? '<p class="text-good font-bold mt-1">🏆 NBA CHAMPION!</p>' : ''}
      ${r.eliminated ? `<p class="text-bad mt-1">Eliminated — ${r.playoff_result}</p>` : ''}
      ${r.advanced ? `<p class="text-good mt-1">Series won! Next: ${r.next_opponent}</p>` : ''}
    </div>`;
}

// ============================================================
// GAME DETAIL MODAL
// ============================================================
const GAME_CACHE = {};
function cacheGames(games) { (games||[]).forEach(g => { if (g.id) GAME_CACHE[g.id] = g; }); }
function showGameDetailCached(id) { const g = GAME_CACHE[id]; if (g) showGameDetail(g); }

function showGameDetail(g) {
  const box = (l,v,c)=>`<div class="text-center"><div class="text-lg font-black ${c}">${v}</div><div class="text-[10px] text-muted">${l}</div></div>`;
  const overlay = document.createElement('div');
  overlay.id = 'game-modal';
  overlay.className = 'fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="card p-5 w-full max-w-2xl max-h-[85vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold text-white">Game ${g.game_number} vs ${S.teams?.[g.opponent_team_id]?.name||'Team '+g.opponent_team_id}${g.is_home?' · Home':' · Away'}</h3>
        <button class="text-muted text-xl" onclick="closeGameModal()">×</button>
      </div>
      <div class="text-center text-3xl font-black ${g.result==='W'?'text-good':'text-bad'} mb-4">${g.team_score} – ${g.opponent_score} ${g.result==='W'?'W':'L'}</div>
      <table class="w-full text-xs text-center mb-4">
        <thead><tr class="text-muted border-b border-bg-border"><th class="text-left py-1"></th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th class="text-accent">T</th></tr></thead>
        <tbody>
          <tr><td class="text-left font-semibold text-white py-1">You</td><td>${g.q1_t}</td><td>${g.q2_t}</td><td>${g.q3_t}</td><td>${g.q4_t}</td><td class="font-bold text-accent">${g.team_score}</td></tr>
          <tr><td class="text-left font-semibold text-white py-1">Opp</td><td>${g.q1_o}</td><td>${g.q2_o}</td><td>${g.q3_o}</td><td>${g.q4_o}</td><td class="font-bold text-accent">${g.opponent_score}</td></tr>
        </tbody>
      </table>
      <div class="grid grid-cols-4 md:grid-cols-8 gap-2 mb-4">
        ${box('MIN',g.minutes,'text-white')}${box('PTS',g.pts,'text-accent')}${box('REB',g.reb,'text-cyber')}${box('AST',g.ast,'text-purple-400')}
        ${box('STL',g.stl,'text-good')}${box('BLK',g.blk,'text-bad')}${box('TOV',g.tov,'text-warn')}${box('PF',g.pf,'text-muted')}
      </div>
      <div class="text-xs text-muted mb-4">FG ${g.fgm}/${g.fga}${g.fga?` (${(g.fgm/g.fga*100).toFixed(1)}%)`:''} · 3PT ${g.tpm}/${g.tpa}${g.tpa?` (${(g.tpm/g.tpa*100).toFixed(1)}%)`:''} · FT ${g.ftm}/${g.fta}${g.fta?` (${(g.ftm/g.fta*100).toFixed(1)}%)`:''} · ±${g.plus_minus>0?'+':''}${g.plus_minus}</div>
      <table class="w-full text-xs text-center mb-4">
        <thead><tr class="text-muted border-b border-bg-border"><th class="text-left py-1"></th><th>REB</th><th>AST</th><th>TOV</th><th>FG</th><th>3P</th></tr></thead>
        <tbody>
          <tr><td class="text-left font-semibold text-white py-1">You</td><td>${g.team_reb??'—'}</td><td>${g.team_ast??'—'}</td><td>${g.team_tov??'—'}</td><td>${g.team_fgm??0}/${g.team_fga??0}</td><td>${g.team_3pm??0}/${g.team_3pa??0}</td></tr>
          <tr><td class="text-left font-semibold text-white py-1">Opp</td><td>${g.opp_reb??'—'}</td><td>${g.opp_ast??'—'}</td><td>${g.opp_tov??'—'}</td><td>${g.opp_fgm??0}/${g.opp_fga??0}</td><td>${g.opp_3pm??0}/${g.opp_3pa??0}</td></tr>
        </tbody>
      </table>
      <div class="grid grid-cols-2 gap-2">
        ${box('PER',g.per,'text-accent')}${box('GmSc',g.game_score,'text-white')}
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
function closeGameModal() { $('#game-modal')?.remove(); }

// ============================================================
// TRAINING
// ============================================================
async function renderTraining(m) {
  await refreshPlayer(); await refreshSeason();
  const p = S.player;
  const phase = S.season?.current_phase||'regular_season';
  const isOffseason = phase === 'offseason';
  const trained = p.trained_season === (S.season?.current_season||1);
  S.trainingSel = S.trainingSel || [];
  const tmult = p.age<22?'1.35x (Young)':p.age<26?'1.12x (Developing)':p.age<30?'0.88x (Peak)':p.age<33?'0.60x (Veteran)':'0.30x (Declining)';
  m.innerHTML = `
    <div class="space-y-5">
      <div class="card p-5">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h2 class="text-lg font-bold text-white">${t('Offseason Training')}</h2>
          ${isOffseason
            ? (trained ? '<span class="text-xs px-2 py-1 rounded bg-good/15 text-good">✓ Trained this offseason</span>' : '<span class="text-xs px-2 py-1 rounded bg-accent/15 text-accent">1 slot available</span>')
            : '<span class="text-xs px-2 py-1 rounded bg-bad/15 text-bad">🔒 Locked</span>'}
        </div>
        <p class="text-sm text-muted">Only available in the offseason. Pick <b class="text-white">up to three programs</b> — but the first trains at full effect, later ones give <b class="text-white">72% / 48%</b>, and stacking raises <b class="text-bad">injury risk</b>. Order matters.</p>
        <div class="flex gap-4 mt-3 text-xs">
          <span class="px-2 py-1 rounded bg-bg-hover border border-bg-border text-muted">Age ${p.age} → ${tmult}</span>
          <span class="px-2 py-1 rounded bg-bg-hover border border-bg-border text-muted">Work Ethic ${p.work_ethic}</span>
        </div>
        ${isOffseason && trained ? `<div class="mt-4"><button class="btn-primary" onclick="advanceToNextSeason()">➡️ Advance to Next Season</button></div>` : ''}
      </div>
      ${!isOffseason ? `
      <div class="card p-4 border-warn/30 bg-warn/5">
        <p class="text-sm text-warn">⚠️ Training is only available during the offseason. Finish the regular season and finalize to unlock it.</p>
      </div>` : ''}
      <div class="grid md:grid-cols-2 gap-3 ${isOffseason&&!trained?'':'opacity-50 pointer-events-none'}">
        ${Object.entries(S.programs||{}).map(([name,prog])=>{
          const idx = (S.trainingSel||[]).indexOf(name);
          const isSel = idx >= 0;
          return `
          <div class="card card-hover p-4 cursor-pointer ${isSel?'ring-2 ring-accent border-accent/50':''}" onclick="toggleProgram('${name}')">
            <div class="flex justify-between items-start">
              <h4 class="font-bold text-white">${name}${isSel?' <span class="text-accent">✓</span>':''}</h4>
              <div class="flex items-center gap-2">
                ${isSel?`<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent/20 text-accent">Slot ${idx+1} · ${idx===0?'100%':idx===1?'72%':'48%'} gains</span>`:''}
                <span class="text-xs px-2 py-1 rounded ${prog.injury_risk>3?'bg-bad/15 text-bad':prog.injury_risk>1?'bg-warn/15 text-warn':'bg-good/15 text-good'}">Risk ${prog.injury_risk}/10</span>
              </div>
            </div>
            <p class="text-xs text-muted mt-1">${prog.desc}</p>
            <div class="flex gap-1 mt-2 flex-wrap">
              ${prog.primary.map(a=>`<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">${a.replace(/_/g,' ')}</span>`).join('')}
              ${prog.secondary.map(a=>`<span class="text-[10px] px-1.5 py-0.5 rounded bg-cyber/15 text-cyber">${a.replace(/_/g,' ')}</span>`).join('')}
            </div>
          </div>`}).join('')}
      </div>
      ${isOffseason && !trained ? `
      <div class="card p-4 border-accent/20 flex items-center justify-between gap-3 flex-wrap">
        <div class="text-sm text-muted">Selected <b class="text-white">${(S.trainingSel||[]).length}/3</b>. First program = full effect, later ones 72% / 48% + higher injury risk.</div>
        <button class="btn-primary" onclick="applyPlan()" ${(S.trainingSel||[]).length?'':'disabled'}>🏋️ Apply Training Plan</button>
      </div>` : ''}
      <div id="t-result"></div>
    </div>`;
}

function toggleProgram(name) {
  const phase = S.season?.current_phase||'regular_season';
  if (phase !== 'offseason') { toast('Training is only available in the offseason.','warn'); return; }
  S.trainingSel = S.trainingSel || [];
  const i = S.trainingSel.indexOf(name);
  if (i >= 0) S.trainingSel.splice(i, 1);
  else {
    if (S.trainingSel.length >= 3) { toast('Max 3 programs per offseason.','warn'); return; }
    S.trainingSel.push(name);
  }
  renderTraining(document.querySelector('#main'));
}

async function applyPlan() {
  const sel = S.trainingSel || [];
  if (!sel.length) { toast('Select at least one program.','warn'); return; }
  if (!confirm(`Apply your offseason plan: ${sel.join(' → ')}?\nOrder matters — later programs give less.`)) return;
  const r = await api(`/training/apply/${S.playerId}?programs=${encodeURIComponent(sel.join(','))}`, { method:'POST' });
  const totalGain = Object.values(r.gains).reduce((a,g)=>a+g.gain,0);
  $('#t-result').innerHTML = `
    <div class="card p-5 border-accent/30">
      <h3 class="font-bold text-accent mb-2">✅ Training Complete</h3>
      <p class="text-sm text-muted mb-1">Programs: ${r.programs.join(' → ')}</p>
      <p class="text-sm text-muted mb-3">Your body responded ${totalGain>16?'exceptionally well':totalGain>10?'well':'moderately'} to the plan.</p>
      <div class="grid grid-cols-2 gap-1 text-sm">
        ${Object.entries(r.gains).map(([attr,d])=>`<div><span class="text-muted">${attr.replace(/_/g,' ')}:</span> <span class="text-white">${d.before} → <b class="text-good">${d.after}</b></span></div>`).join('')}
      </div>
      <p class="text-xs text-muted mt-2">Fatigue reduced significantly.</p>
      ${r.injury_occurred?`<p class="text-bad text-sm mt-2">🏥 You got injured during training: ${r.injuries[0].type} — out ${r.injuries[0].games} games.</p>`:''}
      <div class="mt-4 flex gap-2">
        <button class="btn-primary" onclick="advanceToNextSeason()">➡️ Advance to Next Season</button>
      </div>
    </div>`;
  S.trainingSel = [];
  await refreshPlayer();
}

// ============================================================
// CAREER
// ============================================================
async function renderCareer(m) {
  let c; try { c = await api(`/career/${S.playerId}`); } catch(e){ return m.innerHTML='<p class="text-bad">Error</p>'; }
  const goat = c.goat_score||0;
  const box = (l,v,c)=>`<div class="card p-3 text-center"><div class="text-2xl font-black ${c}">${v}</div><div class="text-[10px] text-muted">${l}</div></div>`;
  m.innerHTML = `
    <div class="space-y-5">
      <div class="card p-6 text-center">
        <h3 class="text-xs mono text-muted uppercase tracking-wider mb-1">🐐 G.O.A.T. Tracker</h3>
        <div class="text-5xl font-black text-accent">${goat.toFixed(1)}%</div>
        <div class="bar-track h-4 max-w-md mx-auto my-3"><div class="bar-fill" style="width:${Math.min(100,goat)}%;background:linear-gradient(90deg,#f59e0b,#fbbf24)"></div></div>
        <div class="grid grid-cols-4 gap-4 max-w-md mx-auto">
          ${box('🏆 Rings',c.championships||0,'text-accent')}${box('🏅 MVPs',c.mvps||0,'text-accent')}${box('⭐ All-NBA',c.all_nba||0,'text-accent')}${box('📊 Games',c.career_totals?.games||0,'text-white')}
        </div>
      </div>
      <div class="card p-5 border-accent/20">
        <h3 class="text-sm font-semibold text-gray-300 mb-1">🧭 Who You Are</h3>
        <p class="text-xs text-faint mb-3">Accumulated silently from your choices, revealed at the end.</p>
        <p class="text-sm italic text-gray-200 mb-3">"${c.values_reflection || ''}"</p>
        <div class="grid grid-cols-4 gap-3 text-center">
          ${['family','career','money','fame'].map(k=>{
            const v = c.values?.[k]||0;
            const color = v>0?'text-good':v<0?'text-bad':'text-muted';
            return `<div class="card p-3"><div class="text-xl font-black ${color}">${v>0?'+':''}${v}</div><div class="text-[10px] text-muted capitalize mt-1">${k}</div></div>`;
          }).join('')}
        </div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Career Totals')}</h3>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
          ${box('Games',c.career_totals?.games||0,'text-white')}${box('Points',(c.career_totals?.pts||0).toLocaleString(),'text-accent')}
          ${box('Rebounds',(c.career_totals?.reb||0).toLocaleString(),'text-cyber')}${box('Assists',(c.career_totals?.ast||0).toLocaleString(),'text-purple-400')}
          ${box('Steals',(c.career_totals?.stl||0).toLocaleString(),'text-good')}${box('Blocks',(c.career_totals?.blk||0).toLocaleString(),'text-bad')}
        </div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Career Averages')}</h3>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
          ${box('PPG',c.career_averages?.ppg??'—','text-accent')}${box('RPG',c.career_averages?.rpg??'—','text-cyber')}${box('APG',c.career_averages?.apg??'—','text-purple-400')}
          ${box('SPG',c.career_averages?.spg??'—','text-good')}${box('BPG',c.career_averages?.bpg??'—','text-bad')}${box('MPG',c.career_averages?.mpg??'—','text-white')}
        </div>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-3 mt-3">
          ${box('FG%',c.career_averages?.fg_pct!=null?(c.career_averages.fg_pct*100).toFixed(1)+'%':'—','text-white')}
          ${box('3P%',c.career_averages?.tp_pct!=null?(c.career_averages.tp_pct*100).toFixed(1)+'%':'—','text-white')}
          ${box('FT%',c.career_averages?.ft_pct!=null?(c.career_averages.ft_pct*100).toFixed(1)+'%':'—','text-white')}
          ${box('Turnovers',(c.career_totals?.tov||0).toLocaleString(),'text-muted')}
          ${box('Seasons',c.seasons?.length||0,'text-white')}${box('GOAT',c.goat_score?.toFixed(1)+'%','text-accent')}
        </div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Career Trajectory')}</h3>
        <div class="h-64"><canvas id="career-chart"></canvas></div>
      </div>
      ${c.playoff_totals?.games>0?`
      <div class="card p-5 border-accent/20">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🏆 ${t('Playoff Career')}</h3>
        <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
          ${box('Games',c.playoff_totals.games,'text-white')}${box('PPG',c.playoff_averages?.ppg??'—','text-accent')}${box('RPG',c.playoff_averages?.rpg??'—','text-cyber')}
          ${box('APG',c.playoff_averages?.apg??'—','text-purple-400')}${box('SPG',c.playoff_averages?.spg??'—','text-good')}${box('BPG',c.playoff_averages?.bpg??'—','text-bad')}
        </div>
      </div>`:''}
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Career Highs')}</h3>
        <div class="grid grid-cols-3 md:grid-cols-5 gap-3">
          ${box('Points',c.career_highs?.pts||0,'text-accent')}${box('Rebounds',c.career_highs?.reb||0,'text-cyber')}
          ${box('Assists',c.career_highs?.ast||0,'text-purple-400')}${box('Steals',c.career_highs?.stl||0,'text-good')}${box('Blocks',c.career_highs?.blk||0,'text-bad')}
        </div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🏆 ${t('All-Time Records')}</h3>
        <div id="career-records"><p class="text-muted text-sm">Loading…</p></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🏅 ${t('Awards')}</h3>
        <div class="flex flex-wrap gap-2">
          ${c.awards?.length?c.awards.map(a=>`<span class="px-3 py-1.5 rounded-full text-xs font-semibold bg-accent/10 text-accent border border-accent/30">S${a.season_number} · ${a.award_name}</span>`).join(''):'<span class="text-muted text-sm">No awards yet.</span>'}
        </div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">📜 ${t('Career Timeline')}</h3>
        <div id="career-events"><p class="text-muted text-sm">Loading…</p></div>
      </div>
      ${c.seasons?.length?`<div class="card p-5"><h3 class="text-sm font-semibold text-gray-300 mb-3">Season History</h3>
        <div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="text-muted border-b border-bg-border text-left">
          <th class="py-2 pr-2">S</th><th class="pr-2">Team</th><th class="pr-2">Age</th><th class="pr-2">PPG</th><th class="pr-2">RPG</th><th class="pr-2">APG</th><th class="pr-2">PER</th><th class="pr-2">BPM</th><th class="pr-2">Playoffs</th><th>Awards</th>
        </tr></thead><tbody>${c.seasons.map(su=>`<tr class="border-b border-bg-border hover:bg-bg-hover">
          <td class="py-1.5 pr-2 font-bold text-accent">${su.season_number}</td><td class="pr-2">${S.teams?.[su.team_id]?.abbr||'T'+su.team_id}</td>
          <td class="pr-2">${su.age}</td><td class="pr-2 font-bold text-white">${su.ppg}</td><td class="pr-2">${su.rpg}</td><td class="pr-2">${su.apg}</td>
          <td class="pr-2 mono">${su.per}</td><td class="pr-2 mono">${su.bpm}</td><td class="pr-2 text-xs">${su.playoff_result||'—'}</td>
          <td class="text-xs text-accent">${(JSON.parse(su.awards||'[]')).join(', ')||'—'}</td></tr>`).join('')}</tbody></table></div></div>`:''}
    </div>`;
  loadCareerEvents();
  loadRecords();
  renderCareerChart(c.seasons);
}

async function loadRecords() {
  const el = $('#career-records'); if (!el) return;
  try {
    const rec = await api(`/player/${S.playerId}/records`);
    const row = (r, yourBest) => {
      const held = yourBest > r.value;
      return `<div class="flex items-center justify-between gap-3 py-1.5 border-b border-bg-border last:border-0 text-xs">
        <span class="text-white">${r.label}</span>
        <span class="text-muted">${r.holder} · ${r.value}</span>
        <span class="mono ${held?'text-accent font-bold':'text-gray-300'}">${held?'★ ':''}${yourBest}</span>
      </div>`;
    };
    const sg = rec.legends.single_game.map(r => row(r, rec.best.single_game[r.stat]));
    const ss = rec.legends.season.map(r => row(r, rec.best.season[r.stat]));
    el.innerHTML = `
      <div class="grid md:grid-cols-2 gap-6">
        <div><p class="text-xs font-semibold text-muted mb-2">Single-game</p>${sg.join('')}</div>
        <div><p class="text-xs font-semibold text-muted mb-2">Single-season</p>${ss.join('')}</div>
      </div>
      <p class="text-[10px] text-faint mt-3">Legend record · your career best. ★ = you hold the all-time record.</p>`;
  } catch(e) { el.innerHTML = '<p class="text-muted text-sm">Couldn\'t load records.</p>'; }
}

function renderCareerChart(seasons) {
  if (!seasons || seasons.length < 2) {
    const el = $('#career-chart'); if (el) el.parentElement.innerHTML = '<p class="text-muted text-sm">Need at least two seasons to chart your trajectory.</p>';
    return;
  }
  const labels = seasons.map(s => 'S' + s.season_number);
  renderLineChart('career-chart', labels, [
    { label: 'PPG', data: seasons.map(s => s.ppg), borderColor: '#f59e0b', backgroundColor: '#f59e0b', tension: 0.3, pointRadius: 3 },
    { label: 'RPG', data: seasons.map(s => s.rpg), borderColor: '#06b6d4', backgroundColor: '#06b6d4', tension: 0.3, pointRadius: 3 },
    { label: 'APG', data: seasons.map(s => s.apg), borderColor: '#a78bfa', backgroundColor: '#a78bfa', tension: 0.3, pointRadius: 3 },
    { label: 'PER', data: seasons.map(s => s.per), borderColor: '#34d399', backgroundColor: '#34d399', tension: 0.3, pointRadius: 3, borderDash: [5, 3] },
    { label: 'WS', data: seasons.map(s => s.ws), borderColor: '#f87171', backgroundColor: '#f87171', tension: 0.3, pointRadius: 3, borderDash: [5, 3] },
  ]);
}

async function loadCareerEvents() {
  const el = $('#career-events'); if (!el) return;
  try {
    const ev = await api(`/player/${S.playerId}/events`);
    el.innerHTML = ev.events?.length ? ev.events.map(e=>`
      <div class="flex items-start gap-2 py-2 border-b border-bg-border last:border-0 text-sm">
        <span class="text-xs w-14 mono text-faint shrink-0">S${e.season_number}</span>
        <span class="${e.event_type==='development'?'text-cyber':e.event_type==='trade'?'text-accent':e.event_type==='league'?'text-purple-400':'text-gray-200'}">${esc(e.description)}</span>
      </div>`).join('') : '<p class="text-muted text-sm">No notable events yet. Keep playing — life happens.</p>';
  } catch(e){ el.innerHTML = '<p class="text-muted text-sm">Couldn\'t load timeline.</p>'; }
}

// ============================================================
// OFF-COURT
// ============================================================
async function renderOffCourt(m) {
  S.mediaPending = false; renderTabs(); renderHeader();
  m.innerHTML = `
    <div class="space-y-5">
      ${S.player.free_agent ? `
      <div class="card p-5 border-accent/40 bg-accent/5">
        <h3 class="text-sm font-semibold text-accent mb-1">🏀 Free Agency</h3>
        <p class="text-xs text-muted mb-3">Your contract is up — review offers and choose your next team.</p>
        <div id="oc-contract"><p class="text-muted text-sm">Loading offers…</p></div>
      </div>` : ''}
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🎤 ${t('Media')}</h3>
        <div id="oc-media"><p class="text-muted text-sm">Loading…</p></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">💰 ${t('Endorsements')}</h3>
        <div id="oc-endorse"></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">👟 ${t('Signature Shoe')}</h3>
        <div id="oc-shoe"></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🌍 ${t('Commercial Tour')}</h3>
        <p class="text-xs text-muted mb-3">Spend your offseason growing your global brand instead of training — one or the other.</p>
        <div id="oc-tour"></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🥇 ${t('International Play')}</h3>
        <p class="text-xs text-muted mb-3">In a tournament year, you can represent your country — national glory, but it costs your training slot.</p>
        <div id="oc-intl"></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">📈 ${t('Investments')}</h3>
        <p class="text-xs text-muted mb-3">Wealth: <b class="text-accent">$${S.player.wealth?.toFixed(2)||'0.00'}M</b> · Market: <b class="${marketLabel(S.season?.market).c}">${marketLabel(S.season?.market).t}</b></p>
        <form id="inv-form" class="flex gap-2 mb-4 flex-wrap items-end">
          <select id="inv-asset" class="bg-bg border border-bg-border rounded-lg px-3 py-2 text-sm text-white"><option>Loading assets…</option></select>
          <input id="inv-amt" type="number" placeholder="$M" step="0.1" min="0.1" class="w-24 bg-bg border border-bg-border rounded-lg px-3 py-2 text-sm text-white outline-none">
          <button class="btn-secondary" type="submit">Invest</button>
        </form>
        <p class="text-xs text-faint -mt-2 mb-3" id="inv-asset-desc"></p>
        <div id="oc-invest"></div>
        <div class="mt-3 pt-3 border-t border-bg-border flex items-center justify-between gap-2">
          <span class="text-xs text-muted">💰 Advisor trust: <b class="text-white">${S.player.advisor_trust ?? 50}</b></span>
          <button class="btn-secondary !py-1 !px-2.5 text-xs" onclick="hireAdvisor()">Hire reputable advisor ($2M)</button>
        </div>
        <p class="text-[10px] text-faint mt-1">Low trust + big money = a scam risk each offseason.</p>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🏠 ${t('Lifestyle')}</h3>
        <p class="text-xs text-muted mb-3">How you live burns wealth each offseason but buys fame. Higher tiers cost more — money never stays still.</p>
        <div id="oc-lifestyle"></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">👥 ${t('Life & Relationships')}</h3>
        <p class="text-xs text-muted mb-3">The people around you. Healthy bonds steady your game; broken ones rattle it.</p>
        <div id="oc-life"></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">🏟️ ${t('Locker Room')}</h3>
        <p class="text-xs text-muted mb-3">Your teammates and how you gel with them. Wins bring the room together; losses and selfishness fray it.</p>
        <div id="oc-teammates"></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">👑 Influence <span class="text-faint">(Clout: ${S.player.clout?.toFixed(0)})</span></h3>
        <div class="grid grid-cols-2 gap-3">
          <button class="btn-secondary text-left" onclick="cloutTrade()">🔄 Demand Trade<br><span class="text-xs text-muted">Requires 25+ clout</span></button>
          <button class="btn-secondary text-left" onclick="cloutBuyout()">📄 Request Buyout<br><span class="text-xs text-muted">End contract early (20+ clout)</span></button>
          <div class="text-xs text-muted self-center col-span-2">High clout unlocks team influence. Build it through awards, media, and winning.</div>
        </div>
      </div>
    </div>`;
  loadMedia(); loadEndorse(); loadInvest(); loadLife(); loadLifestyle(); loadLockerRoom();
  loadShoe(); loadTour(); loadIntl();
  if (S.player.free_agent) loadContractOffers();
}

async function loadShoe() {
  const el = $('#oc-shoe'); if (!el) return;
  try {
    const r = await api(`/economy/shoe/${S.playerId}`);
    if (r.shoe) {
      el.innerHTML = `<div class="flex items-center justify-between gap-3">
        <div><p class="text-sm font-semibold text-white">👟 ${r.shoe.brand} "${r.shoe.name}"</p>
        <p class="text-xs text-muted">${r.shoe.colorway} colorway · $${r.shoe.annual_value}M/yr royalties</p></div>
        <span class="text-xs px-2 py-1 rounded bg-good/15 text-good">✓ Signed</span></div>`;
    } else if ((S.player.clout||0) >= 60) {
      el.innerHTML = `
        <p class="text-xs text-muted mb-3">Your brand is big enough (60+ clout) to land a signature shoe. Name it.</p>
        <div class="flex gap-2 flex-wrap items-end">
          <select id="shoe-brand" class="bg-bg border border-bg-border rounded-lg px-3 py-2 text-sm text-white">${r.brands.map(b=>`<option>${b}</option>`).join('')}</select>
          <input id="shoe-name" type="text" placeholder="Shoe name" class="bg-bg border border-bg-border rounded-lg px-3 py-2 text-sm text-white outline-none">
          <input id="shoe-color" type="text" placeholder="Colorway" class="bg-bg border border-bg-border rounded-lg px-3 py-2 text-sm text-white outline-none">
          <button class="btn-secondary" onclick="signShoe()">Sign</button>
        </div>`;
    } else {
      el.innerHTML = `<p class="text-muted text-sm">Need 60+ clout to land a signature shoe. (Currently ${(S.player.clout||0).toFixed(0)}.)</p>`;
    }
  } catch(e) { el.innerHTML = '<p class="text-muted text-sm">Couldn\'t load shoe.</p>'; }
}

async function signShoe() {
  const brand = $('#shoe-brand')?.value || 'Nike';
  const name = $('#shoe-name')?.value || '';
  const colorway = $('#shoe-color')?.value || '';
  if (!name) { toast('Give your shoe a name.','warn'); return; }
  const r = await api(`/economy/sign-shoe/${S.playerId}?brand=${encodeURIComponent(brand)}&name=${encodeURIComponent(name)}&colorway=${encodeURIComponent(colorway)}`, { method:'POST' });
  toast(`Signed the ${r.brand} "${r.name}" — $${r.annual_value}M/yr.`,'success');
  await refreshPlayer(); loadShoe();
}

function loadTour() {
  const el = $('#oc-tour'); if (!el) return;
  const phase = S.season?.current_phase;
  if (phase !== 'offseason') { el.innerHTML = '<p class="text-muted text-sm">Available during the offseason.</p>'; return; }
  const used = S.player.trained_season === S.season?.current_season;
  if (used) { el.innerHTML = '<p class="text-muted text-sm">You\'ve already used your offseason (training or a tour).</p>'; return; }
  const tours = [
    { id: 'china', label: 'China Tour', icon: '🇨🇳', desc: 'Camps and appearances across China. Your shoes sell out in Shanghai.' },
    { id: 'europe', label: 'Europe Tour', icon: '🇪🇺', desc: 'Clinics across Europe — growing the game and your name.' },
    { id: 'africa', label: 'Basketball Without Borders', icon: '🌍', desc: 'Give back through NBA Africa — less money, a lasting legacy.' },
  ];
  el.innerHTML = `<div class="space-y-2">${tours.map(t=>`
    <div class="flex items-center justify-between gap-3 p-3 rounded-lg bg-bg-hover border border-bg-border">
      <div><span class="text-sm font-semibold text-white">${t.icon} ${t.label}</span><p class="text-xs text-muted">${t.desc}</p></div>
      <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="takeTour('${t.id}')">Go</button>
    </div>`).join('')}</div>`;
}

async function takeTour(destination) {
  if (!confirm(`Go on the ${destination} tour? This uses your offseason slot (no training).`)) return;
  const r = await api(`/economy/tour/${S.playerId}?destination=${encodeURIComponent(destination)}`, { method:'POST' });
  toast(r.message, 'success');
  await refreshPlayer(); loadTour();
}

async function loadIntl() {
  const el = $('#oc-intl'); if (!el) return;
  try {
    const r = await api(`/economy/intl/${S.playerId}`);
    if (!r.tournament) { el.innerHTML = '<p class="text-muted text-sm">No international tournament this offseason.</p>'; return; }
    const used = S.player.trained_season === S.season?.current_season;
    if (used) { el.innerHTML = '<p class="text-muted text-sm">You\'ve already used your offseason (training, tour, or international play).</p>'; return; }
    const cfg = r.options[r.tournament];
    el.innerHTML = `<div class="flex items-center justify-between gap-3">
      <div><span class="text-sm font-semibold text-white">${cfg.icon} ${cfg.label}</span><p class="text-xs text-muted">Represent your country — costs your training slot.</p></div>
      <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="playIntl()">Play</button>
    </div>`;
  } catch(e) { el.innerHTML = '<p class="text-muted text-sm">Couldn\'t load international play.</p>'; }
}

async function playIntl() {
  if (!confirm('Represent your country this offseason? This uses your offseason slot (no training or tour).')) return;
  const r = await api(`/economy/play-intl/${S.playerId}`, { method:'POST' });
  toast(`${r.tournament}: ${r.medal_label} — +${r.fan_base} fan, +${r.clout} clout.`, 'success');
  await refreshPlayer(); loadIntl(); loadTour();
}

async function loadMedia() {
  try {
    const r = await api(`/media/notable/${S.playerId}`);
    if (r.notable) {
      $('#oc-media').innerHTML = `
        <p class="text-white font-medium mb-3">"${esc(r.question)}"</p>
        <div class="space-y-2">
          ${r.choices.map((c,i)=>`<button class="w-full text-left card card-hover p-3 text-sm" onclick="answerNotableMedia(${i})">${esc(c.text)}</button>`).join('')}
        </div>`;
    } else {
      $('#oc-media').innerHTML = '<p class="text-muted text-sm">Media shows up when you do something big — 50+ points, a triple-double, a broken record, an All-Star nod.</p>';
    }
  } catch(e) { $('#oc-media').innerHTML = '<p class="text-muted text-sm">No media right now.</p>'; }
}

async function respondMedia(sid, idx) {
  try {
    const r = await api(`/media/respond/${S.playerId}?scenario_id=${sid}&choice_index=${idx}`, { method:'POST' });
    const panel = $('#oc-media');
    panel.innerHTML = `<div class="card p-4 border-cyber/30">
      <p class="text-sm text-white">"${esc(r.choice)}"</p>
      <p class="text-sm text-cyber mt-2">${esc(r.narrative)}</p>
      <button class="btn-ghost mt-3" onclick="loadMedia()">Next question →</button>
    </div>`;
    await refreshPlayer(); renderHeader();
  } catch(e) { toast('Error: '+e.message,'error'); }
}

async function loadEndorse() {
  try {
    const offers = await api(`/economy/endorsements/${S.playerId}`);
    const active = await api(`/economy/endorsements-active/${S.playerId}`);
    $('#oc-endorse').innerHTML = offers.offers?.length ? offers.offers.map(o=>`
      <div class="flex items-center justify-between card p-3 mb-2">
        <div><span class="text-white font-semibold">${o.brand}</span><span class="text-xs text-muted ml-2">Prestige ${o.prestige}</span></div>
        <div class="flex items-center gap-3"><span class="text-sm text-good mono">$${o.annual_value}M × ${o.years}y</span>
        <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="negotiateEndorse(${o.id})">Negotiate</button>
        <button class="btn-primary !py-1.5 !px-3 text-xs" onclick="signEndorse(${o.id})">Sign</button></div>
      </div>`).join('') : '<p class="text-muted text-sm">No offers. Build your fame on the court.</p>';
    if (active.endorsements?.length) {
      $('#oc-endorse').insertAdjacentHTML('beforeend', `<div class="mt-3 text-xs text-muted">Active: ${active.endorsements.map(e=>`${e.brand_name} ($${e.annual_value}M/yr)`).join(', ')}</div>`);
    }
  } catch(e){ console.warn('loadEndorse', e); }
}

async function signEndorse(offerId) {
  try {
    const r = await api(`/economy/sign-endorsement/${S.playerId}?offer_id=${offerId}`,{method:'POST'});
    toast(`Signed with ${r.brand}!`,'success'); await refreshPlayer(); loadEndorse();
  } catch(e) { toast('Sign failed: '+e.message,'error'); }
}

async function negotiateEndorse(offerId) {
  try {
    const r = await api(`/economy/negotiate-endorsement/${S.playerId}?offer_id=${offerId}`,{method:'POST'});
    toast(r.message, r.success?'success':'warn'); await refreshPlayer(); loadEndorse();
  } catch(e) { toast('Negotiation failed: '+e.message,'error'); }
}

async function loadInvest() {
  try {
    // Populate the asset selector once.
    if (!S._assets) { try { S._assets = (await api('/economy/assets')).assets; } catch(e) { S._assets = null; } }
    const sel = $('#inv-asset');
    if (sel && S._assets && sel.options.length <= 1) {
      sel.innerHTML = Object.entries(S._assets).map(([k,a])=>`<option value="${k}">${a.icon} ${a.label}</option>`).join('');
      sel.onchange = () => { const a = S._assets[sel.value]; $('#inv-asset-desc').textContent = `${a.desc} Risk: ${a.risk}. ${a.lock>0?`Locked ${a.lock} season${a.lock>1?'s':''}.`:'Liquid.'}`; };
      sel.onchange();
    }
    const inv = await api(`/economy/investments/${S.playerId}`);
    $('#oc-invest').innerHTML = inv.investments?.length ? inv.investments.map(i=>{
      const gain = (i.current_value||0) >= (i.amount_invested||0);
      const a = S._assets?.[i.asset_type];
      const locked = (i.lock_season||0) > (S.season?.current_season||0);
      return `
      <div class="flex items-center justify-between text-sm py-1.5 border-b border-bg-border">
        <span class="text-white">${a?.icon||'💰'} ${esc(i.name)} <span class="text-xs text-muted">${locked?`🔒 until S${i.lock_season}`:'liquid'}</span></span>
        <span class="flex items-center gap-2"><span class="text-muted">$${i.amount_invested}M → <span class="${gain?'text-good':'text-bad'}">$${(i.current_value||0).toFixed(2)}M</span></span>
        <button class="btn-secondary !py-0.5 !px-2 text-xs" onclick="redeemInvestment(${i.id})">Redeem</button></span>
      </div>`;
    }).join('') : '<p class="text-muted text-sm">No investments yet.</p>';
  } catch(e){ console.warn('loadInvest', e); }
}

async function redeemInvestment(invId) {
  if (!confirm('Redeem this investment? Its current value will be added to your wealth (illiquid assets may be discounted or locked).')) return;
  try {
    const r = await api(`/economy/redeem-investment/${S.playerId}?investment_id=${invId}`, { method:'POST' });
    const extra = r.early_exit ? ` (early exit −$${r.penalty.toFixed(2)}M)` : '';
    toast(`Redeemed ${r.name} for $${r.amount.toFixed(2)}M${extra}${r.profit>=0?' (profit +$'+r.profit.toFixed(2)+'M)':' (loss $'+r.profit.toFixed(2)+'M)'}`,'success');
    await refreshPlayer(); loadInvest();
  } catch(e) { toast('Redeem failed: '+e.message,'error'); }
}

async function loadLifestyle() {
  const el = $('#oc-lifestyle'); if (!el) return;
  try {
    const r = await api('/lifestyle/tiers');
    const cur = S.player.lifestyle ?? 1;
    const curTier = r.tiers.find(t=>t.id===cur);
    el.innerHTML = `<p class="text-xs text-muted mb-2">Current: <b class="text-white">${curTier?.icon||''} ${curTier?.label||''}</b> — ${curTier?.desc||''}</p>` +
      r.tiers.map(t => `
      <button class="w-full text-left card card-hover p-2.5 mb-1.5 flex items-center justify-between ${t.id===cur?'!border-accent !bg-accent/10':''}" onclick="setLifestyle(${t.id})">
        <span class="text-sm text-white">${t.icon} ${t.label}</span>
        <span class="text-xs text-muted">${t.cost>0?`-$${t.cost}M/yr`:'free'} · fame +${t.fame}</span>
      </button>`).join('');
  } catch(e) { el.innerHTML = '<p class="text-muted text-sm">Couldn\'t load lifestyle.</p>'; }
}

async function setLifestyle(tier) {
  try {
    const r = await api(`/player/${S.playerId}/lifestyle?tier=${tier}`, { method:'PUT' });
    S.player.lifestyle = r.lifestyle; toast(`Lifestyle: ${r.icon} ${r.label}`,'success');
    loadLifestyle();
  } catch(e) { toast('Failed: '+e.message,'error'); }
}

async function hireAdvisor() {
  if (!confirm('Hire a reputable financial advisor for $2M? This sharply lowers your scam risk.')) return;
  try {
    const r = await api(`/player/${S.playerId}/advisor`, { method:'POST' });
    await refreshPlayer();
    toast(`Advisor hired — trust ${r.advisor_trust}.`,'success');
    renderOffCourt($('#main'));
  } catch(e) { toast('Failed: '+e.message,'error'); }
}

document.addEventListener('submit', async e => {
  if (e.target.id==='inv-form') {
    e.preventDefault();
    const t=$('#inv-asset').value, a=parseFloat($('#inv-amt').value);
    if(!t||!a){toast('Pick an asset and enter an amount','warn');return;}
    try { await api(`/economy/invest/${S.playerId}?asset_type=${encodeURIComponent(t)}&amount=${a}`,{method:'POST'}); await refreshPlayer(); loadInvest(); e.target.reset(); loadInvest(); } catch(err){toast('Failed: '+err.message,'error');}
  }
});

async function cloutTrade() {
  showTradeModal();
}

function showTradeModal() {
  const teams = Object.entries(S.teams||{}).map(([id,t])=>({ id, ...t })).filter(t => Number(t.id) !== S.player?.team_id);
  const overlay = document.createElement('div');
  overlay.id = 'trade-modal';
  overlay.className = 'fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="card p-5 w-full max-w-3xl max-h-[80vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-lg font-bold text-white">🔄 Demand a Trade</h3>
        <button class="text-muted text-xl" onclick="closeTradeModal()">×</button>
      </div>
      <p class="text-xs text-muted mb-4">Pick a destination. Requires 25+ clout; success isn't guaranteed.</p>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
        ${teams.map(t=>`
          <button class="card card-hover p-3 text-left" onclick="pickTradeTeam(${t.id})">
            <div class="flex items-center justify-between"><span class="font-bold text-white text-sm">${t.abbr}</span><span class="text-[10px] text-muted">${t.conf}</span></div>
            <div class="text-xs text-muted mt-0.5">${esc(t.name)}</div>
            <div class="text-[10px] ${t.ovr>=85?'text-purple-400':t.ovr>=75?'text-cyber':t.ovr>=65?'text-gray-400':'text-bad'}">OVR ${t.ovr}</div>
          </button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function closeTradeModal() { $('#trade-modal')?.remove(); }

async function pickTradeTeam(tid) {
  closeTradeModal();
  try {
    const r = await api(`/clout/request-trade/${S.playerId}?desired_team_id=${tid}`, { method:'POST' });
    toast(r.message, r.success?'success':'warn'); await refreshPlayer();
  } catch(e){ toast('Failed: '+e.message,'error'); }
}

async function cloutBuyout() {
  if (!confirm('Request a buyout? If granted, your contract ends and you become a free agent.')) return;
  try {
    const r = await api(`/clout/request-buyout/${S.playerId}`, { method:'POST' });
    toast(r.message, r.success?'success':'warn'); await refreshPlayer(); renderOffCourt($('#main'));
  } catch(e){ toast('Failed: '+e.message,'error'); }
}

async function loadContractOffers() {
  try {
    const r = await api(`/contract/offers/${S.playerId}`);
    $('#oc-contract').innerHTML = r.offers?.length ? r.offers.map(o=>`
      <div class="flex items-center justify-between card p-3 mb-2">
        <div><span class="text-white font-semibold">${o.team}</span><span class="text-xs text-muted ml-2">${o.years} yr</span>
          ${o.title_shot?`<span class="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent ml-2">🏆 Title Shot · ~${o.proj_wins} wins</span>`:''}
          ${o.title_pct>0?`<span class="text-[10px] px-1.5 py-0.5 rounded bg-good/15 text-good ml-2">${o.title_pct}% title odds</span>`:''}
          ${o.ovr>0&&o.ovr<=58?'<span class="text-[10px] px-1.5 py-0.5 rounded bg-cyber/15 text-cyber ml-2">💵 Overpay</span>':''}</div>
        <div class="flex items-center gap-3"><span class="text-sm text-good mono">$${o.annual_value}M/yr</span>
        <button class="btn-secondary !py-1.5 !px-3 text-xs" onclick="negotiateContractOffer(${o.id})">Negotiate</button>
        <button class="btn-primary !py-1.5 !px-3 text-xs" onclick="signContractOffer(${o.id})">Sign</button></div>
      </div>`).join('') : '<p class="text-muted text-sm">No offers right now.</p>';
  } catch(e){ console.warn('loadContractOffers', e); }
}

async function signContractOffer(offerId) {
  try {
    const r = await api(`/contract/sign/${S.playerId}?offer_id=${offerId}`, { method:'POST' });
    toast(`Signed with ${r.team} — $${r.annual_value}M/yr × ${r.years}y${r.player_option?' (player option)':''}!`,'success');
    await refreshPlayer(); renderOffCourt($('#main'));
  } catch(e){ toast('Sign failed: '+e.message,'error'); }
}

async function negotiateContractOffer(offerId) {
  try {
    const r = await api(`/contract/negotiate/${S.playerId}?offer_id=${offerId}`, { method:'POST' });
    toast(r.message, r.success?'success':'warn');
    await refreshPlayer(); loadContractOffers();
  } catch(e){ toast('Negotiation failed: '+e.message,'error'); }
}

async function loadLife() {
  const el = $('#oc-life'); if (!el) return;
  try {
    const r = await api(`/life/overview/${S.playerId}`);
    const rels = r.relationships || [];
    const events = r.events || [];
    const typeIcon = { family: '👪', partner: '💞', friend: '🤝', mentor: '🧭', agent: '📄', advisor: '💰', rival: '⚔️' };
    const relHtml = rels.length ? rels.map(x=>`
      <div class="flex items-center justify-between py-1.5 border-b border-bg-border last:border-0">
        <span class="text-sm text-white">${typeIcon[x.type]||'👤'} ${esc(x.name)} <span class="text-xs text-muted">${x.type}</span></span>
        <span class="flex items-center gap-2">
          <div class="bar-track w-20"><div class="bar-fill" style="width:${x.bond}%;background:${x.bond>=60?'#34d399':x.bond>=40?'#f59e0b':'#f87171'}"></div></div>
          <span class="mono text-xs ${x.bond>=60?'text-good':x.bond>=40?'text-warn':'text-bad'}">${x.bond}</span>
          ${x.status!=='active'?`<span class="text-[10px] text-faint">${x.status}</span>`:''}
        </span>
      </div>`).join('') : '<p class="text-muted text-sm">No one in your circle yet. Life will find you.</p>';

    const evHtml = events.map(ev => `
      <div class="mt-3 rounded-lg bg-bg-hover border border-bg-border p-3">
        <p class="text-xs text-muted mb-1">${ev.intro ? '✨ New connection' : `${typeIcon[ev.type]||'👤'} ${esc(ev.name||'')}`}</p>
        <p class="text-white text-sm font-medium mb-2">"${esc(pick(ev.event.question, S.season?.lang))}"</p>
        <div class="space-y-1.5">
          ${ev.event.choices.map((c,i)=>`<button class="w-full text-left card card-hover p-2.5 text-sm" onclick="respondLife('${ev.event.id}',${i},${ev.relationship_id??'null'})">${esc(pick(c.text, S.season?.lang))}</button>`).join('')}
        </div>
      </div>`).join('');

    el.innerHTML = relHtml + evHtml;
  } catch(e) { el.innerHTML = '<p class="text-muted text-sm">Couldn\'t load life.</p>'; }
}

async function respondLife(eventId, choiceIndex, relationshipId) {
  try {
    const q = `/life/respond/${S.playerId}?event_id=${encodeURIComponent(eventId)}&choice_index=${choiceIndex}` + (relationshipId!=null?`&relationship_id=${relationshipId}`:'');
    await api(q, { method:'POST' });
    await refreshPlayer(); renderHeader(); loadLife();
  } catch(e) { toast('Failed: '+e.message,'error'); }
}

async function loadLockerRoom() {
  const el = $('#oc-teammates'); if (!el) return;
  try {
    const r = await api(`/player/${S.playerId}/teammates`);
    const tms = r.teammates || [];
    const left = (r.actions_max||0) - (r.actions_used||0);
    el.innerHTML = (tms.length ? tms.map(t=>`
      <div class="flex items-center justify-between py-1.5 border-b border-bg-border last:border-0">
        <span class="text-sm text-white">${esc(t.name)} <span class="text-xs text-muted">${t.position}</span></span>
        <span class="flex items-center gap-2">
          <div class="bar-track w-20"><div class="bar-fill" style="width:${t.bond}%;background:${t.bond>=60?'#34d399':t.bond>=40?'#f59e0b':'#f87171'}"></div></div>
          <span class="mono text-xs ${t.bond>=60?'text-good':t.bond>=40?'text-warn':'text-bad'}">${t.bond}</span>
          <button class="btn-secondary !py-0.5 !px-2 text-xs" ${left<=0?'disabled':''} onclick="lockerAction(${t.id})">Bond</button>
        </span>
      </div>`).join('') : '<p class="text-muted text-sm">No locker room yet.</p>') +
      `<p class="text-xs text-faint mt-2">Team chemistry: <b class="text-white">${r.chemistry ?? '—'}</b> · ${left} of ${r.actions_max} team dinners left</p>`;
  } catch(e) { el.innerHTML = '<p class="text-muted text-sm">Couldn\'t load the locker room.</p>'; }
}

async function lockerAction(teammateId) {
  try {
    const r = await api(`/player/${S.playerId}/locker-action?teammate_id=${teammateId}`, { method:'POST' });
    toast(r.message, r.success?'success':'warn');
    await refreshPlayer(); loadLockerRoom();
  } catch(e) { toast('Failed: '+e.message,'error'); }
}

// ============================================================
// LEAGUE
// ============================================================
async function renderLeague(m) {
  m.innerHTML = `
    <div class="space-y-5">
      <div class="card p-5"><h3 class="text-sm font-semibold text-gray-300 mb-1">Standings</h3><p class="text-xs text-faint mb-3">Records update as the season progresses. Your team shows your actual record; other teams are projections.</p><div id="lg-stand">Loading…</div></div>
      <div class="card p-5"><h3 class="text-sm font-semibold text-gray-300 mb-1">League's Best Players</h3><p class="text-xs text-faint mb-3">The rest of the NBA develops, ages, and turns over every offseason.</p><div id="lg-players">Loading…</div></div>
      <div class="card p-5"><h3 class="text-sm font-semibold text-gray-300 mb-1">🏆 MVP Race</h3><p class="text-xs text-faint mb-3">How you stack up against the league's stars this season.</p><div id="lg-mvp">Loading…</div></div>
      <div class="card p-5"><h3 class="text-sm font-semibold text-gray-300 mb-1">📊 Stat Leaders</h3><p class="text-xs text-faint mb-3">Points / rebounds / assists / steals / blocks — your real numbers vs the league's stars.</p><div id="lg-leaders">Loading…</div></div>
      <div class="card p-5"><h3 class="text-sm font-semibold text-gray-300 mb-1">League Moves</h3><p class="text-xs text-faint mb-3">Trades and free-agent signings from the last offseason.</p><div id="lg-moves">Loading…</div></div>
    </div>`;
  try {
    const s = await api(`/league/standings${S.playerId ? `?player_id=${S.playerId}` : ''}`);
    const conf = (title, teams) => `
      <h4 class="text-xs font-semibold text-muted mt-3 mb-1">${title}</h4>
      <div class="overflow-x-auto"><table class="w-full text-xs sortable-table"><thead><tr class="text-muted border-b border-bg-border text-left">
        <th class="py-1 pr-2">#</th><th class="pr-2">Team</th><th class="pr-2 text-center">W</th><th class="pr-2 text-center">L</th><th class="pr-2 text-center">Win%</th><th class="pr-2 text-center">OVR</th></tr></thead>
      <tbody>${teams.map((t,i)=>`<tr class="border-b border-bg-border hover:bg-bg-hover ${t.team_id===S.player?.team_id?'bg-accent/5':''}">
        <td class="py-1 pr-2 text-faint">${i+1}</td><td class="pr-2 font-semibold ${t.team_id===S.player?.team_id?'text-accent':'text-white'}">${t.name} ${t.team_id===S.player?.team_id?'⭐':''}</td>
        <td class="pr-2 text-center" data-sort-value="${t.wins}">${t.wins}</td><td class="pr-2 text-center" data-sort-value="${t.losses}">${t.losses}</td>
        <td class="pr-2 text-center mono" data-sort-value="${((t.wins+t.losses)>0?(t.wins/(t.wins+t.losses)):0).toFixed(3)}">${((t.wins+t.losses)>0?(t.wins/(t.wins+t.losses)):0).toFixed(3)}</td>
        <td class="text-center" data-sort-value="${t.overall}"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${t.overall>=90?'bg-purple-400/10 text-purple-400':t.overall>=80?'bg-cyber/10 text-cyber':t.overall>=70?'bg-gray-400/10 text-gray-400':'bg-bad/10 text-bad'}">${t.overall}</span></td>
      </tr>`).join('')}</tbody></table></div>`;
    $('#lg-stand').innerHTML = conf('EASTERN CONFERENCE', s.east) + conf('WESTERN CONFERENCE', s.west);
    $('#lg-stand').querySelectorAll('.sortable-table').forEach(t => makeSortable(t));
  } catch(e) { $('#lg-stand').innerHTML = '<p class="text-bad">Failed to load standings</p>'; }
  loadLeaguePlayers();
  loadLeagueMoves();
  loadMvpRace();
  loadLeaders();
}

async function loadLeaders() {
  try {
    const r = await api(`/league/leaders/${S.playerId}`);
    const col = (title, key, arr) => `
      <div class="flex-1 min-w-[140px]">
        <p class="text-xs font-semibold text-muted mb-1">${title}</p>
        ${(arr||[]).map((p,i)=>`<div class="flex items-center justify-between py-1 border-b border-bg-border last:border-0 text-xs">
          <span class="${p.is_player?'text-accent font-bold':'text-white'}">${i+1}. ${esc(p.name)}${p.is_player?' ⭐':''}</span>
          <span class="mono text-gray-200">${p.val}</span>
        </div>`).join('')}
      </div>`;
    $('#lg-leaders').innerHTML = `<div class="flex flex-wrap gap-4">${col('Points', 'val', r.points)}${col('Rebounds', 'val', r.rebounds)}${col('Assists', 'val', r.assists)}${col('Steals', 'val', r.steals)}${col('Blocks', 'val', r.blocks)}</div>`;
  } catch(e) { $('#lg-leaders').innerHTML = '<p class="text-muted text-sm">Couldn\'t load leaders.</p>'; }
}

async function loadMvpRace() {
  try {
    const r = await api(`/league/mvp-race/${S.playerId}`);
    const race = r.race || [];
    $('#lg-mvp').innerHTML = race.length ? race.map((p,i)=>`
      <div class="flex items-center justify-between py-1.5 border-b border-bg-border last:border-0 text-sm">
        <span class="${p.is_player?'text-accent font-bold':'text-white'}">${i+1}. ${esc(p.name)} ${p.is_player?'⭐':''}</span>
        <span class="text-muted">${p.team_abbr} · <span class="mono ${p.is_player?'text-accent':'text-gray-200'}">${p.score}</span></span>
      </div>`).join('') : '<p class="text-muted text-sm">No MVP race data yet.</p>';
  } catch(e) { $('#lg-mvp').innerHTML = '<p class="text-muted text-sm">Couldn\'t load MVP race.</p>'; }
}

async function loadLeagueMoves() {
  try {
    const r = await api(`/league/moves/${S.playerId}?limit=15`);
    const moves = r.moves || [];
    $('#lg-moves').innerHTML = moves.length ? moves.map(m=>`
      <div class="flex items-start gap-2 py-1.5 border-b border-bg-border last:border-0 text-sm">
        <span class="text-xs w-8 mono text-faint shrink-0">S${m.season_number}</span>
        <span class="text-gray-200">${esc(m.description)}</span>
      </div>`).join('') : '<p class="text-muted text-sm">No league moves yet — they happen each offseason.</p>';
  } catch(e) { $('#lg-moves').innerHTML = '<p class="text-muted text-sm">Couldn\'t load moves.</p>'; }
}

async function loadLeaguePlayers() {
  try {
    const r = await api(`/league/players?player_id=${S.playerId}&limit=30`);
    const rows = r.players || [];
    $('#lg-players').innerHTML = rows.length ? `
      <div class="overflow-x-auto"><table class="w-full text-xs sortable-table">
        <thead><tr class="text-muted border-b border-bg-border text-left">
          <th class="py-1.5 pr-2" data-no-sort>#</th><th class="pr-2" data-no-sort>Player</th><th class="pr-2" data-no-sort>Pos</th><th class="pr-2" data-no-sort>Team</th><th class="pr-2 text-center">Age</th><th class="pr-2 text-center">OVR</th><th class="pr-2 text-center">Pot</th><th class="text-center">Sal</th>
        </tr></thead>
        <tbody>${rows.map((p,i)=>`
          <tr class="border-b border-bg-border">
            <td class="py-1 pr-2 text-faint">${i+1}</td>
            <td class="pr-2 text-white font-semibold">${esc(p.name)}${p.injury_games>0?` <span class="text-bad" title="Out ${p.injury_games} games">🏥</span>`:''}${p.rest_games>0?` <span class="text-warn" title="Resting">😴</span>`:''}</td>
            <td class="pr-2 text-muted">${p.position}</td>
            <td class="pr-2 text-muted">${p.team_abbr}</td>
            <td class="pr-2 text-center text-muted" data-sort-value="${p.age}">${p.age}</td>
            <td class="pr-2 text-center" data-sort-value="${p.overall}"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${p.overall>=90?'bg-purple-400/10 text-purple-400':p.overall>=80?'bg-cyber/10 text-cyber':p.overall>=70?'bg-gray-400/10 text-gray-400':'bg-bad/10 text-bad'}">${p.overall}</span></td>
            <td class="pr-2 text-center text-faint" data-sort-value="${p.potential}">${p.potential}</td>
            <td class="text-center text-muted mono" data-sort-value="${(p.salary||0).toFixed(1)}">$${(p.salary||0).toFixed(1)}M</td>
          </tr>`).join('')}</tbody>
      </table></div>` : '<p class="text-muted text-sm">No players yet.</p>';
    if (rows.length) $('#lg-players').querySelectorAll('.sortable-table').forEach(t => makeSortable(t));
  } catch(e) { $('#lg-players').innerHTML = '<p class="text-muted text-sm">Couldn\'t load players.</p>'; }
}

// ============================================================
// SAVE/LOAD
// ============================================================
function renderSaves(m) {
  m.innerHTML = `
    <div class="space-y-5">
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">Save</h3>
        <form id="save-form" class="flex gap-2">
          <input id="save-name" placeholder="Save name" required class="flex-1 bg-bg border border-bg-border rounded-lg px-3 py-2 text-sm text-white outline-none">
          <button class="btn-primary" type="submit">Save</button>
        </form>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">${t('Saved Games')}</h3>
        <div id="saves-list"></div>
      </div>
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-gray-300 mb-3">Export</h3>
        <button class="btn-secondary" onclick="exportCareer()">📥 Download Career JSON</button>
      </div>
    </div>`;
  loadSaves();
  $('#save-form').onsubmit = async e => {
    e.preventDefault();
    const n = $('#save-name').value.trim(); if(!n) return;
    const r = await api(`/save/${S.playerId}?save_name=${encodeURIComponent(n)}`,{method:'POST'});
    toast(`Saved (S${r.season})`,'success'); loadSaves();
  };
}
async function loadSaves() {
  const saves = await api(`/saves/${S.playerId}`);
  $('#saves-list').innerHTML = saves.saves?.length ? saves.saves.map(s=>`
    <div class="flex justify-between items-center card p-3 mb-2">
      <span class="text-white font-semibold">${esc(s.save_name)}</span>
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted mono">S${s.season_number}</span>
        <button class="btn-secondary !py-1 !px-2.5 text-xs" onclick="loadSave('${s.id}')">Load</button>
        <button class="btn-danger !py-1 !px-2.5 text-xs" onclick="deleteSave('${s.id}')">Delete</button>
      </div>
    </div>`).join('') : '<p class="text-muted text-sm">No saves yet.</p>';
}

async function deleteSave(saveId) {
  if (!confirm('Delete this save? This cannot be undone.')) return;
  try {
    await api(`/save/${saveId}`, { method:'DELETE' });
    toast('Save deleted','success'); loadSaves();
  } catch(e) { toast('Delete failed: '+e.message,'error'); }
}

async function loadSave(saveId) {
  if (!confirm('Load this save? This will overwrite your current progress.')) return;
  try {
    await api(`/load/${S.playerId}?save_id=${saveId}`, { method:'POST' });
    await refreshPlayer(); await refreshSeason();
    toast('Save loaded','success'); switchTab('dashboard');
  } catch(e) { toast('Load failed: '+e.message,'error'); }
}
async function exportCareer() {
  const d = await api(`/career/export/${S.playerId}`);
  const blob = new Blob([JSON.stringify(d,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=`${S.player.name.replace(/\s/g,'_')}_career.json`; a.click();
  URL.revokeObjectURL(url);
}
