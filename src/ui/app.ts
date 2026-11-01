import type { FullMatch } from '../engine/stats';
import { GameView } from '../game/view';
import { runClient } from '../game/client';
import { PLAYER_COLORS, canon, runHost } from '../game/host';
import type { PlayerInfo, RoomMeta, RoomPlayer, Rules } from '../game/protocol';
import { getLang, onLang, setLang, t, type Key } from '../i18n';
import { getBackend, type AuthUser, type Backend } from '../net/backend';
import { dashboard, type Profile } from './dashboard';
import { h, type PromptAnswer, type PromptSpec } from './prompts';
import type { LogEntry } from '../game/protocol';

let backend: Backend | null = null;
let user: AuthUser | null = null;
let root: HTMLElement;
let render: () => void = () => undefined;
let cleanup: (() => void)[] = [];
let profile: Profile = {}; // the logged-in player's saved name and team
const myName = () => (profile.name || user?.name || 'Player').slice(0, 24);
const myTeam = () => (profile.team || '').slice(0, 24);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const MAX_PLAYERS = 6;

/** The room this browser is in: a reload takes the player straight back to it. */
function remember(code: string) {
  try { localStorage.setItem('ma_room', code); history.replaceState(null, '', `#${code}`); } catch { /* private mode */ }
}
function forget() {
  try { localStorage.removeItem('ma_room'); history.replaceState(null, '', location.pathname + location.search); } catch { /* private mode */ }
}
const stillThere = (a: { alive?: number } | null | undefined, ms = 90_000) => !!a?.alive && Date.now() - a.alive < ms;

let inGame = false; // while a game is on screen, menu refreshes (language, login changes) must leave it alone
let draft: Profile | null = null, savedAt = 0; // dashboard: typed but not yet saved text survives a redraw

function go(screen: () => void) {
  cleanup.forEach((f) => f()); cleanup = [];
  inGame = false;
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
    inGame = true;
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
    await backend.set(`rooms/${code}/players/${me.uid}`, { uid: me.uid, name: myName(), team: myTeam(), guest: me.guest, joined: Date.now() } satisfies RoomPlayer);
    await backend.set(`userRooms/${me.uid}/${code}`, { created: Date.now(), rules });
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
    user && backend ? roomLists(user.uid) : h('span'),
    err);
}

/** "Your games" (to rejoin after a refresh or a lost connection) and the open rooms anyone can join. */
function roomLists(uid: string) {
  const b = backend!;
  const mine = h('div', { class: 'rlist' }, h('p', { class: 'sub' }, t('loading')));
  const open = h('div', { class: 'rlist' }, h('p', { class: 'sub' }, t('noOpenRooms')));
  let token = 0;
  const badge = (r: Rules) => h('span', { class: 'chip ' + (r === 'tournament' ? 'acc' : 'yel') }, t(r === 'tournament' ? 'tournamentBadge' : 'friendlyBadge'));
  const row = (code: string, meta: { rules: Rules }, text: string, label: Key) => {
    const btn = h('button', { class: 'opt sm' }, t(label));
    btn.onclick = async () => { const m = await joinRoom(code); if (m) alert(m); };
    return h('div', { class: 'ritem' }, h('span', { class: 'code small' }, code), h('div', { class: 'rtxt' }, badge(meta.rules), h('span', {}, text)), btn);
  };
  let myCodes: string[] = [];
  cleanup.push(b.watch<Record<string, { rules: Rules }>>(`userRooms/${uid}`, async (v) => {
    const my = ++token;
    myCodes = Object.keys(v ?? {});
    const rows: Node[] = [];
    for (const code of myCodes) {
      const meta = await b.get<RoomMeta>(`rooms/${code}/meta`);
      if (!meta || meta.status === 'done') { void b.remove(`userRooms/${uid}/${code}`); continue; }
      rows.push(row(code, meta, t(meta.status === 'playing' ? 'statusPlaying' : 'statusLobby'), 'rejoin'));
    }
    if (my !== token) return;
    mine.innerHTML = '';
    mine.append(...(rows.length ? rows : [h('p', { class: 'sub' }, t('noGames'))]));
  }));
  cleanup.push(b.watch<Record<string, { host: string; hostName: string; rules: Rules; count: number; alive: number }>>('openRooms', (v) => {
    const rows = Object.entries(v ?? {}).filter(([code, r]) => stillThere(r) && !myCodes.includes(code))
      .map(([code, r]) => row(code, r, `${t('hostedBy', { name: r.hostName })} · ${t('playersCount', { n: r.count })}`, 'join'));
    open.innerHTML = '';
    open.append(...(rows.length ? rows : [h('p', { class: 'sub' }, t('noOpenRooms'))]));
  }));
  return h('div', { class: 'menu-grid two' }, h('div', { class: 'panel' }, h('h2', {}, t('yourGames')), mine), h('div', { class: 'panel' }, h('h2', {}, t('openRooms')), open));
}

async function joinRoom(code: string): Promise<string | null> {
  if (!backend || code.length !== 4) return t('roomNotFound');
  const meta = await backend.get<RoomMeta>(`rooms/${code}/meta`);
  if (!meta) return t('roomNotFound');
  if (!(await ensureUser(meta.rules === 'tournament'))) return t(meta.rules === 'tournament' ? 'needRankedAccount' : 'needLoginRanked');
  const me = user!;
  const players = (await backend.get<Record<string, RoomPlayer>>(`rooms/${code}/players`)) ?? {};
  if (meta.status !== 'lobby') {
    if (meta.status === 'playing' && meta.host === me.uid) { void resumeHost(code); return null; } // the host's page was closed or reloaded: rebuild the game
    if (meta.status === 'playing' && meta.order?.includes(me.uid)) { go(() => lobby(code)); return null; } // rejoin a running game
    return t('roomStarted');
  }
  if (!players[me.uid] && Object.keys(players).length >= MAX_PLAYERS) return t('roomFull');
  await backend.set(`rooms/${code}/players/${me.uid}`, { uid: me.uid, name: myName(), team: myTeam(), guest: me.guest, joined: players[me.uid]?.joined ?? Date.now() } satisfies RoomPlayer);
  await backend.set(`userRooms/${me.uid}/${code}`, { created: Date.now(), rules: meta.rules });
  go(() => lobby(code));
  return null;
}

/** The host's page was reloaded (or the browser crashed) during a game: the game is deterministic, so the stored seed
 *  and every answer given so far rebuild exactly the same state; the other players never notice. */
async function resumeHost(code: string) {
  const b = backend!, me = user!;
  page(topbar(), h('p', { class: 'lead' }, t('resuming')));
  remember(code);
  const [setup, logObj, decObj, reqObj, ansObj] = await Promise.all([
    b.get<{ rules: Rules; ranked: boolean; seed: number; players: PlayerInfo[] }>(`rooms/${code}/setup`),
    b.get<Record<string, LogEntry>>(`rooms/${code}/log`),
    b.get<Record<string, { v: PromptAnswer }>>(`rooms/${code}/decisions`),
    b.get<Record<string, Record<string, { spec: PromptSpec }>>>(`rooms/${code}/req`),
    b.get<Record<string, Record<string, unknown>>>(`rooms/${code}/ans`),
  ]);
  if (!setup) { go(() => lobby(code)); return; }
  cleanup.forEach((f) => f()); cleanup = [];
  const view = new GameView(root);
  inGame = true;
  const abort = new AbortController();
  cleanup.push(() => abort.abort(), b.onConnection((ok) => view.setOffline(!ok)));
  const entries = Object.keys(logObj ?? {}).sort().map((k) => logObj![k]);
  view.setCatchUp(true);
  entries.forEach((e) => view.feed(e));
  await view.drain();
  view.setCatchUp(false);
  const decisions = Object.keys(decObj ?? {}).sort().map((k) => decObj![k].v);
  const pending: Record<string, string> = {};
  for (const [to, reqs] of Object.entries(reqObj ?? {})) for (const [id, rq] of Object.entries(reqs)) if (!ansObj?.[to]?.[id]) pending[`${to}|${canon(rq.spec)}`] = id;
  try {
    await runHost({ rules: setup.rules, players: setup.players, local: new Set([me.uid]), net: { backend: b, code, host: me.uid }, seed: setup.seed, ranked: setup.ranked, signal: abort.signal, resume: { skipEntries: entries.length, decisions, pending } }, view);
  } catch (e) { if ((e as Error).message === 'aborted') return; console.error(e); }
  view.destroy(); forget();
  go(home);
}

function lobby(code: string) {
  const b = backend!;
  const me = user!;
  let meta: RoomMeta | null = null;
  let players: Record<string, RoomPlayer> = {};
  let view: GameView | null = null;
  let started = false;
  remember(code);
  // an open room is listed for others to join, as long as the host's page keeps saying it is alive
  const syncOpen = () => {
    if (!meta || meta.host !== me.uid || meta.status !== 'lobby') return;
    void b.set(`openRooms/${code}`, { host: me.uid, hostName: myName(), rules: meta.rules, count: Object.keys(players).length, created: meta.created, alive: Date.now() }).catch(() => undefined);
  };
  const unlist = () => { void b.remove(`openRooms/${code}`).catch(() => undefined); };
  const stopMeta = b.watch<RoomMeta>(`rooms/${code}/meta`, (m) => { meta = m; syncOpen(); if (m?.status === 'playing' && !started && m.host !== me.uid) { startClient(); return; } if (m?.status === 'done') forget(); draw(); });
  const stopPl = b.watch<Record<string, RoomPlayer>>(`rooms/${code}/players`, (p) => { players = p ?? {}; syncOpen(); draw(); });
  const beat = setInterval(syncOpen, 10_000);
  cleanup.push(stopMeta, stopPl, () => clearInterval(beat));

  const seats = (): string[] => {
    const ids = Object.keys(players).sort((a, c) => players[a].joined - players[c].joined);
    const order = (meta?.order ?? []).filter((i) => ids.includes(i));
    return [...order, ...ids.filter((i) => !order.includes(i))];
  };
  const toInfo = (ids: string[]): PlayerInfo[] => ids.map((id, i) => ({ id, name: players[id].name, team: players[id].team, bot: !!players[id].bot, color: PLAYER_COLORS[i % PLAYER_COLORS.length] }));

  function startClient() {
    started = true;
    cleanup.forEach((f) => f()); cleanup = [];
    view = new GameView(root);
    inGame = true;
    const leaveNow = () => { stop(); offStop(); view?.destroy(); view = null; forget(); go(home); };
    view.onExit = leaveNow;
    const stop = runClient(b, code, me.uid, view, leaveNow);
    const offStop = b.onConnection((ok) => view?.setOffline(!ok));
  }

  async function startHost() {
    const ids = seats();
    started = true;
    unlist();
    await b.update(`rooms/${code}/meta`, { status: 'playing', order: ids });
    cleanup.forEach((f) => f()); cleanup = [];
    view = new GameView(root);
    inGame = true;
    const v = view;
    v.onExit = () => undefined;
    const abort = new AbortController();
    cleanup.push(() => abort.abort(), b.onConnection((ok) => v.setOffline(!ok)));
    try {
      await runHost({ rules: meta!.rules, players: toInfo(ids), local: new Set([me.uid]), net: { backend: b, code, host: me.uid }, seed: Date.now(), ranked: meta!.rules === 'tournament', signal: abort.signal }, v);
    } catch (e) { if ((e as Error).message === 'aborted') return; console.error(e); }
    v.destroy(); view = null;
    forget();
    go(home);
  }

  function draw() {
    if (started || !meta) { if (!meta && !started) page(topbar(), h('p', { class: 'lead' }, t('loading'))); return; }
    const isHost = meta.host === me.uid;
    const ids = seats();
    const ranked = meta.rules === 'tournament';
    const link = `${location.origin}${location.pathname}#${code}`;
    const rows = ids.map((id, i) => {
      const p = players[id];
      const row = h('div', { class: 'prow' }, h('span', { class: 'dot', style: `background:${PLAYER_COLORS[i % PLAYER_COLORS.length]}` }, String(i + 1)),
        h('b', { class: 'grow' }, `${p.name}${p.bot ? ' 🤖' : ''}`, p.team ? h('small', { class: 'teamtag' }, ` · ${p.team}`) : h('span')), id === meta!.host ? h('span', { class: 'chip' }, t('hostBadge')) : h('span'), id === me.uid ? h('span', { class: 'chip yel' }, t('you')) : h('span'));
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
    const running = meta.status !== 'lobby';
    const start = h('button', { class: 'go' }, t('startGame'));
    if (msg) start.setAttribute('disabled', '');
    start.onclick = () => void startHost();
    const leave = h('button', { class: 'opt' }, t('leaveRoom'));
    leave.onclick = async () => { unlist(); if (isHost) await b.update(`rooms/${code}/meta`, { status: 'done' }); else { await b.remove(`rooms/${code}/players/${me.uid}`); await b.remove(`userRooms/${me.uid}/${code}`); } forget(); go(home); };
    const close = h('button', { class: 'opt' }, t('closeRoom'));
    close.onclick = async () => { unlist(); await b.update(`rooms/${code}/meta`, { status: 'done' }); forget(); go(home); };
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
        running ? h('p', { class: 'err' }, t('gameRunningHost')) : isHost ? h('div', { class: 'row left' }, ...(ranked ? [] : [addBot])) : h('p', { class: 'sub' }, t('waitingHost')),
        msg && isHost && !running ? h('p', { class: 'err' }, msg) : h('span'),
        h('div', { class: 'row left' }, ...(isHost && !running ? [start] : []), running && isHost ? close : leave)));
  }
  draw();
}

function results() {
  let hist: FullMatch[] = [], names: Record<string, string> = {};
  const draw = () => {
    const uid = user && !user.guest ? user.uid : null;
    page(topbar({ back: () => go(home) }), ...dashboard({
      uid, hist, names, profile: draft ?? profile, defaultName: user?.name ?? '', onDraft: (p) => { draft = p; }, savedRecently: Date.now() - savedAt < 3000,
      onLogin: () => loginModal(undefined, true),
      async onSave(p) {
        if (!backend || !user) return;
        savedAt = Date.now(); draft = null;
        await backend.set(`users/${user.uid}`, { name: p.name, team: p.team });
        if (p.name !== user.name) await backend.updateName(p.name);
        profile = { name: p.name, team: p.team };
        savedAt = Date.now();
        draw();
        setTimeout(draw, 3100);
      },
    }));
  };
  page(topbar({ back: () => go(home) }), h('p', { class: 'lead' }, t('loading')));
  if (!backend) { draw(); return; }
  cleanup.push(backend.watch<Record<string, FullMatch>>('history', (v) => { hist = Object.values(v ?? {}); draw(); }));
  cleanup.push(backend.watch<Record<string, Profile>>('users', (v) => { names = Object.fromEntries(Object.entries(v ?? {}).filter(([, p]) => p?.name).map(([k, p]) => [k, p.name!])); if (hist.length || user) draw(); }));
}

// ---------------------------------------------------------------------------------------------
export async function startApp(el: HTMLElement) {
  root = el;
  try { backend = await getBackend(); } catch (e) { console.warn('online play unavailable:', e); backend = null; } // the local game still works
  let stopProfile = () => undefined as void;
  backend?.onUser((u) => {
    user = u; stopProfile(); profile = {};
    if (u && !u.guest) stopProfile = backend!.watch<Profile>(`users/${u.uid}`, (p) => { profile = p ?? {}; }) as never;
    if (!inGame) go(render);
  });
  onLang(() => { if (!inGame) go(render); });
  go(home);
  // A reload (or a closed tab, a crash) must not lose the game: go back to the room this browser was in.
  const hash = location.hash.replace('#', '').toUpperCase();
  let saved: string | null = null;
  try { saved = localStorage.getItem('ma_room'); } catch { /* private mode */ }
  const target = hash.length === 4 ? hash : saved;
  if (target && backend && (user || hash.length === 4)) {
    const m = await joinRoom(target);
    if (m) { forget(); if (hash.length === 4) alert(m); }
  }
}
