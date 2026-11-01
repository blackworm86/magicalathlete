import { CHARACTER_BY_ID, type CharacterId } from '../engine/characters';
import { charName, charText, t, tr, type Txt } from '../i18n';

const BASE = import.meta.env.BASE_URL;
export const racerImg = (id: CharacterId) => `${BASE}assets/racers/${id}.png`;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (string | Node)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
  for (const c of kids) e.append(c);
  return e;
}

/** A question for a player. Serializable, so the host can send it to a remote player's browser. */
export type PromptSpec =
  | { k: 'cards'; title: Txt; sub?: Txt; color?: string; cards: CharacterId[]; count?: number }
  | { k: 'choose'; title: Txt; sub?: Txt; color?: string; options: { label: Txt; id?: CharacterId }[]; none?: Txt }
  | { k: 'yesno'; title: Txt; sub?: Txt; color?: string; card?: CharacterId; yes?: Txt; no?: Txt }
  | { k: 'info'; title: Txt; lines: Txt[]; button?: Txt; color?: string };
/** Answers: cards -> number[]; choose -> number (-1 = none); yesno -> boolean; info -> true */
export type PromptAnswer = number[] | number | boolean;

/** Quick random answer, used for bots and for players who do not answer in time. */
export function randomAnswer(spec: PromptSpec, rnd: () => number = Math.random): PromptAnswer {
  switch (spec.k) {
    case 'cards': { const idx = spec.cards.map((_, i) => i).sort(() => rnd() - 0.5); return idx.slice(0, spec.count ?? 1); }
    case 'choose': return Math.floor(rnd() * spec.options.length);
    case 'yesno': return rnd() < 0.7;
    case 'info': return true;
  }
}

export class Prompter {
  constructor(private root: HTMLElement) {}

  private sheet(title: Txt, sub: Txt | undefined, color: string | undefined, body: Node, footer?: Node) {
    const box = h('div', { class: 'sheet' }, h('h2', color ? { style: `background:${color}` } : {}, tr(title)));
    if (sub) box.append(h('p', { class: 'sub' }, tr(sub)));
    box.append(body);
    if (footer) box.append(footer);
    const wrap = h('div', { class: 'modal' }, box);
    this.root.append(wrap);
    return { close: () => wrap.remove() };
  }

  private cardEl(id: CharacterId, onClick: () => void) {
    const el = h('button', { class: 'card' });
    el.append(h('img', { src: racerImg(id), alt: charName(id) }), h('b', {}, charName(id)), h('i', {}, CHARACTER_BY_ID[id].power), h('span', {}, charText(id)));
    el.onclick = onClick;
    return el;
  }

  /** Shows the question and resolves with the answer (see PromptAnswer). */
  run(spec: PromptSpec): Promise<PromptAnswer> {
    return new Promise((res) => {
      let s: { close: () => void };
      const done = (v: PromptAnswer) => { s.close(); res(v); };
      if (spec.k === 'cards') {
        const count = spec.count ?? 1, chosen: number[] = [];
        const grid = h('div', { class: 'cards' });
        const ok = h('button', { class: 'go', disabled: '' }, count > 1 ? t('confirmN', { a: 0, b: count }) : t('confirm'));
        const els = spec.cards.map((c, i) => {
          const el = this.cardEl(c, () => {
            if (count === 1) return done([i]);
            const k = chosen.indexOf(i);
            if (k >= 0) chosen.splice(k, 1); else if (chosen.length < count) chosen.push(i);
            els.forEach((e, j) => e.classList.toggle('sel', chosen.includes(j)));
            ok.textContent = t('confirmN', { a: chosen.length, b: count });
            ok.toggleAttribute('disabled', chosen.length !== count);
          });
          grid.append(el);
          return el;
        });
        ok.onclick = () => done([...chosen]);
        s = this.sheet(spec.title, spec.sub, spec.color, grid, count > 1 ? ok : undefined);
      } else if (spec.k === 'choose') {
        const row = h('div', { class: 'row' });
        spec.options.forEach((opt, i) => {
          const b = h('button', { class: 'opt' });
          if (opt.id) b.append(h('img', { src: racerImg(opt.id), alt: '' }));
          b.append(tr(opt.label));
          b.onclick = () => done(i);
          row.append(b);
        });
        if (spec.none) { const b = h('button', { class: 'opt no' }, tr(spec.none)); b.onclick = () => done(-1); row.append(b); }
        s = this.sheet(spec.title, spec.sub, spec.color, row);
      } else if (spec.k === 'yesno') {
        const body = h('div', { class: 'row' });
        if (spec.card) body.append(this.cardEl(spec.card, () => undefined));
        const y = h('button', { class: 'go' }, spec.yes ? tr(spec.yes) : t('yes')), n = h('button', { class: 'opt no' }, spec.no ? tr(spec.no) : t('no'));
        y.onclick = () => done(true); n.onclick = () => done(false);
        s = this.sheet(spec.title, spec.sub, spec.color, body, h('div', { class: 'row' }, y, n));
      } else {
        const body = h('div', { class: 'lines' }, ...spec.lines.map((l) => h('p', {}, tr(l))));
        const b = h('button', { class: 'go' }, spec.button ? tr(spec.button) : t('continue'));
        b.onclick = () => done(true);
        s = this.sheet(spec.title, undefined, spec.color, body, b);
      }
    });
  }
}
