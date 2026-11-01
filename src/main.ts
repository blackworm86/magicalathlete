import './style.css';
import { startApp } from './ui/app';

const app = document.getElementById('app')!;
if (new URLSearchParams(location.search).has('gallery')) {
  // Developer view: all 36 miniatures standing on the board, to check proportions.
  void (async () => {
    const [{ BoardScene }, { CHARACTERS }, { MILD_MILE }] = await Promise.all([import('./render/boardScene'), import('./engine/characters'), import('./engine/tracks')]);
    app.innerHTML = '<div id="stage"></div>';
    const board = new BoardScene(app.querySelector<HTMLElement>('#stage')!);
    board.setTrack(MILD_MILE);
    CHARACTERS.forEach((c, i) => void board.addRacer(i, 'x', c.id, [0xff7a59, 0x7fb2ff, 0x6fe0a3, 0xffe14d, 0xff9fd2, 0xc4a7ff][i % 6], 1 + Math.floor(i * 28 / 36) % 29));
    document.title = 'gallery';
  })();
} else void startApp(app);
