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
