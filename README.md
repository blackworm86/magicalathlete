# Magical Athlete (online, 3D)

Browser version of the board game. Vite + TypeScript + Three.js, Firebase Realtime Database for multiplayer, GitHub Pages hosting.

- `src/engine` deterministic rules engine (no rendering, no network), unit tested
- `src/render` Three.js scene
- `src/net` Firebase sync (shared action log + seeded dice)
- `public/assets` models (GLB), maps, cards
- `.claude/skills` Impeccable (UI design) and Ponytail (minimal-code) skills for Claude Code

```
npm install
cp .env.example .env.local   # fill in Firebase web config
npm run dev
```

## Status

- `src/engine/tracks.ts` both base tracks (Mild Mile, Wild Wilds), `characters.ts` all 36 racers with card text and rulings
- `src/engine/race.ts` race engine (turns, main move, passing, stopping, arrows/stars/trips, finishing, trigger order, rule-5 loop handling), `match.ts` scoring
- `src/engine/match.ts` the whole game: roll-off, snake draft (standard, 2-player and 3-player double-racer variants), secret picks, Egg and Twin, 4-race schedule, scoring, next-first-player rule
- `src/engine/powers.ts` all 36 base-game powers (Egg and Twin borrow powers via `entry.extra`; the pick is made by the match flow, still to do)
- `scripts/gen-track-svg.ts` regenerates `public/assets/maps/{mild,wild}.svg` from the track data
- Chips: gold 3/4/4/5, silver 1/2/2/3 for races 1-4, bronze 1-point chips for stars and powers

## Run the prototype

```
npm install
npm run dev        # http://localhost:5173
```

Local hot-seat game for 2-6 players (humans and bots) with the 3D board, animated races and prompts for every power decision. Online play through Firebase is the next step.
