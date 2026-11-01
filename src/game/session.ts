import { rng } from '../engine/dice';
import { CHARACTER_BY_ID, type CharacterId } from '../engine/characters';
import { playMatch, type MatchAgent, type Variant } from '../engine/match';
import type { Agent, Race, Racer, GameEvent } from '../engine/race';
import { BoardScene, sleep } from '../render/boardScene';
import { cardOf, h, Prompter } from '../ui/prompts';

export interface PlayerCfg { id: string; name: string; human: boolean; color: string }
// Same player colours as the tournament site.
export const PLAYER_COLORS = ['#ff7a59', '#7fb2ff', '#6fe0a3', '#ffe14d', '#ff9fd2', '#c4a7ff'];

const nm = (id: CharacterId) => CHARACTER_BY_ID[id].name;

/** Plays one local game: humans answer through prompts, bots through simple random choices. */
export async function runGame(root: HTMLElement, players: PlayerCfg[], seed = Date.now()): Promise<void> {
  const r = rng(seed);
  const by = Object.fromEntries(players.map((p) => [p.id, p]));
  const prompter = new Prompter(root);
  const view = root.querySelector<HTMLElement>('#stage')!;
  view.innerHTML = '';
  const board = new BoardScene(view);
  const hud = h('div', { class: 'hud' });
  const dice = h('div', { class: 'die hidden' });
  const toasts = h('div', { class: 'toasts' });
  root.append(hud, dice, toasts);
  const speedSel = h('select', { class: 'speed' }, ...['1', '2', '4'].map((v) => h('option', { value: v }, `${v}x speed`)));
  speedSel.onchange = () => { board.speed = Number(speedSel.value); };
  root.append(speedSel);

  // ---- event player: consumes race.events one by one, animating them -----------------------
  let race: Race | null = null, cursor = 0, running = false, active: number | null = null;
  const color = (owner: string) => by[owner].color;
  const toast = (text: string, c = '#fff') => { void c; const t = h('div', { class: 'toast' }, text); toasts.append(t); setTimeout(() => t.remove(), 3200 / board.speed); };
  const names = (id: number) => { const rv = board.racers.get(id)!; return `${by[rv.owner].name}'s ${nm(rv.character)}`; };

  function renderHud(totals: Record<string, number>, raceIdx: number, trackName: string) {
    hud.innerHTML = '';
    hud.append(h('div', { class: 'title' }, `Race ${raceIdx + 1}/4 · ${trackName}`));
    for (const p of players) hud.append(h('div', { class: 'pl' + (active !== null && board.racers.get(active)?.owner === p.id ? ' on' : ''), style: `border-left-color:${p.color}` }, `${p.name}${p.human ? '' : ' 🤖'}: ${totals[p.id] ?? 0} pts`));
    if (race) for (const rr of race.racers) {
      const rv = board.racers.get(rr.id);
      if (!rv) continue;
      const done = rv.place > 0, out = rv.place < 0;
      hud.append(h('div', { class: 'rc' + (done ? ' fin' : '') + (out ? ' out' : ''), style: `border-left-color:${color(rr.owner)}` },
        `${nm(rr.character)} · ${done ? (rv.place === 1 ? '1st' : '2nd') : out ? 'out' : `space ${rv.pos}`}${tripShown.has(rr.id) ? ' · tripped' : ''}`));
    }
  }
  const tripShown = new Set<number>();
  let totalsNow: Record<string, number> = {}, idxNow = 0, trackNow = '';

  async function handle(e: GameEvent) {
    const rv = 'racer' in e ? board.racers.get(e.racer) : undefined;
    switch (e.t) {
      case 'turn': active = e.racer; board.setActive(e.racer); break;
      case 'roll': {
        if (!rv) break;
        dice.style.background = color(rv.owner); dice.classList.remove('hidden');
        for (let i = 0; i < 6; i++) { dice.textContent = String(1 + Math.floor(Math.random() * 6)); await sleep(60 / board.speed); }
        dice.textContent = String(e.roll); await sleep(550 / board.speed); dice.classList.add('hidden');
        break;
      }
      case 'move': if (rv) await board.hop(rv, e.from, e.to, e.kind === 'arrow'); break;
      case 'warp': if (rv) await board.warp(rv, e.to); break;
      case 'trip': if (rv) { tripShown.add(e.racer); toast(`${names(e.racer)} trips!`, '#ee4422'); await board.setTripped(rv, true); } break;
      case 'recover': if (rv) { tripShown.delete(e.racer); toast(`${names(e.racer)} recovers`); await board.setTripped(rv, false); } break;
      case 'chip': toast(`${by[e.owner].name} ${e.amount > 0 ? '+' : ''}${e.amount} point${Math.abs(e.amount) === 1 ? '' : 's'}`, by[e.owner].color); break;
      case 'power': if (rv) { toast(`${nm(e.power)}: ${CHARACTER_BY_ID[e.power].power}`, color(rv.owner)); await board.bounce(rv); } break;
      case 'finish': if (rv) { toast(`${names(e.racer)} finishes ${e.place === 1 ? '1st' : '2nd'}!`, '#ffd23f'); await board.finishAt(rv, e.place); } break;
      case 'eliminated': if (rv) { toast(`${names(e.racer)} is eliminated!`, '#ee4422'); await board.eliminate(rv); } break;
    }
    renderHud(totalsNow, idxNow, trackNow);
  }

  async function pump() {
    if (running) return;
    running = true;
    while (race && cursor < race.events.length) await handle(race.events[cursor++]);
    running = false;
  }
  const poll = setInterval(() => void pump(), 60);
  /** Wait until every event produced so far has been shown. */
  const drain = async () => { for (;;) { await pump(); await sleep(30); if (!running && race && cursor >= race.events.length) return; if (!race) return; } };

  // ---- agents -------------------------------------------------------------------------------
  const pickIdx = (n: number) => Math.floor(r() * n);
  const matchAgent: MatchAgent = {
    async draft(pid, options) {
      if (!by[pid].human) return pickIdx(options.length);
      return (await prompter.pickCards({ title: `${by[pid].name}: draft a racer`, sub: 'Pick one racer for your team (you will use each racer once).', color: by[pid].color, cards: options.map((c) => cardOf(c)) }))[0];
    },
    async pick(pid, hand, count, raceIndex) {
      if (!by[pid].human) return [...hand.keys()].sort(() => r() - 0.5).slice(0, count);
      return prompter.pickCards({ title: `${by[pid].name}: choose your racer for race ${raceIndex + 1}`, sub: 'Other players: look away! Later races are worth more points.', color: by[pid].color, cards: hand.map((c) => cardOf(c)), count });
    },
    async egg(pid, options) {
      if (!by[pid].human) return pickIdx(options.length);
      return (await prompter.pickCards({ title: `${by[pid].name}: Egg draws 3 racers`, sub: 'Pick one: Egg gets its power.', color: by[pid].color, cards: options.map((c) => cardOf(c)) }))[0];
    },
    async twin(pid, options) {
      if (!by[pid].human) return pickIdx(options.length);
      const i = await prompter.choose({ title: `${by[pid].name}: Twin copies a past winner`, color: by[pid].color, options: options.map((c) => ({ label: nm(c), id: c })), allowNone: 'No thanks' });
      return i;
    },
    race: ((d) => raceDecision(d)) as Agent,
  };

  async function raceDecision(d: Parameters<Agent>[0]): Promise<boolean | number> {
    const who = by[d.racer.owner];
    const label = (x: Racer) => `${by[x.owner].name}'s ${nm(x.character)} (space ${x.pos})`;
    if (!who.human) {
      if (d.kind === 'reroll') return d.roll <= 2;
      if (d.kind === 'predict') return 1 + pickIdx(6);
      if (d.kind === 'choose' || d.kind === 'choosePos') return pickIdx(d.options.length);
      return r() < 0.7;
    }
    await drain();
    switch (d.kind) {
      case 'use': return prompter.yesNo({ title: `${nm(d.racer.character)}: use your power?`, sub: CHARACTER_BY_ID[d.power].text, color: who.color, card: cardOf(d.racer.character), yes: 'Use it', no: 'Skip' });
      case 'reroll': return prompter.yesNo({ title: `${who.name}: reroll your ${d.roll}?`, sub: `${nm(d.source.character)} lets you reroll. You must keep the new roll.`, color: who.color, yes: 'Reroll', no: `Keep ${d.roll}` });
      case 'choose': return prompter.choose({ title: `${nm(d.racer.character)}: choose a racer`, color: who.color, options: d.options.map((o) => ({ label: label(o), id: o.character })) });
      case 'choosePos': return prompter.choose({ title: `${nm(d.racer.character)}: choose a space`, color: who.color, options: d.options.map((p) => ({ label: `Space ${p}` })) });
      case 'predict': return prompter.choose({ title: `${nm(d.racer.character)}: predict your roll`, sub: 'If you are right, you get an extra turn.', color: who.color, options: [1, 2, 3, 4, 5, 6].map((n) => ({ label: String(n) })) }).then((i) => i + 1);
    }
  }

  let variantNote = '';
  const variant: Variant | undefined = players.length === 3 && false ? 'double-racer' : undefined;
  const result = await playMatch({
    players: players.map((p) => p.id), rng: r, variant, agent: matchAgent,
    async onRace(rc, i) {
      race = rc; cursor = 0; tripShown.clear(); idxNow = i; trackNow = rc.track.name; active = null;
      board.setTrack(rc.track);
      for (const rr of rc.racers) await board.addRacer(rr.id, rr.owner, rr.character, parseInt(color(rr.owner).slice(1), 16), rr.pos);
      renderHud(totalsNow, i, trackNow);
      toast(`Race ${i + 1}: ${rc.track.name}`);
    },
    async onRaceEnd(summary, totals) {
      await drain();
      totalsNow = totals; renderHud(totals, summary.index, trackNow);
      const lines = [`1st: ${summary.places[0] ? `${by[summary.places[0].owner].name} (${nm(summary.places[0].character)})` : '—'}`, `2nd: ${summary.places[1] ? `${by[summary.places[1].owner].name} (${nm(summary.places[1].character)})` : '—'}`, '', ...players.map((p) => `${p.name}: +${summary.points[p.id] ?? 0}  →  ${totals[p.id]} pts`)];
      await prompter.info({ title: `Race ${summary.index + 1} results`, lines, button: summary.index < 3 ? 'Next race' : 'Final results' });
    },
  });
  clearInterval(poll);
  void variantNote;
  const ranked = [...players].sort((a, b) => result.totals[b.id] - result.totals[a.id]);
  await prompter.info({
    title: result.winners.length > 1 ? 'It’s a tie!' : `${by[result.winners[0]].name} wins!`,
    lines: ranked.map((p, i) => `${i + 1}. ${p.name}: ${result.totals[p.id]} pts`), button: 'Play again',
  });
}
