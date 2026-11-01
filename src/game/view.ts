import { type GameEvent } from '../engine/race';
import { CHARACTER_BY_ID } from '../engine/characters';
import { charName, onLang, t, trackName, type Txt } from '../i18n';
import { BoardScene, sleep } from '../render/boardScene';
import { h, Prompter } from '../ui/prompts';
import type { LogEntry, PlayerInfo } from './protocol';

/** Presents a game: the 3D board, HUD, dice and prompts. Fed with log entries (from the host's engine or over the network). */
export class GameView {
  readonly prompter: Prompter;
  private board: BoardScene;
  private hud = h('div', { class: 'hud' });
  private dice = h('div', { class: 'die hidden' });
  private toasts = h('div', { class: 'toasts' });
  private speedSel: HTMLSelectElement;
  private queue: LogEntry[] = [];
  private busy = false;
  private players: PlayerInfo[] = [];
  private by: Record<string, PlayerInfo> = {};
  private totals: Record<string, number> = {};
  private raceIdx = 0;
  private trackId: 'mild' | 'wild' = 'mild';
  private active: number | null = null;
  private racerList: { id: number; owner: string; character: import('../engine/characters').CharacterId }[] = [];
  private tripped = new Set<number>();
  private catchUp = false;
  private offLang: () => void;
  private fixedFast = false;
  onExit: () => void = () => undefined;

  constructor(private root: HTMLElement) {
    root.innerHTML = '<div id="stage"></div>';
    this.board = new BoardScene(root.querySelector<HTMLElement>('#stage')!);
    this.prompter = new Prompter(root);
    this.speedSel = h('select', { class: 'speed' }, ...['1', '2', '4'].map((v) => h('option', { value: v }, t('speed', { n: v }))));
    this.speedSel.onchange = () => { if (!this.catchUp) this.board.speed = Number(this.speedSel.value); };
    root.append(this.hud, this.dice, this.toasts, this.speedSel);
    const fast = Number(new URLSearchParams(location.search).get('speed')); // test hook: ?speed=100
    if (fast > 0) { this.fixedFast = true; this.board.speed = fast; this.catchUp = true; this.board.renderer.setAnimationLoop(null); }
    this.offLang = onLang(() => this.renderHud());
  }

  destroy() { this.offLang(); this.board.renderer.setAnimationLoop(null); this.board.renderer.dispose(); this.root.innerHTML = ''; }

  /** While true the log is replayed at maximum speed (a player joining a running game). */
  setCatchUp(on: boolean) { if (this.fixedFast) return; this.catchUp = on; this.board.speed = on ? 100 : Number(this.speedSel.value); }

  feed(e: LogEntry) { this.queue.push(e); void this.pump(); }

  /** Resolves when everything fed so far has been shown. */
  async drain() { while (this.busy || this.queue.length) await sleep(this.catchUp ? 5 : 40); }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try { while (this.queue.length) await this.handle(this.queue.shift()!); } finally { this.busy = false; }
  }

  private color(owner: string) { return this.by[owner]?.color ?? '#fff'; }
  private pname(owner: string) { return this.by[owner]?.name ?? owner; }
  private whoShort(id: number) { const r = this.board.racers.get(id); return r ? `${this.pname(r.owner)} · ${charName(r.character)}` : '?'; }
  private toast(text: string) {
    const el = h('div', { class: 'toast' }, text);
    this.toasts.append(el);
    if (!this.catchUp) setTimeout(() => el.remove(), 3200 / this.board.speed); else el.remove();
  }

  private renderHud() {
    const hud = this.hud;
    hud.innerHTML = '';
    if (!this.players.length) return;
    hud.append(h('div', { class: 'title' }, t('raceHud', { n: this.raceIdx + 1, track: trackName(this.trackId) })));
    const act = this.active !== null ? this.board.racers.get(this.active)?.owner : null;
    for (const p of this.players) hud.append(h('div', { class: 'pl' + (act === p.id ? ' on' : ''), style: `border-left-color:${p.color}` }, `${p.name}${p.bot ? ' 🤖' : ''}: ${t('pts', { n: this.totals[p.id] ?? 0 })}`));
    for (const r of this.racerList) {
      const rv = this.board.racers.get(r.id);
      if (!rv) continue;
      const done = rv.place > 0, out = rv.place < 0;
      hud.append(h('div', { class: 'rc' + (done ? ' fin' : '') + (out ? ' out' : ''), style: `border-left-color:${this.color(r.owner)}` },
        `${charName(r.character)} · ${done ? (rv.place === 1 ? t('first') : t('second')) : out ? t('out') : t('spaceN', { n: rv.pos })}${this.tripped.has(r.id) ? ' · ' + t('tripped') : ''}`));
    }
  }

  private async handle(entry: LogEntry) {
    const b = this.board;
    switch (entry.t) {
      case 'start': this.players = entry.players; this.by = Object.fromEntries(entry.players.map((p) => [p.id, p])); this.totals = Object.fromEntries(entry.players.map((p) => [p.id, 0])); break;
      case 'pole':
        await this.prompter.run({ k: 'info', title: { k: 'poleTitle' }, lines: [{ k: 'poleLine1', p: { name: this.pname(entry.start) } }, { k: 'poleLine2', p: { name: this.pname(entry.reveal) } }, { k: 'poleLine3', p: { name: this.pname(entry.draft) } }] });
        break;
      case 'info': await this.prompter.run(entry.spec); break;
      case 'race': {
        this.raceIdx = entry.index; this.trackId = entry.track; this.active = null; this.tripped.clear();
        this.racerList = entry.racers;
        b.setTrack(entry.track === 'mild' ? (await import('../engine/tracks')).MILD_MILE : (await import('../engine/tracks')).WILD_WILDS);
        for (const r of entry.racers) await b.addRacer(r.id, r.owner, r.character, parseInt(this.color(r.owner).slice(1), 16), r.pos);
        this.toast(t('raceStart', { n: entry.index + 1, track: trackName(entry.track) }));
        break;
      }
      case 'ev': await this.event(entry.e); break;
      case 'raceEnd': {
        this.totals = entry.totals;
        this.renderHud();
        const s = entry.summary;
        const line = (i: 0 | 1): Txt => (s.places[i] ? { k: i ? 'place2' : 'place1', p: { name: this.pname(s.places[i].owner), char: s.places[i].character } } : '—');
        const lines: Txt[] = [line(0), line(1), '', ...this.players.map((p): Txt => ({ k: 'scoreLine', p: { name: p.name, gain: s.points[p.id] ?? 0, total: entry.totals[p.id] ?? 0 } }))];
        if (entry.up) lines.push({ k: 'tierUp', p: { char: entry.up } });
        if (entry.down) lines.push({ k: 'tierDown', p: { char: entry.down } });
        await this.prompter.run({ k: 'info', title: { k: 'raceResults', p: { n: s.index + 1 } }, lines, button: { k: s.index < 3 ? 'nextRace' : 'finalResults' } });
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
    this.renderHud();
  }

  private async event(e: GameEvent) {
    const b = this.board;
    const rv = 'racer' in e ? b.racers.get(e.racer) : undefined;
    switch (e.t) {
      case 'turn': this.active = e.racer; b.setActive(e.racer); break;
      case 'roll':
        if (!rv || this.catchUp) break;
        this.dice.style.background = this.color(rv.owner); this.dice.classList.remove('hidden');
        for (let i = 0; i < 6; i++) { this.dice.textContent = String(1 + Math.floor(Math.random() * 6)); await sleep(60 / b.speed); }
        this.dice.textContent = String(e.roll); await sleep(550 / b.speed); this.dice.classList.add('hidden');
        break;
      case 'move': if (rv) await b.hop(rv, e.from, e.to, e.kind === 'arrow'); break;
      case 'warp': if (rv) await b.warp(rv, e.to); break;
      case 'trip': if (rv) { this.tripped.add(e.racer); this.toast(t('trips', { who: this.whoShort(e.racer) })); await b.setTripped(rv, true); } break;
      case 'recover': if (rv) { this.tripped.delete(e.racer); this.toast(t('recovers', { who: this.whoShort(e.racer) })); await b.setTripped(rv, false); } break;
      case 'chip': this.toast(t('getsPoints', { who: this.pname(e.owner), n: `${e.amount > 0 ? '+' : ''}${e.amount}` })); break;
      case 'power': if (rv) { this.toast(`${charName(e.power)}: ${CHARACTER_BY_ID[e.power].power}`); await b.bounce(rv); } break;
      case 'finish': if (rv) { this.toast(t('finishes', { who: this.whoShort(e.racer), place: e.place === 1 ? t('first') : t('second') })); await b.finishAt(rv, e.place); } break;
      case 'eliminated': if (rv) { this.toast(t('eliminated', { who: this.whoShort(e.racer) })); await b.eliminate(rv); } break;
    }
  }
}
