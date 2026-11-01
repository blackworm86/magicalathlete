import { CHARACTER_BY_ID, type CharacterId } from '../engine/characters';
import { en } from './en';
import { it } from './it';
import { IT_TEXT } from './it-characters';

export type Lang = 'en' | 'it';
export type Key = keyof typeof en;
export type Params = Record<string, string | number>;
/** Text that is either already a plain string or a translation key (so it can travel between players in different languages). */
export type Txt = string | { k: Key; p?: Params };

const dict = { en, it } as const;
function initial(): Lang {
  try { const s = localStorage.getItem('ma_lang'); if (s === 'en' || s === 'it') return s; } catch { /* ignore */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en';
}
let lang: Lang = initial();
const listeners = new Set<() => void>();

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem('ma_lang', l); } catch { /* ignore */ }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}
export const onLang = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };

export const charName = (id: CharacterId) => CHARACTER_BY_ID[id]?.name ?? String(id);
export const charText = (id: CharacterId) => (lang === 'it' ? IT_TEXT[id] : CHARACTER_BY_ID[id]?.text) ?? '';

export function t(key: Key, p?: Params): string {
  let s: string = dict[lang][key] ?? en[key] ?? key;
  if (p) for (const [k, v] of Object.entries(p)) s = s.replaceAll(`{${k}}`, k.startsWith('char') && typeof v === 'string' && CHARACTER_BY_ID[v as CharacterId] ? charName(v as CharacterId) : String(v));
  return s;
}
export const tr = (x: Txt | undefined): string => (x === undefined ? '' : typeof x === 'string' ? x : t(x.k, x.p));
export const trackName = (id: 'mild' | 'wild') => t(id);
document.documentElement.lang = lang;
