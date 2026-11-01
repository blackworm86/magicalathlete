# Firebase setup (online play, accounts, ranking)

1. **Authentication -> Sign-in method:** enable **Google** and **Email/Password** (accounts for ranked games) and **Anonymous** (guests in friendly games).
2. **Authentication -> Settings -> Authorized domains:** add `blackworm86.github.io`.
3. **Realtime Database -> Rules:** paste the contents of `database.rules.json` and publish. (It changed: rooms, history, users and global tiers.)
4. GitHub repo **Settings -> Secrets and variables -> Actions -> Variables:** `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. Re-run the deploy.

## Data layout
- `rooms/<CODE>/meta` {host, rules: friendly|tournament, status, order, alive}, `players/<uid>`, `log/<n>` (what the host streams to everyone)
- `rooms/<CODE>/req/<uid>/<id>`: a question for one player (only that player can read it), `ans/<uid>/<id>`: the answer (only that player can write it; only the host reads it)
- `rooms/<CODE>/meta/alive`: the host writes a heartbeat every 10 s; players see "the host seems to have left" after 45 s without it
- `rooms/<CODE>/setup` (seed, rules, players) and `rooms/<CODE>/decisions/d000000…` (every answer given by a human): with these the host's page can be reloaded or the browser can crash and the game is rebuilt exactly (the game is deterministic). Only the host can read `decisions`.
- `userRooms/<uid>/<CODE>`: the games a player is in ("Your games" list); `openRooms/<CODE>`: rooms waiting for players, with a heartbeat
- `history/<matchId>` finished ranked tournaments (the S.K.U.L.O. is computed from this in the browser). Only the room's host can write one, and only for a tournament room
- `global/tiers/<characterId>` (tournament tiers, shared by all games, changed with transactions)

## Games survive page reloads
- **A player refreshes:** the browser remembers the room (`#CODE` in the address and in localStorage) and goes straight back; the screen replays the log at full speed and any open question is asked again.
- **The host refreshes or the browser crashes:** after reloading, the host's page reads `setup`, `log` and `decisions`, rebuilds the game and continues. The other players only see the "host seems to have left" message if it takes longer than 45 s.
- **The connection drops:** Firebase queues the writes and reconnects by itself; a yellow banner says "reconnecting" meanwhile.
- **The host never comes back:** the game cannot continue (there is no server); the other players can leave from the banner. A host on a different device can't take over (the answers are only readable by the host's account).

## Rules were tightened
Re-publish `database.rules.json` after every update of this repo (the request/answer paths and the history rule changed).

## Clean-up
Rooms are not deleted automatically. In the console you can delete `rooms/<CODE>` of old games (the log can be some MB per game).

## Trust model
The host's browser runs the game and decides the result (there is no server). Friends can trust each other; a modified client could cheat or write a fake result to `history`. A Cloud Function that validates results would be the next hardening step.

## Testing without Firebase
Open the site with `?backend=local`: accounts, rooms and history live in the browser's localStorage and are shared between tabs of the same browser, so you can try the whole online flow alone with two tabs.
