import { computeElo } from '../engine/elo';
import { charName } from '../i18n';
import { t, getLang, type Key } from '../i18n';
import { beatsMost, favourites, losesMostTo, mostLosing, mostWinning, racerStats, rivals, type FullMatch, type RacerStat } from '../engine/stats';
import { playerStats } from '../engine/elo';
import { h, racerImg } from './prompts';

export interface Profile { name?: string; team?: string }
export interface DashboardOptions {
  uid: string | null; // null: not logged in
  hist: FullMatch[];
  names: Record<string, string>; // current display names by uid
  profile: Profile;
  defaultName: string;
  onSave(p: { name: string; team: string }): Promise<void>;
  onDraft?(p: Profile): void; // what the player has typed so far (the page may be redrawn when other data changes)
  savedRecently?: boolean;
  onLogin(): void;
}

const face = (id: Parameters<typeof racerImg>[0], badge = '') => {
  const f = h('span', { class: 'face sm', style: '--pc:#fff', title: charName(id) }, h('img', { src: racerImg(id), alt: charName(id) }));
  if (badge) f.append(h('i', { class: 'badge' }, badge));
  return f;
};

function racerList(rows: RacerStat[], empty: Key) {
  if (!rows.length) return h('p', { class: 'sub' }, t(empty));
  return h('div', { class: 'rlist' }, ...rows.map((r) => h('div', { class: 'ritem' }, face(r.id),
    h('div', { class: 'rtxt' }, h('b', { class: 't' }, charName(r.id)), h('span', {}, `${t('playedN', { n: r.played })} · ${t('racerLine', { w: r.wins, s: r.seconds, n: r.none })}`)))));
}

/** The player's page: profile (name, team), S.K.U.L.O., statistics, racers, rivals, history and the ranking. */
export function dashboard(o: DashboardOptions): Node[] {
  const e = computeElo(o.hist);
  const mine = o.uid;
  const kids: Node[] = [h('h1', { class: 't title' }, t('resultsTitle')), h('p', { class: 'sub' }, `${t('skulo')} · ${t('skuloFull')}`)];
  const nameOf = (uid: string, fallback: string) => o.names[uid] || fallback;

  if (!mine) {
    const b = h('button', { class: 'go' }, t('login')); b.onclick = o.onLogin;
    kids.push(h('div', { class: 'panel' }, h('p', {}, t('loginToSee')), b));
  } else {
    // profile
    const name = h('input', { value: o.profile.name ?? o.defaultName, maxlength: '24', id: 'p_name' });
    const team = h('input', { value: o.profile.team ?? '', maxlength: '24', placeholder: t('teamPlaceholder'), id: 'p_team' });
    const save = h('button', { class: 'go' }, t('saveProfile'));
    const ok = h('span', { class: 'okmsg' }, o.savedRecently ? t('saved') : '');
    const draft = () => o.onDraft?.({ name: name.value, team: team.value });
    name.oninput = draft; team.oninput = draft;
    save.onclick = async () => {
      const n = name.value.trim().slice(0, 24) || o.defaultName;
      await o.onSave({ name: n, team: team.value.trim().slice(0, 24) });
    };
    const rating = e.ratings[mine]?.r ?? 1500;
    const st = playerStats(o.hist, mine);
    const stat = (k: Key, v: string | number) => h('div', { class: 'stat' }, h('span', { class: 'lbl' }, t(k)), h('b', { class: 't' }, String(v)));
    kids.push(h('div', { class: 'panel' },
      h('div', { class: 'profilegrid' },
        h('div', {}, h('h2', { class: 't' }, t('profile')), h('label', { for: 'p_name' }, t('displayName')), name, h('label', { for: 'p_team' }, t('teamName')), team, h('div', { class: 'row left' }, save, ok)),
        h('div', { class: 'rating' }, h('span', { class: 'lbl' }, t('yourRating')), h('b', { class: 't big' }, String(rating)), h('span', { class: 'mut' }, t('skulo')))),
      h('div', { class: 'stats' }, stat('matches', st.matches), stat('winsLabel', st.wins), stat('podiums', st.podiums), stat('winRate', st.winRate === null ? '—' : st.winRate + '%'), stat('avgPoints', st.avgPoints), stat('bestScore', st.best), stat('raceWins', st.raceWins))));

    // racers
    const rs = racerStats(o.hist, mine);
    kids.push(h('div', { class: 'panel' }, h('h2', { class: 't' }, t('favRacers')), racerList(favourites(rs), 'noRacerData')));
    kids.push(h('div', { class: 'two' },
      h('div', { class: 'panel' }, h('h2', { class: 't' }, t('bestRacers')), racerList(mostWinning(rs), 'noRacerData')),
      h('div', { class: 'panel' }, h('h2', { class: 't' }, t('worstRacers')), racerList(mostLosing(rs), 'noRacerData'))));

    // rivals
    const rv = rivals(o.hist, mine);
    const rivalList = (rows: ReturnType<typeof beatsMost>) => rows.length
      ? h('div', { class: 'rlist' }, ...rows.map((r) => h('div', { class: 'ritem' }, h('div', { class: 'rtxt' }, h('b', { class: 't' }, nameOf(r.uid, r.name)), h('span', {}, t('vsLine', { w: r.wins, l: r.losses, d: r.draws })))))) : h('p', { class: 'sub' }, t('noRivals'));
    kids.push(h('div', { class: 'two' },
      h('div', { class: 'panel' }, h('h2', { class: 't' }, t('rivalsBeat')), rivalList(beatsMost(rv))),
      h('div', { class: 'panel' }, h('h2', { class: 't' }, t('rivalsLose')), rivalList(losesMostTo(rv)))));

    kids.push(h('div', { class: 'panel' }, h('h2', { class: 't' }, t('ratingChart')), chart(e, mine)));

    // history
    const mineList = e.list.filter((m) => m.players.some((p) => p.uid === mine)).reverse() as FullMatch[];
    const rows = mineList.map((m) => {
      const p = m.players.find((x) => x.uid === mine)!, ch = e.per[m.id]?.[mine];
      const racers = (m.races ?? []).map((r) => {
        const c = r.picks?.[mine];
        return c ? face(c, r.first === mine ? t('first') : r.second === mine ? t('second') : '') : h('span');
      });
      return h('tr', {}, h('td', {}, new Date(m.date).toLocaleDateString(getLang() === 'it' ? 'it-IT' : 'en-GB')), h('td', {}, `${p.pos}/${m.players.length}`), h('td', {}, String(p.p)),
        h('td', { class: ch && ch.d < 0 ? 'neg' : 'pos' }, ch ? `${ch.d > 0 ? '+' : ''}${ch.d} → ${ch.a}` : ''), h('td', {}, p.team || '—'), h('td', { class: 'racers' }, ...racers));
    });
    kids.push(h('div', { class: 'panel' }, h('h2', { class: 't' }, t('history')),
      rows.length ? h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ...(['date', 'position', 'points', 'change', 'teamCol', 'racersCol'] as Key[]).map((k) => h('th', {}, t(k))))), h('tbody', {}, ...rows))) : h('p', { class: 'sub' }, t('noHistory'))));
  }

  const board = Object.entries(e.ratings).map(([uid, r]) => ({ uid, ...r, name: nameOf(uid, r.name) })).sort((a, c) => c.r - a.r);
  const lb = board.map((r, i) => h('tr', { class: r.uid === mine ? 'me' : '' }, h('td', {}, String(i + 1)), h('td', {}, r.name), h('td', {}, String(r.r)), h('td', {}, String(r.n))));
  kids.push(h('div', { class: 'panel' }, h('h2', { class: 't' }, t('ranking')),
    lb.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, t('player')), h('th', {}, t('skulo')), h('th', {}, t('matches')))), h('tbody', {}, ...lb)) : h('p', { class: 'sub' }, t('noRanking'))));
  return kids;
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
