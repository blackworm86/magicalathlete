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
- `src/engine/powers.ts` implemented powers: see `IMPLEMENTED`; the rest are TODO
- `scripts/gen-track-svg.ts` regenerates `public/assets/maps/{mild,wild}.svg` from the track data
- Chips: gold 3/4/4/5, silver 1/2/2/3 for races 1-4, bronze 1-point chips for stars and powers
