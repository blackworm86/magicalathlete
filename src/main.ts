import './style.css';
import { PLAYER_COLORS, runGame, type PlayerCfg } from './game/session';
import { h } from './ui/prompts';

const app = document.getElementById('app')!;

function start() {
  app.innerHTML = '';
  let n = 4;
  const human = [true, false, false, false, false, false];
  const names = ['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6'];
  const box = h('div', { class: 'start' }, h('span', { class: 'logo t' }, 'Magical Athlete'), h('p', { class: 'sub' }, 'Local prototype · 2–6 players, humans and bots'));
  const count = h('div', { class: 'row' });
  const list = h('div', { class: 'plist' });
  const render = () => {
    count.innerHTML = '';
    for (let k = 2; k <= 6; k++) {
      const b = h('button', { class: 'opt' + (k === n ? ' on' : '') }, `${k}`);
      b.onclick = () => { n = k; render(); };
      count.append(b);
    }
    list.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const name = h('input', { value: names[i] });
      const dot = h('span', { class: 'dot', style: `background:${PLAYER_COLORS[i]}` }, String(i + 1));
      name.oninput = () => { names[i] = name.value; };
      const t = h('button', { class: 'opt' }, human[i] ? 'Human' : 'Bot 🤖');
      t.onclick = () => { human[i] = !human[i]; render(); };
      list.append(h('div', { class: 'prow' }, dot, name, t));
    }
    if (n === 2) list.append(h('p', { class: 'sub' }, '2 players use the 2-player variant: 8 racers each, 2 racers per race.'));
  };
  render();
  const go = h('button', { class: 'go' }, 'Start game');
  go.onclick = async () => {
    const players: PlayerCfg[] = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: names[i] || `Player ${i + 1}`, human: human[i], color: PLAYER_COLORS[i] }));
    app.innerHTML = '<div id="stage"></div>';
    await runGame(app, players);
    start();
  };
  box.append(count, list, go);
  app.append(h('div', { class: 'modal home' }, box));
}
start();
