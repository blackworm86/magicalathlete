# Firebase setup (online play, accounts, ranking)

1. **Authentication -> Sign-in method:** enable **Email/Password** (accounts for ranked games) and **Anonymous** (guests in friendly games).
2. **Authentication -> Settings -> Authorized domains:** add `blackworm86.github.io`.
3. **Realtime Database -> Rules:** paste the contents of `database.rules.json` and publish. (It changed: rooms, history, users and global tiers.)
4. GitHub repo **Settings -> Secrets and variables -> Actions -> Variables:** `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_DATABASE_URL`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`. Re-run the deploy.

## Data layout
- `rooms/<CODE>/meta` {host, rules: friendly|tournament, status, order}, `players/<uid>`, `log/<n>` (what the host streams to everyone), `req/<id>` / `ans/<id>` (questions to remote players and their answers)
- `history/<matchId>` finished ranked tournaments (the S.K.U.L.O. is computed from this in the browser)
- `users/<uid>`, `global/tiers/<characterId>` (tournament tiers, shared by all games)

## Trust model
The host's browser runs the game and decides the result (there is no server). Friends can trust each other; a modified client could cheat or write a fake result to `history`. A Cloud Function that validates results would be the next hardening step.

## Testing without Firebase
Open the site with `?backend=local`: accounts, rooms and history live in the browser's localStorage and are shared between tabs of the same browser, so you can try the whole online flow alone with two tabs.
