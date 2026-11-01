// A tiny path-based database + auth interface. Two implementations:
//  - FirebaseBackend: the real thing (Realtime Database + Firebase Auth), needs VITE_FIREBASE_* settings
//  - LocalBackend: in-browser (localStorage), shared between tabs of one browser; used for tests and offline demos (?backend=local)
export interface AuthUser { uid: string; name: string; guest: boolean; email?: string }
export type Unsub = () => void;

export interface Backend {
  readonly kind: 'firebase' | 'local';
  readonly user: AuthUser | null;
  ready: Promise<void>;
  onUser(cb: (u: AuthUser | null) => void): Unsub;
  signUp(email: string, password: string, name: string): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signInGoogle(): Promise<void>;
  signInGuest(name: string): Promise<void>;
  signOut(): Promise<void>;
  get<T = unknown>(path: string): Promise<T | null>;
  set(path: string, value: unknown): Promise<void>;
  update(path: string, value: Record<string, unknown>): Promise<void>;
  push(path: string, value: unknown): Promise<string>;
  remove(path: string): Promise<void>;
  watch<T = unknown>(path: string, cb: (v: T | null) => void): Unsub;
  /** Calls cb for every existing and future child, in key order. */
  watchAdded<T = unknown>(path: string, cb: (key: string, v: T) => void): Unsub;
}

export const hasFirebaseConfig = () => !!import.meta.env.VITE_FIREBASE_API_KEY && !!import.meta.env.VITE_FIREBASE_DATABASE_URL;

// ---------------------------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------------------------
export async function createFirebaseBackend(): Promise<Backend> {
  const [{ initializeApp }, A, D] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/database')]);
  const app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  });
  const auth = A.getAuth(app), db = D.getDatabase(app);
  const toUser = (u: import('firebase/auth').User | null): AuthUser | null =>
    u ? { uid: u.uid, name: u.displayName || u.email?.split('@')[0] || 'Player', guest: u.isAnonymous, email: u.email ?? undefined } : null;
  let current: AuthUser | null = null;
  const subs = new Set<(u: AuthUser | null) => void>();
  const ready = new Promise<void>((res) => {
    A.onAuthStateChanged(auth, (u) => { current = toUser(u); subs.forEach((f) => f(current)); res(); });
  });
  const refresh = () => { current = toUser(auth.currentUser); subs.forEach((f) => f(current)); };
  return {
    kind: 'firebase',
    get user() { return current; },
    ready,
    onUser(cb) { subs.add(cb); cb(current); return () => subs.delete(cb); },
    async signUp(email, password, name) {
      const c = await A.createUserWithEmailAndPassword(auth, email, password);
      await A.updateProfile(c.user, { displayName: name });
      await D.set(D.ref(db, `users/${c.user.uid}`), { name });
      refresh();
    },
    async signIn(email, password) { await A.signInWithEmailAndPassword(auth, email, password); },
    async signInGoogle() {
      const provider = new A.GoogleAuthProvider();
      let cred: import('firebase/auth').UserCredential | null = null;
      try { cred = await A.signInWithPopup(auth, provider); }
      catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') { await A.signInWithRedirect(auth, provider); return; } // phones / strict browsers
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
        throw e;
      }
      const u = cred.user;
      await D.update(D.ref(db, `users/${u.uid}`), { name: u.displayName || u.email?.split('@')[0] || 'Player' });
      refresh();
    },
    async signInGuest(name) {
      const c = await A.signInAnonymously(auth);
      await A.updateProfile(c.user, { displayName: name });
      refresh();
    },
    async signOut() { await A.signOut(auth); },
    async get<T>(path: string) { const s = await D.get(D.ref(db, path)); return (s.exists() ? s.val() : null) as T | null; },
    async set(path, value) { await D.set(D.ref(db, path), value); },
    async update(path, value) { await D.update(D.ref(db, path), value); },
    async push(path, value) { const r = D.push(D.ref(db, path)); await D.set(r, value); return r.key!; },
    async remove(path) { await D.remove(D.ref(db, path)); },
    watch<T>(path: string, cb: (v: T | null) => void) { return D.onValue(D.ref(db, path), (s) => cb(s.exists() ? (s.val() as T) : null)); },
    watchAdded<T>(path: string, cb: (key: string, v: T) => void) { return D.onChildAdded(D.ref(db, path), (s) => cb(s.key!, s.val() as T)); },
  };
}

// ---------------------------------------------------------------------------------------------
// Local (localStorage, synced between tabs through the `storage` event)
// ---------------------------------------------------------------------------------------------
const KEY = 'ma_local_db';
type Tree = Record<string, unknown>;

let cache: Tree | null = null;
function readTree(): Tree {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { cache = {}; }
  return cache!;
}
function getAt(tree: Tree, path: string): unknown {
  let cur: unknown = tree;
  for (const p of path.split('/').filter(Boolean)) { if (cur && typeof cur === 'object' && p in (cur as Tree)) cur = (cur as Tree)[p]; else return null; }
  return cur ?? null;
}
function setAt(tree: Tree, path: string, value: unknown) {
  const parts = path.split('/').filter(Boolean);
  let cur = tree;
  parts.slice(0, -1).forEach((p) => { if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p] as Tree; });
  const last = parts[parts.length - 1];
  if (value === null || value === undefined) delete cur[last]; else cur[last] = value;
}

let seq = 0;
export function createLocalBackend(): Backend {
  const watchers = new Set<() => void>();
  const notify = () => watchers.forEach((f) => f());
  window.addEventListener('storage', (e) => { if (e.key === KEY) { cache = null; notify(); } });
  let current: AuthUser | null = null;
  try { current = JSON.parse(sessionStorage.getItem('ma_local_user') || 'null'); } catch { current = null; }
  const subs = new Set<(u: AuthUser | null) => void>();
  const setUser = (u: AuthUser | null) => {
    current = u;
    try { u ? sessionStorage.setItem('ma_local_user', JSON.stringify(u)) : sessionStorage.removeItem('ma_local_user'); } catch { /* ignore */ }
    subs.forEach((f) => f(u));
  };
  const accounts = (): Record<string, { uid: string; name: string; pw: string }> => JSON.parse(localStorage.getItem('ma_local_accounts') || '{}');
  let pending = false;
  const write = (path: string, v: unknown) => {
    const t = readTree(); setAt(t, path, v);
    if (!pending) { pending = true; queueMicrotask(() => { pending = false; try { localStorage.setItem(KEY, JSON.stringify(readTree())); } catch { /* quota */ } }); }
    notify();
  };
  return {
    kind: 'local',
    get user() { return current; },
    ready: Promise.resolve(),
    onUser(cb) { subs.add(cb); cb(current); return () => subs.delete(cb); },
    async signUp(email, password, name) {
      const acc = accounts();
      if (acc[email]) throw new Error('email already in use');
      acc[email] = { uid: 'u_' + Math.random().toString(36).slice(2, 10), name, pw: password };
      localStorage.setItem('ma_local_accounts', JSON.stringify(acc));
      setUser({ uid: acc[email].uid, name, guest: false, email });
    },
    async signIn(email, password) {
      const a = accounts()[email];
      if (!a || a.pw !== password) throw new Error('wrong email or password');
      setUser({ uid: a.uid, name: a.name, guest: false, email });
    },
    async signInGoogle() { const n = prompt('Google account name (test backend)', 'Google user'); if (n) setUser({ uid: 'goog_' + n.toLowerCase().replace(/\W/g, ''), name: n, guest: false, email: n + '@gmail.test' }); },
    async signInGuest(name) { setUser({ uid: 'g_' + Math.random().toString(36).slice(2, 10), name, guest: true }); },
    async signOut() { setUser(null); },
    async get<T>(path: string) { return getAt(readTree(), path) as T | null; },
    async set(path, value) { write(path, value); },
    async update(path, value) { for (const [k, v] of Object.entries(value)) write(`${path}/${k}`, v); },
    async push(path, value) {
      const key = Date.now().toString(36).padStart(9, '0') + (seq++).toString(36).padStart(6, '0');
      write(`${path}/${key}`, value);
      return key;
    },
    async remove(path) { write(path, null); },
    watch<T>(path: string, cb: (v: T | null) => void) {
      let last = '__init__';
      const run = () => { const v = getAt(readTree(), path); const s = path.startsWith('rooms/') && path.endsWith('/log') ? String(Object.keys((v as object) ?? {}).length) : JSON.stringify(v); if (s !== last) { last = s; cb(v as T | null); } };
      watchers.add(run); setTimeout(run, 0);
      return () => watchers.delete(run);
    },
    watchAdded<T>(path: string, cb: (key: string, v: T) => void) {
      const seen = new Set<string>();
      const run = () => {
        const node = getAt(readTree(), path);
        if (!node || typeof node !== 'object') return;
        const keys = Object.keys(node as Tree);
        if (keys.length === seen.size) return;
        for (const k of keys.sort()) if (!seen.has(k)) { seen.add(k); cb(k, (node as Tree)[k] as T); }
      };
      watchers.add(run); setTimeout(run, 0);
      return () => watchers.delete(run);
    },
  };
}

let instance: Promise<Backend | null> | null = null;
/** The backend to use: ?backend=local forces the local one; otherwise Firebase when configured, else none. */
export function getBackend(): Promise<Backend | null> {
  instance ??= (async () => {
    if (new URLSearchParams(location.search).get('backend') === 'local') return createLocalBackend();
    if (hasFirebaseConfig()) { const b = await createFirebaseBackend(); await b.ready; return b; }
    return null;
  })();
  return instance;
}
