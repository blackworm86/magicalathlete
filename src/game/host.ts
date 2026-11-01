import type { CharacterId } from '../engine/characters';
import { rng } from '../engine/dice';
import { playMatch, type MatchAgent } from '../engine/match';
import type { Agent, Decision, Race, Racer } from '../engine/race';
import { shiftTier, START_TIERS, type Tier } from '../engine/tiers';
import { playTournament, type TournamentAgent } from '../engine/tournament';
import type { Backend } from '../net/backend';
import { randomAnswer, type PromptAnswer, type PromptSpec } from '../ui/prompts';
import { PLAYER_COLORS, type LogEntry, type PlayerInfo, type Rules } from './protocol';
import type { GameView } from './view';

export { PLAYER_COLORS };
export interface HostConfig {
  rules: Rules;
  players: PlayerInfo[]; // seat order
  local: Set<string>; // players answered on this device
  net?: { backend: Backend; code: string }; // other humans, and results, go through this
  seed: number;
  ranked: boolean;
}

const clean = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const ANSWER_TIMEOUT_MS = 180_000;

/** Runs the whole game (engine + decisions) on this device and streams what happens. */
export async function runHost(cfg: HostConfig, view: GameView): Promise<void> {
  const r = rng(cfg.seed);
  const by = Object.fromEntries(cfg.players.map((p) => [p.id, p]));
  const ids = cfg.players.map((p) => p.id);
  const net = cfg.net;
  let race: Race | null = null;
  let cursor = 0;

  const emit = (e: LogEntry) => {
    const c = clean(e);
    view.feed(c);
    if (net) void net.backend.push(`rooms/${net.code}/log`, c);
  };
  const flush = () => { while (race && cursor < race.events.length) emit({ t: 'ev', e: race.events[cursor++] }); };

  function waitAnswer(reqId: string): Promise<PromptAnswer | null> {
    return new Promise((res) => {
      const stop = net!.backend.watch<{ v: PromptAnswer }>(`rooms/${net!.code}/ans/${reqId}`, (a) => { if (a) { clearTimeout(timer); stop(); res(a.v); } });
      const timer = setTimeout(() => { stop(); res(null); }, ANSWER_TIMEOUT_MS);
    });
  }

  async function ask(pid: string, spec: PromptSpec): Promise<PromptAnswer> {
    flush();
    const p = by[pid];
    if (!p || p.bot) return randomAnswer(spec, r);
    if (cfg.local.has(pid)) { await view.drain(); return view.prompter.run(spec); }
    if (!net) return randomAnswer(spec, r);
    const id = await net.backend.push(`rooms/${net.code}/req`, clean({ to: pid, spec }));
    return (await waitAnswer(id)) ?? randomAnswer(spec, r); // a player who does not answer is played by the bot
  }
  const idx = async (pid: string, spec: PromptSpec): Promise<number> => { const a = await ask(pid, spec); return Array.isArray(a) ? a[0] ?? 0 : typeof a === 'number' ? a : 0; };
  const pickN = async (pid: string, spec: PromptSpec): Promise<number[]> => { const a = await ask(pid, spec); return Array.isArray(a) ? a : [0]; };
  const isBot = (pid: string) => by[pid]?.bot;
  const rand = (n: number) => Math.floor(r() * n);

  // ---- decisions inside a race ------------------------------------------------------------
  const raceAgent: Agent = async (d: Decision) => {
    const owner = d.racer.owner, color = by[owner]?.color;
    if (isBot(owner)) {
      if (d.kind === 'reroll') return d.roll <= 2;
      if (d.kind === 'predict') return 1 + rand(6);
      if (d.kind === 'choose' || d.kind === 'choosePos') return rand(d.options.length);
      return r() < 0.7;
    }
    const name = by[owner].name;
    switch (d.kind) {
      case 'use': return !!(await ask(owner, { k: 'yesno', title: { k: 'usePowerTitle', p: { char: d.racer.character } }, color, card: d.racer.character, yes: { k: 'useIt' }, no: { k: 'skip' } }));
      case 'reroll': return !!(await ask(owner, { k: 'yesno', title: { k: 'rerollTitle', p: { name, n: d.roll } }, sub: { k: 'rerollSub', p: { char: d.source.character } }, color, yes: { k: 'reroll' }, no: { k: 'keepRoll', p: { n: d.roll } } }));
      case 'choose': return idx(owner, { k: 'choose', title: { k: 'chooseRacerTitle', p: { char: d.racer.character } }, color, options: d.options.map((o: Racer) => ({ label: { k: 'racerAt' as const, p: { name: by[o.owner].name, char: o.character, pos: o.pos } }, id: o.character })) });
      case 'choosePos': return idx(owner, { k: 'choose', title: { k: 'chooseSpaceTitle', p: { char: d.racer.character } }, color, options: d.options.map((n) => ({ label: { k: 'space' as const, p: { n } } })) });
      case 'predict': return (await idx(owner, { k: 'choose', title: { k: 'predictTitle', p: { char: d.racer.character } }, sub: { k: 'predictSub' }, color, options: [1, 2, 3, 4, 5, 6].map((n) => ({ label: String(n) })) })) + 1;
    }
  };

  const onRace = (rc: Race, i: number) => {
    flush();
    race = rc; cursor = 0;
    emit({ t: 'race', index: i, track: rc.track.id, racers: rc.racers.map((x) => ({ id: x.id, owner: x.owner, character: x.character, pos: x.pos })) });
  };
  const eggAsk = (pid: string, options: CharacterId[]) => (isBot(pid) ? rand(options.length) : idx(pid, { k: 'cards', title: { k: 'eggTitle', p: { name: by[pid].name } }, sub: { k: 'eggSub' }, color: by[pid].color, cards: options }));
  const twinAsk = (pid: string, options: CharacterId[]) => (isBot(pid) ? rand(options.length) : idx(pid, { k: 'choose', title: { k: 'twinTitle', p: { name: by[pid].name } }, color: by[pid].color, options: options.map((c) => ({ label: c as string, id: c })), none: { k: 'noThanks' } }));

  emit({ t: 'start', rules: cfg.rules, players: cfg.players });
  let totals: Record<string, number> = {};
  let ranking: { id: string; pos: number; p: number }[] = [];
  let winners: string[] = [];
  let hist: { id: string; name: string; p: number; pos: number; rw: number; bz: number }[] | null = null;

  if (cfg.rules === 'friendly') {
    const agent: MatchAgent = {
      draft: (pid, options) => (isBot(pid) ? rand(options.length) : idx(pid, { k: 'cards', title: { k: 'draftTitle', p: { name: by[pid].name } }, sub: { k: 'draftSub' }, color: by[pid].color, cards: options })),
      pick: async (pid, hand, count, i) => (isBot(pid) ? [...hand.keys()].sort(() => r() - 0.5).slice(0, count) : pickN(pid, { k: 'cards', title: { k: 'pickTitle', p: { name: by[pid].name, n: i + 1 } }, sub: { k: 'pickSub' }, color: by[pid].color, cards: hand, count })),
      egg: eggAsk,
      twin: twinAsk,
      race: raceAgent,
    };
    const res = await playMatch({
      players: ids, rng: r, agent, onRace,
      async onRaceEnd(summary, t) { flush(); emit({ t: 'raceEnd', summary, totals: t }); await view.drain(); },
    });
    totals = res.totals; winners = res.winners;
  } else {
    let tiers: Record<string, Tier> = { ...START_TIERS };
    if (net) { const g = await net.backend.get<Record<string, Tier>>('global/tiers'); if (g) tiers = { ...tiers, ...g }; }
    const agent: TournamentAgent = {
      draft: (pid, options, round) => (isBot(pid) ? rand(options.length) : idx(pid, { k: 'cards', title: { k: 'tDraftTitle', p: { name: by[pid].name, n: round + 1 } }, sub: { k: 'tDraftSub' }, color: by[pid].color, cards: options })),
      pick: (pid, hand, i) => (isBot(pid) ? rand(hand.length) : idx(pid, { k: 'cards', title: { k: 'pickTitle', p: { name: by[pid].name, n: i + 1 } }, sub: { k: 'tPickSub' }, color: by[pid].color, cards: hand })),
      egg: eggAsk,
      twin: twinAsk,
      starter: (pid, cands) => (isBot(pid) ? rand(cands.length) : idx(pid, { k: 'choose', title: { k: 'starterTitle', p: { name: by[pid].name } }, sub: { k: 'starterSub' }, color: by[pid].color, options: cands.map((c) => ({ label: by[c].name })) })),
      race: raceAgent,
    };
    const res = await playTournament({
      players: ids, rng: r, agent, tiers: tiers as never,
      onPole: (p) => { emit({ t: 'pole', start: p.start, reveal: p.reveal, draft: p.draft }); },
      onRace,
      async onRaceEnd(summary, t, change) {
        flush();
        emit({ t: 'raceEnd', summary, totals: t, up: change.up, down: change.down });
        if (net && cfg.ranked) {
          if (change.up) { tiers[change.up] = shiftTier(tiers[change.up] ?? 'D', 1); void net.backend.set(`global/tiers/${change.up}`, tiers[change.up]); }
          if (change.down) { tiers[change.down] = shiftTier(tiers[change.down] ?? 'D', -1); void net.backend.set(`global/tiers/${change.down}`, tiers[change.down]); }
        }
        await view.drain();
      },
    });
    totals = res.totals; winners = res.winners;
    ranking = res.ranking.map((x) => ({ id: x.player, pos: x.pos, p: x.p }));
    const rw = Object.fromEntries(res.ranking.map((x) => [x.player, x.wins]));
    hist = res.ranking.map((x) => ({ id: x.player, name: by[x.player].name, p: x.p, pos: x.pos, rw: rw[x.player], bz: x.bronze }));
  }

  flush();
  if (!ranking.length) {
    const sorted = [...ids].sort((a, b) => totals[b] - totals[a]);
    ranking = sorted.map((id, i) => ({ id, p: totals[id], pos: i > 0 && totals[sorted[i - 1]] === totals[id] ? 0 : i + 1 }));
    for (let i = 0; i < ranking.length; i++) if (!ranking[i].pos) ranking[i].pos = ranking[i - 1].pos;
  }
  let saved = false;
  if (net && cfg.ranked && hist) {
    try {
      const id = `${net.code}_${Date.now().toString(36)}`;
      await net.backend.set(`history/${id}`, clean({ id, date: Date.now(), rules: 'tournament', players: hist.map((x) => ({ uid: x.id, name: x.name, p: x.p, pos: x.pos, rw: x.rw, bz: x.bz })) }));
      saved = true;
    } catch { saved = false; }
  }
  if (net) void net.backend.update(`rooms/${net.code}/meta`, { status: 'done' });
  emit({ t: 'end', totals, ranking, winners, ranked: saved });
  await view.drain();
}
