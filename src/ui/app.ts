import { computeElo, playerStats, type HistMatch } from '../engine/elo';
import { GameView } from '../game/view';
import { runClient } from '../game/client';
import { PLAYER_COLORS, runHost } from '../game/host';
import type { PlayerInfo, RoomMeta, RoomPlayer, Rules } from '../game/protocol';
import { getLang, onLang, setLang, t, type Key } from '../i18n';
import { getBackend, type AuthUser, type Backend } from '../net/backend';
import { h } from './prompts';

let backend: Backend | null = null;
let user: AuthUser | null = null;
let root: HTMLElement;
let render: () => void = () => undefined;
let cleanup: (() => void)[] = [];

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const MAX_PLAYERS = 6;

function go(screen: () => void) {
  cleanup.forEach((f) => f()); cleanup = [];
  render = screen;
  screen();
}

// ---------------------------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------------------------
function topbar(opts: { back?: () => void } = {}) {
  const lang = h('div', { class: 'seg' }, ...(['en', 'it'] as const).map((l) => {
    const b = h('button', { class: 'opt' + (getLang() === l ? ' on' : ''), 'aria-label': l }, l.toUpperCase());
    b.onclick = () => { setLang(l); };
    return b;
  }));
  const acct = h('div', { class: 'row', style: 'margin:0' });
  if (user) {
    acct.append(h('span', { class: 'chip' }, user.guest ? t('guestAs', { name: user.name }) : t('loggedAs', { name: user.name })));
    const out = h('button', { class: 'opt' }, t('logout')); out.onclick = async () => { await backend?.signOut(); }; acct.append(out);
  } else if (backend) {
    const b = h('button', { class: 'opt' }, t('login')); b.onclick = () => loginModal(); acct.append(b);
  }
  const bar = h('div', { class: 'topbar' }, h('span', { class: 'logo t' }, t('appName')), h('div', { class: 'grow' }), acct, lang);
  if (opts.back) { const b = h('button', { class: 'opt' }, '← ' + t('back')); b.onclick = opts.back; bar.prepend(b); }
  return bar;
}

function page(...kids: Node[]) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'page' }, ...kids);
  root.append(wrap);
  return wrap;
}

function loginModal(onDone?: () => void, ranked = false) {
  const googleBtn = () => {
    const b = h('button', { class: 'opt google' }, t('withGoogle'));
    b.prepend(h('span', { class: 'g' }, 'G'));
    b.onclick = async () => {
      try { await backend?.signInGoogle(); if (user) { wrap.remove(); onDone?.(); } } catch (e) { const el = wrap.querySelector('.err'); if (el) el.textContent = t('authError', { msg: (e as Error).message.replace('Firebase: ', '') }); }
    };
    return b;
  };
  let mode: 'login' | 'register' | 'guest' = ranked ? 'login' : 'login';
  const wrap = h('div', { class: 'modal' });
  const draw = () => {
    wrap.innerHTML = '';
    const err = h('p', { class: 'err' });
    const email = h('input', { type: 'email', placeholder: t('email'), autocomplete: 'email' });
    const pw = h('input', { type: 'password', placeholder: t('password'), autocomplete: mode === 'register' ? 'new-password' : 'current-password' });
    const name = h('input', { placeholder: mode === 'guest' ? t('guestName') : t('displayName'), maxlength: '16' });
    const go1 = h('button', { class: 'go' }, mode === 'login' ? t('login') : mode === 'register' ? t('register') : t('playAsGuest'));
    const fields = mode === 'guest' ? [name] : mode === 'login' ? [email, pw] : [name, email, pw];
    const submit = async () => {
      err.textContent = '';
      try {
        if (!backend) return;
        if (mode === 'login') await backend.signIn(email.value.trim(), pw.value);
        else if (mode === 'register') { if (!name.value.trim()) throw new Error(t('displayName')); await backend.signUp(email.value.trim(), pw.value, name.value.trim()); }
        else { if (!name.value.trim()) throw new Error(t('guestName')); await backend.signInGuest(name.value.trim()); }
        wrap.remove(); onDone?.();
      } catch (e) { err.textContent = t('authError', { msg: (e as Error).message.replace('Firebase: ', '') }); }
    };
    go1.onclick = submit;
    const switchTo = (m: typeof mode, label: Key) => { const b = h('button', { class: 'link' }, t(label)); b.onclick = () => { mode = m; draw(); }; return b; };
    const sheet = h('div', { class: 'sheet small' }, h('h2', {}, t('account')),
      ranked ? h('p', { class: 'sub' }, t('needLoginRanked')) : h('span'),
      ...(mode !== 'guest' ? [googleBtn(), h('p', { class: 'mut center-t' }, t('or'))] : []),
      h('div', { class: 'stack' }, ...fields), err, go1,
      h('div', { class: 'stack center' },
        mode === 'login' ? switchTo('register', 'noAccount') : switchTo('login', 'haveAccount'),
        ...(!ranked && mode !== 'guest' ? [switchTo('guest', 'playAsGuest')] : [])));
    const close = h('button', { class: 'opt' }, t('back')); close.onclick = () => wrap.remove();
    sheet.append(close);
    wrap.append(sheet);
    fields[0].focus?.();
    for (const f of fields) f.onkeydown = (ev) => { if ((ev as KeyboardEvent).key === 'Enter') void submit(); };
  };
  draw();
  root.append(wrap);
}

async function ensureUser(ranked: boolean): Promise<boolean> {
  if (user && (!ranked || !user.guest)) return true;
  return new Promise((res) => {
    loginModal(() => res(!!user && (!ranked || !user.guest)), ranked);
    const iv = setInterval(() => { if (!document.querySelector('.modal .sheet.small')) { clearInterval(iv); res(!!user && (!ranked || !user.guest)); } }, 300);
  });
}

// ---------------------------------------------------------------------------------------------
// screens
// ---------------------------------------------------------------------------------------------
function home() {
  const tile = (title: Key, sub: Key, on: () => void, cls = '') => {
    const b = h('button', { class: 'tile ' + cls }, h('b', { class: 't' }, t(title)), h('span', {}, t(sub)));
    b.onclick = on; return b;
  };
  const online = tile('onlineGame', 'onlineGameSub', () => go(onlineMenu), 'acc');
  if (!backend) { online.setAttribute('disabled', ''); online.append(h('em', {}, t('offline'))); }
  page(topbar(), h('p', { class: 'lead' }, t('homeSub')), h('div', { class: 'menu-grid' }, tile('localGame', 'localGameSub', () => go(localSetup), 'yel'), online, tile('myResults', 'myResultsSub', () => go(results), '')));
}

function localSetup() {
  let n = 4;
  const human = [true, false, false, false, false, false];
  const names = ['1', '2', '3', '4', '5', '6'].map((i) => `${t('player')} ${i}`);
  const count = h('div', { class: 'row' });
  const list = h('div', { class: 'plist' });
  const draw = () => {
    count.innerHTML = ''; list.innerHTML = '';
    for (let k = 2; k <= 6; k++) { const b = h('button', { class: 'opt' + (k === n ? ' on' : '') }, String(k)); b.onclick = () => { n = k; draw(); }; count.append(b); }
    for (let i = 0; i < n; i++) {
      const name = h('input', { value: names[i] }); name.oninput = () => { names[i] = name.value; };
      const tg = h('button', { class: 'opt' }, human[i] ? t('human') : `${t('bot')} 🤖`); tg.onclick = () => { human[i] = !human[i]; draw(); };
      list.append(h('div', { class: 'prow' }, h('span', { class: 'dot', style: `background:${PLAYER_COLORS[i]}` }, String(i + 1)), name, tg));
    }
    if (n === 2) list.append(h('p', { class: 'sub' }, t('twoPlayerNote')));
  };
  draw();
  const start = h('button', { class: 'go' }, t('startGame'));
  start.onclick = () => {
    const players: PlayerInfo[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: names[i].trim() || `${t('player')} ${i + 1}`, bot: !human[i], color: PLAYER_COLORS[i] }));
    void playGame(() => runHost({ rules: 'friendly', players, local: new Set(players.filter((p) => !p.bot).map((p) => p.id)), seed: Date.now(), ranked: false }, view!), () => go(home));
  };
  let view: GameView | null = null;
  const playGame = async (run: () => Promise<void>, exit: () => void) => {
    cleanup.forEach((f) => f()); cleanup = [];
    view = new GameView(root);
    view.onExit = exit;
    await run();
    if (view) { view.destroy(); view = null; }
    exit();
  };
  page(topbar({ back: () => go(home) }), h('div', { class: 'panel narrow' }, h('h2', {}, t('localSetup')), count, list, start));
}

function onlineMenu() {
  let rules: Rules = 'friendly';
  const sel = h('div', { class: 'row' });
  const info = h('p', { class: 'sub' });
  const err = h('p', { class: 'err' });
  const drawRules = () => {
    sel.innerHTML = '';
    for (const [r, k] of [['friendly', 'rulesFriendly'], ['tournament', 'rulesTournament']] as [Rules, Key][]) {
      const b = h('button', { class: 'opt' + (rules === r ? ' on' : '') }, t(k)); b.onclick = () => { rules = r; drawRules(); }; sel.append(b);
    }
    info.textContent = t(rules === 'friendly' ? 'rulesFriendlyInfo' : 'rulesTournamentInfo');
  };
  drawRules();
  const create = h('button', { class: 'go' }, t('createRoom'));
  create.onclick = async () => {
    err.textContent = '';
    if (!backend || !(await ensureUser(rules === 'tournament'))) { if (rules === 'tournament') err.textContent = t('needLoginRanked'); return; }
    let code = '';
    for (let i = 0; i < 8; i++) { const c = newCode(); if (!(await backend.get(`rooms/${c}/meta`))) { code = c; break; } }
    const me = user!;
    await backend.set(`rooms/${code}/meta`, { host: me.uid, rules, status: 'lobby', created: Date.now() } satisfies RoomMeta);
    await backend.set(`rooms/${code}/players/${me.uid}`, { uid: me.uid, name: me.name, guest: me.guest, joined: Date.now() } satisfies RoomPlayer);
    go(() => lobby(code));
  };
  const code = h('input', { class: 'codein', maxlength: '4', placeholder: 'ABCD', autocapitalize: 'characters' });
  const joinBtn = h('button', { class: 'go alt' }, t('join'));
  const doJoin = async () => { err.textContent = ''; const m = await joinRoom(code.value.toUpperCase().replace(/[^A-Z]/g, '')); if (m) err.textContent = m; };
  joinBtn.onclick = doJoin;
  code.onkeydown = (e) => { if (e.key === 'Enter') void doJoin(); };
  page(topbar({ back: () => go(home) }),
    h('div', { class: 'menu-grid two' },
      h('div', { class: 'panel' }, h('h2', {}, t('createRoom')), h('label', {}, t('rules')), sel, info, create),
      h('div', { class: 'panel' }, h('h2', {}, t('joinRoom')), h('label', {}, t('roomCode')), code, joinBtn)),
    err);
}

async function joinRoom(code: string): Promise<string | null> {
  if (!backend || code.length !== 4) return t('roomNotFound');
  const meta = await backend.get<RoomMeta>(`rooms/${code}/meta`);
  if (!meta) return t('roomNotFound');
  if (!(await ensureUser(meta.rules === 'tournament'))) return t(meta.rules === 'tournament' ? 'needRankedAccount' : 'needLoginRanked');
  const me = user!;
  const players = (await backend.get<Record<string, RoomPlayer>>(`rooms/${code}/players`)) ?? {};
  if (meta.status !== 'lobby') {
    if (meta.order?.includes(me.uid)) { go(() => lobby(code)); return null; } // rejoin a running game
    return t('roomStarted');
  }
  if (!players[me.uid] && Object.keys(players).length >= MAX_PLAYERS) return t('roomFull');
  await backend.set(`rooms/${code}/players/${me.uid}`, { uid: me.uid, name: me.name, guest: me.guest, joined: players[me.uid]?.joined ?? Date.now() } satisfies RoomPlayer);
  go(() => lobby(code));
  return null;
}

function lobby(code: string) {
  const b = backend!;
  const me = user!;
  let meta: RoomMeta | null = null;
  let players: Record<string, RoomPlayer> = {};
  let view: GameView | null = null;
  let started = false;
  const stopMeta = b.watch<RoomMeta>(`rooms/${code}/meta`, (m) => { meta = m; if (m?.status === 'playing' && !started && m.host !== me.uid) { startClient(m); return; } draw(); });
  const stopPl = b.watch<Record<string, RoomPlayer>>(`rooms/${code}/players`, (p) => { players = p ?? {}; draw(); });
  cleanup.push(stopMeta, stopPl);

  const seats = (): string[] => {
    const ids = Object.keys(players).sort((a, c) => players[a].joined - players[c].joined);
    const order = (meta?.order ?? []).filter((i) => ids.includes(i));
    return [...order, ...ids.filter((i) => !order.includes(i))];
  };
  const toInfo = (ids: string[]): PlayerInfo[] => ids.map((id, i) => ({ id, name: players[id].name, bot: !!players[id].bot, color: PLAYER_COLORS[i % PLAYER_COLORS.length] }));

  function startClient(m: RoomMeta) {
    started = true;
    cleanup.forEach((f) => f()); cleanup = [];
    view = new GameView(root);
    view.onExit = () => { stop(); view?.destroy(); view = null; go(home); };
    const stop = runClient(b, code, me.uid, view);
    void m;
  }

  async function startHost() {
    const ids = seats();
    started = true;
    await b.update(`rooms/${code}/meta`, { status: 'playing', order: ids });
    cleanup.forEach((f) => f()); cleanup = [];
    view = new GameView(root);
    const v = view;
    v.onExit = () => undefined;
    await runHost({ rules: meta!.rules, players: toInfo(ids), local: new Set([me.uid]), net: { backend: b, code }, seed: Date.now(), ranked: meta!.rules === 'tournament' }, v);
    v.destroy(); view = null;
    go(home);
  }

  function draw() {
    if (started || !meta) { if (!meta && !started) page(topbar(), h('p', { class: 'lead' }, t('loading'))); return; }
    const isHost = meta.host === me.uid;
    const ids = seats();
    const ranked = meta.rules === 'tournament';
    const link = `${location.origin}${location.pathname}#${code}${new URLSearchParams(location.search).get('backend') === 'local' ? '' : ''}`;
    const rows = ids.map((id, i) => {
      const p = players[id];
      const row = h('div', { class: 'prow' }, h('span', { class: 'dot', style: `background:${PLAYER_COLORS[i % PLAYER_COLORS.length]}` }, String(i + 1)),
        h('b', { class: 'grow' }, `${p.name}${p.bot ? ' 🤖' : ''}`), id === meta!.host ? h('span', { class: 'chip' }, t('hostBadge')) : h('span'), id === me.uid ? h('span', { class: 'chip yel' }, t('you')) : h('span'));
      if (isHost) {
        const up = h('button', { class: 'opt sm' }, '↑'); up.onclick = () => { const o = [...ids]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; void b.update(`rooms/${code}/meta`, { order: o }); };
        const dn = h('button', { class: 'opt sm' }, '↓'); dn.onclick = () => { const o = [...ids]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; void b.update(`rooms/${code}/meta`, { order: o }); };
        if (i === 0) up.setAttribute('disabled', ''); else up.removeAttribute('disabled');
        if (i === ids.length - 1) dn.setAttribute('disabled', '');
        row.append(up, dn);
        if (p.bot) { const rm = h('button', { class: 'opt sm' }, t('removeBot')); rm.onclick = () => void b.remove(`rooms/${code}/players/${id}`); row.append(rm); }
      }
      return row;
    });
    const hasBotOrGuest = ids.some((i) => players[i].bot || players[i].guest);
    const msg = ids.length < 2 ? t('needTwo') : ranked && hasBotOrGuest ? t('rankedNoBots') : '';
    const start = h('button', { class: 'go' }, t('startGame'));
    if (msg) start.setAttribute('disabled', '');
    start.onclick = () => void startHost();
    const leave = h('button', { class: 'opt' }, t('leaveRoom'));
    leave.onclick = async () => { if (isHost) await b.update(`rooms/${code}/meta`, { status: 'done' }); else await b.remove(`rooms/${code}/players/${me.uid}`); go(home); };
    const copy = h('button', { class: 'opt sm' }, t('copyLink'));
    copy.onclick = () => { void navigator.clipboard?.writeText(link); copy.textContent = t('copied'); };
    const addBot = h('button', { class: 'opt' }, '+ ' + t('addBot'));
    addBot.onclick = () => { const id = 'bot_' + Math.random().toString(36).slice(2, 6); void b.set(`rooms/${code}/players/${id}`, { uid: id, name: `${t('bot')} ${ids.filter((i) => players[i].bot).length + 1}`, guest: true, bot: true, joined: Date.now() } satisfies RoomPlayer); };
    page(topbar(),
      h('div', { class: 'panel' },
        h('div', { class: 'row left' }, h('h2', {}, t('lobby')), h('span', { class: 'chip ' + (ranked ? 'acc' : 'yel') }, t(ranked ? 'tournamentBadge' : 'friendlyBadge'))),
        h('p', { class: 'sub' }, t('lobbyJoin')),
        h('div', { class: 'row left' }, h('span', { class: 'code' }, code), copy),
        h('p', { class: 'mut breakall' }, link),
        h('h3', { class: 't' }, `${t('seatOrder')} (${ids.length})`),
        h('div', { class: 'plist' }, ...rows),
        isHost ? h('div', { class: 'row left' }, ...(ranked ? [] : [addBot])) : h('p', { class: 'sub' }, t('waitingHost')),
        msg && isHost ? h('p', { class: 'err' }, msg) : h('span'),
        h('div', { class: 'row left' }, ...(isHost ? [start] : []), leave)));
  }
  draw();
}

function results() {
  const draw = (hist: HistMatch[]) => {
    const e = computeElo(hist);
    const mine = user && !user.guest ? user.uid : null;
    const board = Object.entries(e.ratings).map(([uid, r]) => ({ uid, ...r })).sort((a, c) => c.r - a.r);
    const kids: Node[] = [topbar({ back: () => go(home) }), h('h1', { class: 't title' }, t('resultsTitle')), h('p', { class: 'sub' }, `${t('skulo')} · ${t('skuloFull')}`)];
    if (!mine) {
      const b = h('button', { class: 'go' }, t('login')); b.onclick = () => loginModal(undefined, true);
      kids.push(h('div', { class: 'panel' }, h('p', {}, t('loginToSee')), b));
    } else {
      const st = playerStats(hist, mine);
      const rating = e.ratings[mine]?.r ?? 1500;
      const stat = (k: Key, v: string | number) => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, t(k)), h('b', { class: 't' }, String(v)));
      kids.push(h('div', { class: 'panel' }, h('div', { class: 'rating' }, h('span', { class: 'lbl' }, t('yourRating')), h('b', { class: 't big' }, String(rating)), h('span', { class: 'mut' }, t('skulo'))),
        h('div', { class: 'stats' }, stat('matches', st.matches), stat('winsLabel', st.wins), stat('podiums', st.podiums), stat('winRate', st.winRate === null ? '—' : st.winRate + '%'), stat('avgPoints', st.avgPoints), stat('bestScore', st.best), stat('raceWins', st.raceWins))));
      kids.push(h('div', { class: 'panel' }, h('h3', { class: 't' }, t('ratingChart')), chart(e, mine)));
      const mineList = e.list.filter((m) => m.players.some((p) => p.uid === mine)).reverse();
      const rows = mineList.map((m) => {
        const p = m.players.find((x) => x.uid === mine)!, ch = e.per[m.id]?.[mine];
        return h('tr', {}, h('td', {}, new Date(m.date).toLocaleDateString(getLang() === 'it' ? 'it-IT' : 'en-GB')), h('td', {}, `${p.pos}/${m.players.length}`), h('td', {}, String(p.p)), h('td', { class: ch && ch.d < 0 ? 'neg' : 'pos' }, ch ? `${ch.d > 0 ? '+' : ''}${ch.d} → ${ch.a}` : ''));
      });
      kids.push(h('div', { class: 'panel' }, h('h3', { class: 't' }, t('history')),
        rows.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...(['date', 'position', 'points', 'change'] as Key[]).map((k) => h('th', {}, t(k))))), h('tbody', {}, ...rows)) : h('p', { class: 'sub' }, t('noHistory'))));
    }
    const lb = board.map((r, i) => h('tr', { class: r.uid === mine ? 'me' : '' }, h('td', {}, String(i + 1)), h('td', {}, r.name), h('td', {}, String(r.r)), h('td', {}, String(r.n))));
    kids.push(h('div', { class: 'panel' }, h('h3', { class: 't' }, t('ranking')),
      lb.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, t('player')), h('th', {}, t('skulo')), h('th', {}, t('matches')))), h('tbody', {}, ...lb)) : h('p', { class: 'sub' }, t('noRanking'))));
    page(...kids);
  };
  page(topbar({ back: () => go(home) }), h('p', { class: 'lead' }, t('loading')));
  if (!backend) { draw([]); return; }
  cleanup.push(backend.watch<Record<string, HistMatch>>('history', (v) => draw(Object.values(v ?? {}))));
}

function chart(e: ReturnType<typeof computeElo>, uid: string): Node {
  const ser = e.series[uid] ?? [];
  const W = 640, H = 220, m = { l: 44, r: 16, t: 14, b: 26 };
  const vals = [1500, ...ser.map((s) => s.r)];
  let lo = Math.min(...vals) - 20, hi = Math.max(...vals) + 20;
  lo = Math.floor(lo / 25) * 25; hi = Math.ceil(hi / 25) * 25; if (hi === lo) hi = lo + 25;
  const X = (i: number) => m.l + ((i + 1) / Math.max(1, ser.length)) * (W - m.l - m.r), Y = (v: number) => m.t + ((hi - v) / (hi - lo)) * (H - m.t - m.b);
  const pts = [[m.l, Y(1500)], ...ser.map((s, i) => [X(i), Y(s.r)])];
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'elochart');
  const grid = [lo, 1500, hi].filter((v, i, a) => a.indexOf(v) === i && v >= lo && v <= hi).map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v === 1500 ? '#8f8ca8' : '#e3e3ee'}" ${v === 1500 ? 'stroke-dasharray="4 4"' : ''}/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join('');
  svg.innerHTML = `${grid}<polyline fill="none" stroke="#ff7a59" stroke-width="3" stroke-linejoin="round" points="${pts.map((p) => p.join(',')).join(' ')}"/>${ser.map((s, i) => `<circle cx="${X(i)}" cy="${Y(s.r)}" r="5" fill="#ff7a59" stroke="#14121f" stroke-width="2"><title>${s.r} (${s.d > 0 ? '+' : ''}${s.d})</title></circle>`).join('')}`;
  return h('div', { class: 'chartwrap' }, svg);
}

// ---------------------------------------------------------------------------------------------
export async function startApp(el: HTMLElement) {
  root = el;
  backend = await getBackend();
  backend?.onUser((u) => { user = u; render(); });
  onLang(() => render());
  go(home);
  const hash = location.hash.replace('#', '').toUpperCase();
  if (hash.length === 4 && backend) { const m = await joinRoom(hash); if (m) alert(m); }
}
