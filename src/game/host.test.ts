import { describe, expect, test } from 'vitest';
import type { Backend } from '../net/backend';
import { runHost, type HostConfig, type HostView } from './host';
import type { PlayerInfo } from './protocol';

// A backend that keeps everything in memory; nobody ever answers a question.
function memoryBackend(opts: { failPush?: boolean } = {}) {
  const pushes: string[] = [];
  const b: Backend = {
    kind: 'local', user: null, ready: Promise.resolve(),
    onUser: () => () => undefined, signUp: async () => undefined, signIn: async () => undefined, signInGoogle: async () => undefined, signInGuest: async () => undefined, signOut: async () => undefined,
    get: async () => null, set: async () => undefined, update: async () => undefined, remove: async () => undefined, transaction: async () => undefined,
    push: async (path) => { pushes.push(path); if (opts.failPush) throw new Error('permission denied'); return 'k' + pushes.length; },
    watch: () => () => undefined, watchAdded: () => () => undefined,
  };
  return { b, pushes };
}
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
const cfg = (net: HostConfig['net']): HostConfig => ({ rules: 'friendly', players, local: new Set(), net, seed: 7, ranked: false, timeouts: { answer: 300, away: 5 } });

describe('host', () => {
  test('a player who never answers is played by the bot, and only the first question makes the table wait', async () => {
    const { b, pushes } = memoryBackend();
    const { v } = fakeView();
    const t0 = Date.now();
    await runHost(cfg({ backend: b, code: 'TEST', host: 'h' }), v);
    const elapsed = Date.now() - t0;
    const questions = pushes.filter((p) => p.includes('/req/remote')).length;
    expect(questions).toBeGreaterThan(3); // a whole game asks many questions
    expect(elapsed).toBeLessThan(300 + questions * 5 + 600); // without "away" handling this would take 300 ms x questions
  });

  test('failed online writes are reported once instead of failing silently', async () => {
    const { b } = memoryBackend({ failPush: true });
    const { v, banners } = fakeView();
    await runHost(cfg({ backend: b, code: 'TEST', host: 'h' }), v);
    expect(banners).toHaveLength(1);
  });
});
