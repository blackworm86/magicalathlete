import type { Backend } from '../net/backend';
import type { PromptAnswer } from '../ui/prompts';
import type { LogEntry, Request, RoomMeta } from './protocol';
import type { GameView } from './view';

const HOST_GONE_MS = 45_000; // the host writes a heartbeat every 10 s

/** A player's screen in someone else's game: shows the host's log and answers the host's questions. */
export function runClient(backend: Backend, code: string, uid: string, view: GameView, onLeave: () => void): () => void {
  const stops: (() => void)[] = [];
  let caught = false;
  view.setCatchUp(true);
  // Replay of the log up to "now" runs at full speed; then we go back to normal speed.
  backend.get<Record<string, unknown>>(`rooms/${code}/log`).then((l) => {
    const total = l ? Object.keys(l).length : 0;
    let n = 0;
    const done = () => { if (!caught) { caught = true; setTimeout(() => view.setCatchUp(false), 50); } };
    if (!total) done();
    stops.push(backend.watchAdded<LogEntry>(`rooms/${code}/log`, (_k, e) => { view.feed(e); if (++n >= total) done(); }));
  });

  // Is the host still there? Its heartbeat changes every 10 s; if it stops, say so instead of freezing silently.
  let status: RoomMeta['status'] | undefined, alive: number | undefined, changed = Date.now();
  stops.push(backend.watch<RoomMeta>(`rooms/${code}/meta`, (m) => {
    if (!m) return;
    status = m.status;
    if (m.alive !== alive) { alive = m.alive; changed = Date.now(); view.hideBanner(); }
  }));
  const gone = setInterval(() => {
    if (status === 'playing' && Date.now() - changed > HOST_GONE_MS) view.showBanner({ k: 'hostGone' }, { label: { k: 'leaveRoom' }, run: onLeave });
  }, 5000);
  stops.push(() => clearInterval(gone));

  const answered = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  stops.push(backend.watchAdded<Request>(`rooms/${code}/req/${uid}`, (id, req) => {
    if (answered.has(id)) return;
    answered.add(id);
    chain = chain.then(async () => {
      if (await backend.get(`rooms/${code}/ans/${uid}/${id}`)) return; // already answered (we reloaded the page)
      await view.drain();
      const v: PromptAnswer = await view.prompter.run(req.spec);
      await backend.set(`rooms/${code}/ans/${uid}/${id}`, { v });
    });
  }));
  return () => stops.forEach((s) => s());
}
