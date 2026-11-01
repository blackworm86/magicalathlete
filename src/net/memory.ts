import type { AuthUser, Backend, Unsub } from './backend';

/** A complete in-memory backend (tests, and anything that needs a database without a browser). */
export interface MemoryDb { tree: Record<string, unknown>; listeners: Set<() => void>; seq?: number }
export function createMemoryBackend(user: AuthUser | null = null, shared?: MemoryDb): Backend & MemoryDb {
  const db: MemoryDb = shared ?? { tree: {}, listeners: new Set() };
  const tree = db.tree;
  const listeners = db.listeners;
  const parts = (p: string) => p.split('/').filter(Boolean);
  const getAt = (path: string): unknown => { let c: unknown = tree; for (const k of parts(path)) { if (c && typeof c === 'object' && k in (c as object)) c = (c as Record<string, unknown>)[k]; else return null; } return c ?? null; };
  const setAt = (path: string, v: unknown) => {
    const ks = parts(path); let c = tree as Record<string, unknown>;
    ks.slice(0, -1).forEach((k) => { if (!c[k] || typeof c[k] !== 'object') c[k] = {}; c = c[k] as Record<string, unknown>; });
    const last = ks[ks.length - 1];
    if (v === null || v === undefined) delete c[last]; else c[last] = JSON.parse(JSON.stringify(v));
  };
  const write = (path: string, v: unknown) => { setAt(path, v); queueMicrotask(() => listeners.forEach((f) => f())); };
  return {
    kind: 'local', user, ready: Promise.resolve(), tree, listeners,
    onUser: (cb) => { cb(user); return () => undefined; },
    signUp: async () => undefined, signIn: async () => undefined, signInGoogle: async () => undefined, signInGuest: async () => undefined, signOut: async () => undefined, updateName: async () => undefined,
    onConnection: (cb) => { cb(true); return () => undefined; },
    async get<T>(path: string) { const v = getAt(path); return (v === null ? null : JSON.parse(JSON.stringify(v))) as T | null; },
    async set(path, value) { write(path, value); },
    async update(path, value) { for (const [k, v] of Object.entries(value)) write(`${path}/${k}`, v); },
    async push(path, value) { const key = 'k' + ((db.seq = (db.seq ?? 0) + 1)).toString(36).padStart(8, '0'); write(`${path}/${key}`, value); return key; },
    async remove(path) { write(path, null); },
    async transaction<T>(path: string, fn: (c: T | null) => T | null) { write(path, fn(getAt(path) as T | null)); },
    watch<T>(path: string, cb: (v: T | null) => void): Unsub {
      let last = '__none__';
      const run = () => { const v = getAt(path); const s = JSON.stringify(v); if (s !== last) { last = s; cb(v as T | null); } };
      listeners.add(run); queueMicrotask(run);
      return () => listeners.delete(run);
    },
    watchAdded<T>(path: string, cb: (key: string, v: T) => void): Unsub {
      const seen = new Set<string>();
      const run = () => { const n = getAt(path); if (!n || typeof n !== 'object') return; for (const k of Object.keys(n).sort()) if (!seen.has(k)) { seen.add(k); cb(k, (n as Record<string, T>)[k]); } };
      listeners.add(run); queueMicrotask(run);
      return () => listeners.delete(run);
    },
  };
}
