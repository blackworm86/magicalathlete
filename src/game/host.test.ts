import { describe, expect, test } from 'vitest';
import { createMemoryBackend, type MemoryDb } from '../net/memory';
import { canon, decisionKey, runHost, type HostConfig, type HostView } from './host';
import type { LogEntry, PlayerInfo } from './protocol';
import type { PromptAnswer, PromptSpec } from '../ui/prompts';

const fakeView = () => {
  const banners: unknown[] = [];
  const v: HostView = { feed: () => undefined, drain: async () => undefined, prompter: { run: async () => true } as never, showBanner: (m) => { banners.push(m); }, destroyed: false };
  return { v, banners };
};
const players: PlayerInfo[] = [
  { id: 'remote', name: 'Far away', bot: false, color: '#f00' },
  { id: 'b1', name: 'Bot 1', bot: true, color: '#0f0' },
  { id: 'b2', name: 'Bot 2', bot: true, color: '#00f' },
];
const base = (backend: ReturnType<typeof createMemoryBackend>, extra: Partial<HostConfig> = {}): HostConfig => ({
  rules: 'friendly', players, local: new Set(), net: { backend, code: 'TEST', host: 'h' }, seed: 7, ranked: false, timeouts: { answer: 300, away: 5 }, ...extra,
});

/** A player who always gives the same simple answer (so two runs of the game see the same answers). */
const answerFor = (spec: PromptSpec): PromptAnswer =>
  spec.k === 'cards' ? Array.from({ length: spec.count ?? 1 }, (_, i) => i) : spec.k === 'choose' ? 0 : spec.k === 'yesno' ? true : true;
function autoPlayer(b: ReturnType<typeof createMemoryBackend>, pid: string, limit = Infinity) {
  let answered = 0;
  const stop = b.watchAdded<{ spec: PromptSpec }>(`rooms/TEST/req/${pid}`, (id, req) => {
    if (answered >= limit) return;
    answered++;
    void b.set(`rooms/TEST/ans/${pid}/${id}`, { v: answerFor(req.spec) });
  });
  return { stop, count: () => answered };
}
const logOf = (b: ReturnType<typeof createMemoryBackend>) => {
  const l = ((b.tree.rooms as Record<string, { log?: Record<string, LogEntry> }>)?.TEST?.log) ?? {};
  return Object.keys(l).sort().map((k) => l[k]);
};

describe('host', () => {
  test('a player who never answers is played by the bot, and only the first question makes the table wait', async () => {
    const b = createMemoryBackend();
    const pushes: string[] = [];
    const origPush = b.push.bind(b);
    b.push = async (path, v) => { pushes.push(path); return origPush(path, v); };
    const { v } = fakeView();
    const t0 = Date.now();
    await runHost(base(b), v);
    const elapsed = Date.now() - t0;
    const questions = pushes.filter((p) => p.includes('/req/remote')).length;
    expect(questions).toBeGreaterThan(3); // a whole game asks many questions
    expect(elapsed).toBeLessThan(300 + questions * 5 + 600); // without "away" handling this would take 300 ms x questions
  });

  test('failed online writes are reported once instead of failing silently', async () => {
    const b = createMemoryBackend();
    b.push = async () => { throw new Error('permission denied'); };
    const { v, banners } = fakeView();
    await runHost(base(b), v);
    expect(banners).toHaveLength(1);
  });
});

describe('a host that reloads the page', () => {
  test('rebuilds the same game from the seed and the stored answers, and the log ends up identical', async () => {
    // 1. a game played to the end without interruption
    const full = createMemoryBackend();
    autoPlayer(full, 'remote');
    await runHost(base(full, { timeouts: { answer: 60_000, away: 60_000 } }), fakeView().v);
    const expected = logOf(full);
    const decisions = Object.keys(((full.tree.rooms as never) as Record<string, { decisions: object }>).TEST.decisions).length;
    expect(decisions).toBeGreaterThan(4);

    // 2. the same game, but the host's page is closed after about half of the answers
    const shared: MemoryDb = { tree: {}, listeners: new Set() };
    const host1 = createMemoryBackend(null, shared);
    const player = createMemoryBackend(null, shared);
    const half = Math.floor(decisions / 2);
    const auto = autoPlayer(player, 'remote', half);
    const stop = new AbortController();
    const first = runHost(base(host1, { timeouts: { answer: 60_000, away: 60_000 }, signal: stop.signal }), fakeView().v).catch((e: Error) => e.message);
    while (auto.count() < half) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 30)); // the next question is now open and unanswered
    stop.abort();
    expect(await first).toBe('aborted');
    expect(logOf(host1).length).toBeLessThan(expected.length);
    auto.stop();

    // 3. the page is loaded again: read what is stored, rebuild, carry on
    const host2 = createMemoryBackend(null, shared);
    const room = (shared.tree.rooms as Record<string, { setup: HostConfig; decisions: Record<string, { v: PromptAnswer }>; req?: Record<string, Record<string, { spec: PromptSpec }>>; ans?: Record<string, Record<string, unknown>> }>).TEST;
    const decs = Object.keys(room.decisions).sort().map((k) => room.decisions[k].v);
    expect(Object.keys(room.decisions).sort()[0]).toBe(decisionKey(0));
    const pending: Record<string, string> = {};
    for (const [uid, reqs] of Object.entries(room.req ?? {})) for (const [id, rq] of Object.entries(reqs)) if (!room.ans?.[uid]?.[id]) pending[`${uid}|${canon(rq.spec)}`] = id;
    expect(Object.keys(pending).length).toBe(1); // the question that was open when the page closed
    const resumed = autoPlayer(player, 'remote');
    await runHost(base(host2, { seed: room.setup.seed, timeouts: { answer: 60_000, away: 60_000 }, resume: { skipEntries: logOf(host1).length, decisions: decs, pending } }), fakeView().v);
    resumed.stop();
    expect(logOf(host2)).toEqual(expected); // exactly the game that would have been played without the interruption
  });
});
