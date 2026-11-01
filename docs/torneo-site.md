# Tournament site ("Magical Outlet") - how it works

Source read from https://crazycatcafe.github.io/magical-athlete-torneo/ (static site: `index.html`, `config.js`, `core.js`, `app.js`, `style.css`; vanilla JS + Firebase Realtime Database compat SDK, QR codes). Italian UI. It is a **companion app for the physical board game**, not a digital board.

## Roles and flow
- **Banco** (tablet in the middle of the table) creates a game: a 4-letter code + QR. **Players** join on their phones with the code, pick their name from the registered list (or register a new one) and a team name.
- Stages: `lobby` -> `pole` (random pole position) -> `draft` -> 4 races -> `end`.
- Game state is one JSON string at `games/<code>/state`, changed only through Firebase transactions (`commit`). Side data: `games/<code>/players`, `/bonus` (bronze chips from phones), `/farts` (joke sound counter, used as a tie-break).
- Global data (shared between games): `global/tiers`, `global/history`, `global/players` (registered players), `global/images` (card photos), `global/elo`.

## Tournament rules (v3)
- 4 races, points for 1st/2nd: race 1 3/1, race 2 4/2, race 3 4/2, race 4 5/3, plus bronze chips (+1 each, entered from the phone).
- Pole position (random): who starts race 1, who chooses first in race 1, who starts the draft.
- **Common draft before the races:** 5 rounds; each round reveals N+1 cards, each player takes one clockwise, next round starts from the next player, the leftover card is discarded -> 5 cards each.
- Race 1: racers chosen clockwise from the pole player. Races 2-4: order by points (ties: fewer fart/burp sounds, then tier of the previous race card, then random); then the last player in the standings chooses who starts the race.
- At the end the card left in hand gives no points. **Tiers** S/A/B/C/D/E are global: the winner's card goes up one tier, the last place's card goes down one (permanent).
- Sisyphus starts with 4 bronze chips (bz). Max 6 players.
- **Elo ("S.K.U.L.O.")**: each tournament = pairwise matches between all players; more points wins (tie = 0.5); K = 24 (double for each player's first 3 tournaments), start 1500, computed in date order over the whole history; shared seats ("Luigi/Fabio") are supported.
- Stats per player (win rate, podiums, average points), Elo chart, history list, card photo upload, share image.

## Visual style (copied into this project's `src/style.css`)
Periwinkle background `#cfd6ff`, ink `#14121f`, white panels with 3px ink borders and hard offset shadows (`5px 5px 0`), Lilita One headings + Nunito text, pill buttons, yellow rotated logo tag, player colours `#ff7a59 #7fb2ff #6fe0a3 #ffe14d #ff9fd2 #c4a7ff`, tier colours S `#ff7a59`, A `#ffe14d`, B `#7fb2ff`, C `#6fe0a3`, D `#ff9fd2`, E `#c9c9d6`.

## Differences to this project
- This project plays the race itself (3D board, engine, powers). The tournament site only manages the table around it.
- Its draft is common (5 rounds, N+1 cards, 5 cards each) instead of the rulebook's 4 racers each.
- Its Firebase project is separate (`magical-athlete-torneo`). Sharing registered players / Elo would need either the same project or an export.
