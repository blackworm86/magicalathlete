import { CHARACTER_BY_ID, type CharacterId } from '../engine/characters';

const BASE = import.meta.env.BASE_URL;
export const racerImg = (id: CharacterId) => `${BASE}assets/racers/${id}.png`;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (string | Node)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
  for (const c of kids) e.append(c);
  return e;
}

export interface Card { id?: CharacterId; name: string; text?: string; tag?: string; note?: string }

export const cardOf = (id: CharacterId, note?: string): Card => {
  const c = CHARACTER_BY_ID[id];
  return { id, name: c.name, tag: c.power, text: c.text, note };
};

/** Modal prompts rendered over the 3D view. Each returns a promise resolved by the click. */
export class Prompter {
  constructor(private root: HTMLElement) {}

  private sheet(title: string, sub: string | undefined, color: string | undefined, body: Node, footer?: Node): { close: () => void } {
    const box = h('div', { class: 'sheet' }, h('h2', color ? { style: `border-color:${color}` } : {}, title));
    if (sub) box.append(h('p', { class: 'sub' }, sub));
    box.append(body);
    if (footer) box.append(footer);
    const wrap = h('div', { class: 'modal' }, box);
    this.root.append(wrap);
    return { close: () => wrap.remove() };
  }

  private cardEl(c: Card, onClick: () => void, selected = false) {
    const el = h('button', { class: 'card' + (selected ? ' sel' : '') });
    if (c.id) el.append(h('img', { src: racerImg(c.id), alt: c.name }));
    el.append(h('b', {}, c.name));
    if (c.tag) el.append(h('i', {}, c.tag));
    if (c.text) el.append(h('span', {}, c.text));
    if (c.note) el.append(h('em', {}, c.note));
    el.onclick = onClick;
    return el;
  }

  /** Pick `count` of the cards. Resolves with the chosen indices. */
  pickCards(o: { title: string; sub?: string; color?: string; cards: Card[]; count?: number }): Promise<number[]> {
    const count = o.count ?? 1;
    return new Promise((res) => {
      const chosen: number[] = [];
      const grid = h('div', { class: 'cards' });
      const ok = h('button', { class: 'go', disabled: '' }, count > 1 ? `Confirm (0/${count})` : 'Confirm');
      let s: { close: () => void };
      const els = o.cards.map((c, i) => {
        const el = this.cardEl(c, () => {
          if (count === 1) { s.close(); res([i]); return; }
          const k = chosen.indexOf(i);
          if (k >= 0) chosen.splice(k, 1); else if (chosen.length < count) chosen.push(i);
          els.forEach((e, j) => e.classList.toggle('sel', chosen.includes(j)));
          ok.textContent = `Confirm (${chosen.length}/${count})`;
          ok.toggleAttribute('disabled', chosen.length !== count);
        });
        grid.append(el);
        return el;
      });
      ok.onclick = () => { s.close(); res([...chosen]); };
      s = this.sheet(o.title, o.sub, o.color, grid, count > 1 ? ok : undefined);
    });
  }

  choose(o: { title: string; sub?: string; color?: string; options: { label: string; id?: CharacterId }[]; allowNone?: string }): Promise<number> {
    return new Promise((res) => {
      const row = h('div', { class: 'row' });
      let s: { close: () => void };
      o.options.forEach((opt, i) => {
        const b = h('button', { class: 'opt' });
        if (opt.id) b.append(h('img', { src: racerImg(opt.id), alt: '' }));
        b.append(opt.label);
        b.onclick = () => { s.close(); res(i); };
        row.append(b);
      });
      if (o.allowNone) { const b = h('button', { class: 'opt no' }, o.allowNone); b.onclick = () => { s.close(); res(-1); }; row.append(b); }
      s = this.sheet(o.title, o.sub, o.color, row);
    });
  }

  yesNo(o: { title: string; sub?: string; color?: string; card?: Card; yes?: string; no?: string }): Promise<boolean> {
    return new Promise((res) => {
      const body = h('div', { class: 'row' });
      if (o.card) body.append(this.cardEl(o.card, () => undefined));
      const y = h('button', { class: 'go' }, o.yes ?? 'Yes'), n = h('button', { class: 'opt no' }, o.no ?? 'No');
      let s: { close: () => void };
      y.onclick = () => { s.close(); res(true); }; n.onclick = () => { s.close(); res(false); };
      const foot = h('div', { class: 'row' }, y, n);
      s = this.sheet(o.title, o.sub, o.color, body, foot);
    });
  }

  info(o: { title: string; lines: string[]; button?: string; color?: string }): Promise<void> {
    return new Promise((res) => {
      const body = h('div', { class: 'lines' }, ...o.lines.map((l) => h('p', {}, l)));
      const b = h('button', { class: 'go' }, o.button ?? 'Continue');
      let s: { close: () => void };
      b.onclick = () => { s.close(); res(); };
      s = this.sheet(o.title, undefined, o.color, body, b);
    });
  }
}
