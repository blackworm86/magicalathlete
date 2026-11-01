// End-to-end check in a real browser: local game, and a ranked online tournament between two accounts
// (using the built-in test backend, ?backend=local). Run: E2E_URL=http://localhost:4173/ node e2e/run.cjs
const { chromium } = require('playwright');
const BASE = (process.env.E2E_URL || 'http://localhost:5173/').replace(/\/$/, '/');
const Q = '?backend=local&speed=100'; // speed=100: no animations, no drawing, so it runs fast anywhere

const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1; };
const must = (c, m) => { if (!c) { fail(m); throw new Error(m); } };

/** Click the "next" thing in the open question until the game is over. Returns when the end screen was shown. */
async function play(pages, limitMs) {
  const done = pages.map(() => false), t0 = Date.now();
  while (Date.now() - t0 < limitMs && !done.every(Boolean)) {
    for (const [i, p] of pages.entries()) {
      if (done[i] || !(await p.$('.sheet'))) continue;
      const title = (await p.textContent('.sheet h2')) || '';
      if (/wins!|tie/i.test(title)) done[i] = true;
      const btn = (await p.$('.sheet .go:not([disabled])')) || (await p.$('.sheet .cards .card')) || (await p.$('.sheet .opt'));
      if (btn) await btn.click({ timeout: 2000 }).catch(() => undefined);
      if (done[i]) break;
    }
    await pages[0].waitForTimeout(80);
  }
  return done.every(Boolean);
}

async function register(p, name, email) {
  await p.goto(BASE + Q);
  await p.click('.topbar >> text=Log in');
  await p.click('text=No account yet? Create one');
  await p.fill('input[placeholder="Your name"]', name);
  await p.fill('input[placeholder="Email"]', email);
  await p.fill('input[placeholder^="Password"]', 'secret1');
  await p.click('.sheet.small >> text=Create account');
  await p.waitForSelector('.chip:has-text("Logged in as")');
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];
  const watch = (n, p) => { p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`)); };
  try {
    // 1. local friendly game with bots
    const ctx0 = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const L = await ctx0.newPage(); watch('local', L);
    await L.goto(BASE + Q);
    await L.click('text=Local game');
    await L.click('.prow >> nth=0 >> button'); // player 1 -> bot
    await L.click('.go:has-text("Start game")');
    must(await play([L], 90000), 'local game did not finish');
    await L.waitForSelector('.menu-grid'); // the last click ("Play again") sent us home
    console.log('ok: local friendly game');
    await ctx0.close();

    // 2. ranked online tournament, two accounts in two tabs
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 } });
    const A = await ctx.newPage(), B = await ctx.newPage(); watch('A', A); watch('B', B);
    await register(A, 'Ann', 'ann@example.com');
    await register(B, 'Bob', 'bob@example.com');
    await A.click('text=Online game');
    await A.click('.opt:has-text("Tournament (ranked)")');
    await A.click('.go:has-text("Create a room")');
    await A.waitForSelector('.code');
    const code = (await A.textContent('.code')).trim();
    await B.click('text=Online game');
    await B.fill('.codein', code);
    await B.click('.go:has-text("Join")');
    await A.waitForSelector('.prow:has-text("Bob")');
    await A.click('.go:has-text("Start game")');
    must(await play([A, B], 240000), 'online tournament did not finish on both screens');
    for (const p of [A, B]) await p.waitForSelector('.menu-grid', { timeout: 20000 });
    const rating = async (p) => { await p.click('text=Results & S.K.U.L.O.'); await p.waitForSelector('.rating'); return Number((await p.textContent('.rating .big')).trim()); };
    const [ra, rb] = [await rating(A), await rating(B)];
    must(Math.abs(ra + rb - 3000) <= 2, `ratings should add up to 3000, got ${ra} + ${rb}`);
    console.log(`ok: ranked online tournament (Ann ${ra}, Bob ${rb})`);

    // 3. language switch
    await A.click('.seg .opt:has-text("IT")');
    await A.waitForSelector('h1:has-text("Risultati e S.K.U.L.O.")', { timeout: 5000 }).catch(() => must(false, 'Italian title missing'));
    console.log('ok: language switch');
    await ctx.close();
  } finally {
    await browser.close();
  }
  if (errors.length) fail('page errors:\n' + errors.join('\n'));
  if (!process.exitCode) console.log('E2E PASSED');
})().catch((e) => { console.error(e.message); process.exit(1); });
