import type { Backend } from '../net/backend';
import type { PromptAnswer } from '../ui/prompts';
import type { LogEntry, Request } from './protocol';
import type { GameView } from './view';

/** A player's screen in someone else's game: shows the host's log and answers the host's questions. */
export function runClient(backend: Backend, code: string, uid: string, view: GameView): () => void {
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

  const answered = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  stops.push(backend.watchAdded<Request>(`rooms/${code}/req`, (id, req) => {
    if (req.to !== uid || answered.has(id)) return;
    answered.add(id);
    chain = chain.then(async () => {
      const existing = await backend.get(`rooms/${code}/ans/${id}`);
      if (existing) return; // already answered (we reloaded the page)
      await view.drain();
      const v: PromptAnswer = await view.prompter.run(req.spec);
      await backend.set(`rooms/${code}/ans/${id}`, { v });
    });
  }));
  return () => stops.forEach((s) => s());
}
