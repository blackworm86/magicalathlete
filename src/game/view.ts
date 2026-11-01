import { CHARACTER_BY_ID, type CharacterId } from '../engine/characters';
import type { GameEvent } from '../engine/race';
import { MILD_MILE, WILD_WILDS } from '../engine/tracks';
import { charName, charText, onLang, t, tr, trackName, type Txt } from '../i18n';
import { BoardScene, sleep } from '../render/boardScene';
import { h, Prompter, racerImg } from '../ui/prompts';
import { normalize, type LogEntry, type PlayerInfo } from './protocol';

type RacerRef = { id: number; owner: string; character: CharacterId };

/** Presents a game: the 3D board, the player bar, the power card, the event feed, dice and prompts.
 *  Fed with log entries (from the host's engine or over the network). */
export class GameView {
  readonly prompter: Prompter;
  private board: BoardScene;
  private bar = h('div', { class: 'bar' });
  private feedEl = h('div', { class: 'feed' });
  private powerEl = h('div', { class: 'power hidden' });
  private diewrap = h('div', { class: 'diewrap hidden' });
  private die = h('div', { class: 'die' });
  private dieLabel = h('div', { class: 'dielabel' });
  private speedSel: HTMLSelectElement;
  private pauseBtn = h('button', { class: 'opt sm pausebtn' }, t('pause'));
  private queue: LogEntry[] = [];
  private busy = false;
  private paused = false;
  private players: PlayerInfo[] = [];
  private by: Record<string, PlayerInfo> = {};
  private totals: Record<string, number> = {};
  private live: Record<string, number> = {}; // points earned during the current race (stars, chips...)
  private raceIdx = 0;
  private trackId: 'mild' | 'wild' = 'mild';
  private active: number | null = null;
  private racerList: RacerRef[] = [];
  private tripped = new Set<number>();
  private lines: { text: string; color: string }[] = [];
  private catchUp = false;
  private replaying = false; // old entries are being shown again (reload, late join): no questions, no waiting
  private offlineEl: HTMLElement | null = null;
  private fixedFast = false;
  private offLang: () => void;
  destroyed = false;
  onExit: () => void = () => undefined;

  constructor(private root: HTMLElement) {
    root.innerHTML = '<div id="stage"></div>';
    this.board = new BoardScene(root.querySelector<HTMLElement>('#stage')!);
    this.prompter = new Prompter(root);
    this.speedSel = h('select', { class: 'speed' }, ...[['0.5', 'speedSlow'], ['1', ''], ['2', ''], ['4', '']].map(([v]) => h('option', { value: v, ...(v === '1' ? { selected: '' } : {}) }, t('speed', { n: v }))));
    this.speedSel.onchange = () => { if (!this.catchUp) this.board.speed = Number(this.speedSel.value); };
    this.pauseBtn.onclick = () => { this.paused = !this.paused; this.pauseBtn.textContent = t(this.paused ? 'resume' : 'pause'); };
    this.diewrap.append(this.die, this.dieLabel);
    root.append(this.bar, this.feedEl, this.powerEl, this.diewrap, h('div', { class: 'controls' }, this.pauseBtn, this.speedSel));
    const fast = Number(new URLSearchParams(location.search).get('speed')); // test hook: ?speed=100
    if (fast > 0) { this.fixedFast = true; this.board.speed = fast; this.catchUp = true; this.board.renderer.setAnimationLoop(null); }
    this.offLang = onLang(() => { this.renderBar(); this.renderFeed(); });
  }

  destroy() {
    this.destroyed = true;
    this.offLang();
    this.board.renderer.setAnimationLoop(null);
    this.board.dispose();
    this.root.innerHTML = '';
  }

  /** A message that stays on top of the game until the player acts or leaves (connection problems, host gone). */
  showBanner(msg: Txt, action?: { label: Txt; run: () => void }) {
    this.root.querySelector('.banner:not(.off)')?.remove();
    const b = h('div', { class: 'banner' }, tr(msg));
    if (action) { const btn = h('button', { class: 'opt sm' }, tr(action.label)); btn.onclick = action.run; b.append(btn); }
    this.root.append(b);
  }
  hideBanner() { this.root.querySelector('.banner:not(.off)')?.remove(); }
  /** Shown while the connection to the server is down (the game is saved and continues when it is back). */
  setOffline(on: boolean) {
    if (on && !this.offlineEl) { this.offlineEl = h('div', { class: 'banner off' }, t('reconnecting')); this.root.append(this.offlineEl); }
    if (!on && this.offlineEl) { this.offlineEl.remove(); this.offlineEl = null; }
  }

  /** While true the log is replayed at maximum speed (a player joining a running game). */
  setCatchUp(on: boolean) { if (this.fixedFast) return; this.catchUp = on; this.replaying = on; this.board.speed = on ? 100 : Number(this.speedSel.value); }

  feed(e: LogEntry) { this.queue.push(normalize(e)); void this.pump(); }

  /** Resolves when everything fed so far has been shown. */
  async drain() { while (this.busy || this.queue.length) await sleep(this.catchUp ? 5 : 40); }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try { while (this.queue.length) { while (this.paused && !this.destroyed) await sleep(100); await this.handle(this.queue.shift()!); } } finally { this.busy = false; }
  }

  /** Pause for `s` seconds (scaled by the speed setting; skipped when catching up). */
  private async wait(s: number) { if (!this.catchUp && this.board.speed < 50) await sleep((s * 1000) / this.board.speed); }

  // ---- names and faces --------------------------------------------------------------------
  private color(owner: string) { return this.by[owner]?.color ?? '#fff'; }
  private pname(owner: string) { return this.by[owner]?.name ?? owner; }
  private ref(id: number) { return this.racerList.find((r) => r.id === id); }
  /** "Ann's Banana" */
  private who(id: number) { const r = this.ref(id); return r ? `${this.pname(r.owner)} · ${charName(r.character)}` : '?'; }

  /** A round picture of a racer, ringed in its owner's colour. */
  private face(r: RacerRef, cls = '') {
    const rv = this.board.racers.get(r.id);
    const f = h('span', { class: `face ${cls}`, style: `--pc:${this.color(r.owner)}`, title: this.who(r.id) }, h('img', { src: racerImg(r.character), alt: charName(r.character) }));
    const badge = rv?.place && rv.place > 0 ? (rv.place === 1 ? t('first') : t('second')) : rv && rv.place < 0 ? '✕' : this.tripped.has(r.id) ? '↓' : '';
    if (badge) f.append(h('i', { class: 'badge' }, badge));
    return f;
  }

  private status(r: RacerRef) {
    const rv = this.board.racers.get(r.id);
    if (!rv) return '';
    if (rv.place > 0) return rv.place === 1 ? t('first') : t('second');
    if (rv.place < 0) return t('out');
    return t('statusRacing', { n: rv.pos }) + (this.tripped.has(r.id) ? ` · ${t('tripped')}` : '');
  }

  private renderBar() {
    this.bar.innerHTML = '';
    if (!this.players.length) return;
    const actOwner = this.active !== null ? this.ref(this.active)?.owner : null;
    this.bar.append(h('div', { class: 'racetag t' }, t('raceHud', { n: this.raceIdx + 1, track: trackName(this.trackId) })));
    for (const p of this.players) {
      const mine = this.racerList.filter((r) => r.owner === p.id);
      const live = this.live[p.id] ?? 0;
      this.bar.append(h('div', { class: 'pcard' + (actOwner === p.id ? ' on' : ''), style: `--pc:${p.color}` },
        ...mine.map((r) => this.face(r, this.active === r.id ? 'now' : '')),
        h('div', { class: 'pinfo' },
          h('b', { class: 'pname t' }, `${p.name}${p.bot ? ' 🤖' : ''}`),
          ...mine.map((r) => h('span', { class: 'rname' }, `${charName(r.character)} · ${this.status(r)}`))),
        h('div', { class: 'ppts' }, h('b', { class: 't' }, String((this.totals[p.id] ?? 0) + live)), h('small', {}, t('ptsLabel')),
          live ? h('em', { title: t('thisRace') }, `${live > 0 ? '+' : ''}${live}`) : h('span'))));
    }
  }

  private log(text: string, color = '#14121f') {
    this.lines.push({ text, color });
    if (this.lines.length > 9) this.lines.shift();
    if (!this.catchUp) this.renderFeed();
  }
  private renderFeed() {
    this.feedEl.innerHTML = '';
    this.feedEl.append(h('div', { class: 'lbl' }, t('eventLog')), ...this.lines.map((l, i) => h('div', { class: 'ln' + (i === this.lines.length - 1 ? ' last' : ''), style: `border-left-color:${l.color}` }, l.text)));
  }

  // ---- entries ----------------------------------------------------------------------------
  private async handle(entry: LogEntry) {
    const b = this.board;
    switch (entry.t) {
      case 'start':
        this.players = entry.players; this.by = Object.fromEntries(entry.players.map((p) => [p.id, p]));
        this.totals = Object.fromEntries(entry.players.map((p) => [p.id, 0]));
        break;
      case 'pole':
        if (!this.replaying) await this.prompter.run({ k: 'info', title: { k: 'poleTitle' }, lines: [{ k: 'poleLine1', p: { name: this.pname(entry.start) } }, { k: 'poleLine2', p: { name: this.pname(entry.reveal) } }, { k: 'poleLine3', p: { name: this.pname(entry.draft) } }] });
        break;
      case 'info': if (!this.replaying) await this.prompter.run(entry.spec); break;
      case 'race': {
        this.raceIdx = entry.index; this.trackId = entry.track; this.active = null; this.tripped.clear(); this.live = {};
        this.racerList = entry.racers; this.lines = [];
        b.setTrack(entry.track === 'mild' ? MILD_MILE : WILD_WILDS);
        for (const r of entry.racers) await b.addRacer(r.id, r.owner, r.character, parseInt(this.color(r.owner).slice(1), 16), r.pos);
        this.log(t('raceStart', { n: entry.index + 1, track: trackName(entry.track) }));
        this.renderBar();
        await this.wait(1.2);
        break;
      }
      case 'ev': await this.event(entry.e); break;
      case 'raceEnd': {
        this.totals = entry.totals; this.live = {};
        this.renderBar();
        const s = entry.summary;
        const line = (i: 0 | 1): Txt => (s.places[i] ? { k: i ? 'place2' : 'place1', p: { name: this.pname(s.places[i].owner), char: s.places[i].character } } : '—');
        const lines: Txt[] = [line(0), line(1), '', ...this.players.map((p): Txt => ({ k: 'scoreLine', p: { name: p.name, gain: s.points[p.id] ?? 0, total: entry.totals[p.id] ?? 0 } }))];
        if (entry.up) lines.push({ k: 'tierUp', p: { char: entry.up } });
        if (entry.down) lines.push({ k: 'tierDown', p: { char: entry.down } });
        if (!this.replaying) await this.prompter.run({ k: 'info', title: { k: 'raceResults', p: { n: s.index + 1 } }, lines, button: { k: s.index < 3 ? 'nextRace' : 'finalResults' } });
        break;
      }
      case 'end': {
        const names = (ids: string[]) => ids.map((i) => this.pname(i)).join(' & ');
        await this.prompter.run({
          k: 'info',
          title: entry.winners.length > 1 ? { k: 'tie' } : { k: 'wins', p: { name: names(entry.winners) } },
          lines: [...entry.ranking.map((r): Txt => ({ k: 'rankLine', p: { n: r.pos, name: this.pname(r.id), pts: r.p } })), ...(entry.ranked ? [{ k: 'rankedSaved' } as Txt] : [])],
          button: { k: 'playAgain' },
        });
        this.onExit();
        break;
      }
    }
    this.renderBar();
  }

  /** The power card: who uses what, and on whom. */
  private async announce(e: Extract<GameEvent, { t: 'power' } | { t: 'mod' }>) {
    const src = this.ref(e.racer);
    if (!src) return;
    const targets = (e.t === 'power' ? (e.targets ?? []) : [e.target]).map((id) => this.ref(id)).filter((r): r is RacerRef => !!r);
    const el = this.powerEl;
    el.innerHTML = '';
    el.style.setProperty('--pc', this.color(src.owner));
    const head = e.t === 'power' ? CHARACTER_BY_ID[e.power].power : `${e.amount > 0 ? '+' : ''}${e.amount}`;
    el.append(
      h('div', { class: 'phead t' }, `⚡ ${charName(e.power)} · ${head}`),
      h('div', { class: 'pbody' },
        h('div', { class: 'pwho' }, this.face(src), h('b', {}, this.pname(src.owner))),
        ...(targets.length ? [h('span', { class: 'parrow' }, '➜'), h('div', { class: 'ptargets' }, ...targets.map((r) => h('div', { class: 'pwho' }, this.face(r), h('b', {}, `${this.pname(r.owner)} · ${charName(r.character)}`))))] : []),
      ),
      h('p', { class: 'ptext' }, e.t === 'power' ? charText(e.power) : `${charName(e.power)}: ${e.amount > 0 ? '+' : ''}${e.amount} ${t('powerBonus')} ${targets[0] ? charName(targets[0].character) : ''}`));
    el.classList.remove('hidden');
    const secs = e.t === 'power' ? 2.8 : 1.6;
    await Promise.all([this.wait(secs), this.catchUp ? Promise.resolve() : this.board.showPower(e.racer, targets.map((r) => r.id), secs / this.board.speed)]);
    el.classList.add('hidden');
  }

  private async event(e: GameEvent) {
    const b = this.board;
    const rv = 'racer' in e ? b.racers.get(e.racer) : undefined;
    const c = rv ? this.color(rv.owner) : '#14121f';
    switch (e.t) {
      case 'turn': this.active = e.racer; b.setActive(e.racer); this.log(t('logTurn', { who: this.who(e.racer) }), c); this.renderBar(); await this.wait(0.6); break;
      case 'roll':
        this.log(t('logRoll', { who: this.who(e.racer), n: e.roll }), c);
        if (!rv || this.catchUp || b.speed >= 50) break;
        this.die.style.background = this.color(rv.owner); this.dieLabel.textContent = this.who(e.racer); this.diewrap.classList.remove('hidden');
        for (let i = 0; i < 8; i++) { this.die.textContent = String(1 + Math.floor(Math.random() * 6)); await sleep(80 / b.speed); }
        this.die.textContent = String(e.roll); await this.wait(1.1); this.diewrap.classList.add('hidden');
        break;
      case 'move':
        if (!rv) break;
        this.log(e.kind === 'main' ? t('logMove', { who: this.who(e.racer), n: e.to - e.from, to: e.to }) : e.kind === 'arrow' ? t('logArrow', { who: this.who(e.racer), to: e.to }) : t('logMoved', { who: this.who(e.racer), to: e.to }), c);
        await b.hop(rv, e.from, e.to, e.kind === 'arrow'); this.renderBar(); await this.wait(0.5);
        break;
      case 'warp': if (rv) { this.log(t('logWarp', { who: this.who(e.racer), to: e.to }), c); await b.warp(rv, e.to); this.renderBar(); await this.wait(0.5); } break;
      case 'trip': if (rv) { this.tripped.add(e.racer); this.log(t('trips', { who: this.who(e.racer) }), '#ee4422'); await b.setTripped(rv, true); this.renderBar(); await this.wait(0.6); } break;
      case 'recover': if (rv) { this.tripped.delete(e.racer); this.log(t('recovers', { who: this.who(e.racer) }), c); await b.setTripped(rv, false); this.renderBar(); await this.wait(0.3); } break;
      case 'chip': this.live[e.owner] = (this.live[e.owner] ?? 0) + e.amount; this.log(t('logChip', { who: this.pname(e.owner), n: `${e.amount > 0 ? '+' : ''}${e.amount}` }), this.color(e.owner)); this.renderBar(); await this.wait(0.7); break;
      case 'power': {
        const names = (e.targets ?? []).map((id) => this.who(id)).join(', ');
        this.log(names ? t('logPowerOn', { who: this.who(e.racer), power: CHARACTER_BY_ID[e.power].power, targets: names }) : t('logPower', { who: this.who(e.racer), power: CHARACTER_BY_ID[e.power].power }), '#ff7a59');
        if (rv) await this.announce(e);
        break;
      }
      case 'mod':
        this.log(t('logMod', { who: charName(e.power), amount: `${e.amount > 0 ? '+' : ''}${e.amount}`, target: this.who(e.target) }), '#7fb2ff');
        await this.announce(e);
        break;
      case 'finish': if (rv) { this.log(t('finishes', { who: this.who(e.racer), place: e.place === 1 ? t('first') : t('second') }), '#ffc83d'); await b.finishAt(rv, e.place); this.renderBar(); await this.wait(1); } break;
      case 'eliminated': if (rv) { this.log(t('eliminated', { who: this.who(e.racer) }), '#ee4422'); await b.eliminate(rv); this.renderBar(); await this.wait(0.8); } break;
    }
  }
}
