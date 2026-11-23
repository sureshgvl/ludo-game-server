# ludo-game-server

Real-time, authoritative game server for the Ludo tournament app, with a playable web client. The server owns all game state: it rolls the dice, validates every move, runs turn timers and fills empty seats with bots. Clients only display.

**Stack:** Node.js 20+, TypeScript, Colyseus (WebSocket), Redis (optional, for the active-game limit across servers).

## Play it now

```bash
npm install
npm run dev            # http://localhost:2567
```

Open the page, enter a name and choose **Quick match** (bots fill empty seats after 20 s, or press *Start now*), **Create private room** (share the room code with friends) or **Join with code**. You can play up to **3 games at once**, each in its own tab. Tap a glowing piece to move it; press Space to roll.

## What is implemented

| Feature | Where |
|---|---|
| Ludo rules: 52-square track, safe squares, captures, exact finish, extra turn on 6/capture/home, three sixes, forfeit | `src/engine/ludo.ts` |
| Authoritative room: server-side dice (`crypto.randomInt`), turn and phase validation, synced state | `src/rooms/LudoRoom.ts` |
| Turn clock, auto-play on timeout, 3 missed turns forfeit, bots, reconnect window, bot takeover | `src/rooms/LudoRoom.ts` |
| Max 3 active games per user (in-memory, or Redis with an atomic Lua script) | `src/limits/activeGames.ts` |
| Quick match by player count (2 or 4), private rooms by code, bot fill | `src/server.ts`, `src/rooms/LudoRoom.ts` |
| Web client with 3 game tabs | `public/` |

## Protocol (for the Flutter app)

Connect with a Colyseus client to room `ludo`.

- **Join options:** `{ userId, name, players: 2 | 4, private?: boolean }`. Use `joinOrCreate` for quick match, `create` with `private: true` for a private room, `joinById(roomId)` to join by code.
- **Join errors:** `4001` missing userId, `4002` room full, `4003` already in 3 games, `4004` already in this room.
- **Send:** `roll`, `move` with `{ piece: 0..3 }`, `start` (host only, fills empty seats with bots).
- **Receive:** `rolled`, `moved`, `forfeit`, `bot_takeover`, `game_over`.
- **State:** `phase` (`lobby`, `roll`, `move`, `finished`), `currentSeat`, `dice`, `legalMoves`, `turnDeadline`, `fillDeadline`, `players[]` (`seat`, `userId`, `name`, `isBot`, `connected`, `forfeited`, `placement`, `pieces[4]`), `seq`.
- **Piece progress:** `-1` yard, `0..50` shared track, `51..55` home column, `56` home. Seats 0 to 3 are red, green, yellow, blue; a 2-player game uses seats 0 and 2.

## Configuration

Copy `.env.example`. All values are optional.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 2567 | HTTP and WebSocket port |
| `REDIS_URL` | empty | Use Redis for the 3-game limit (needed with more than one server) |
| `MAX_ACTIVE_GAMES` | 3 | Games a user can be in at once |
| `TURN_TIMEOUT_SECONDS` | 15 | Time to act before the server plays for you |
| `MAX_MISSED_TURNS` | 3 | Missed turns in a row before forfeit |
| `LOBBY_FILL_SECONDS` | 20 | Wait before bots fill a public lobby |
| `RECONNECT_SECONDS` | 30 | Time to reconnect before a bot takes over |
| `BOT_DELAY_MS`, `AUTO_MOVE_DELAY_MS`, `FINISHED_CLOSE_MS` | 900, 450, 15000 | Pacing |

## Scripts

```bash
npm run dev         # run with reload
npm run build       # compile to dist/
npm start           # run the compiled server
npm run typecheck
npm test            # engine, room, bots, limits, lobby and http tests (27+ tests, uses redis-server if installed)
python3 scripts/browser_e2e.py   # optional: plays a full game in headless Chrome (needs Playwright)
```

## Known gaps

- **Identity:** `userId` is trusted as sent. Replace it with a token issued by `ludo-api` before any real launch.
- **Results:** finished games are not yet reported to `ludo-api`; tournaments need that hook.
- **Web client:** no reconnect after a page reload yet (the server supports reconnecting).
- **No wallet or paid entry.** Paid-entry cash prizes are not allowed under India's Online Gaming Act 2025; see the product doc.

## Related repositories

`ludo-mobile-app`, `ludo-api`, `ludo-admin-panel`

## Tournament games

A room created with `tournamentId` is a counted tournament game:

- Set `API_URL` (e.g. `http://localhost:3000`) and `INTERNAL_API_KEY` (same value as in ludo-api). Without them tournament joins are refused (`4005 tournaments_unavailable`).
- On join the server asks ludo-api whether the user is registered and the tournament is running (`4006 not_eligible:<reason>`; `4007 wrong_game_size` if the player count differs from the tournament's `playersPerGame`).
- Tournament lobbies keep waiting until two real players are present, then bots fill the remaining seats. Games with fewer than two real players are never counted.
- When the game ends the server POSTs the placements to `POST /api/internal/games` (retried on failure; the API ignores repeats of the same `gameId`). A player replaced by a bot after a disconnect is reported as a bot and earns no points.
- Join options: `{ userId, name, players, tournamentId }`. The web client (`/`) has a Tournaments panel: enter the ludo-api URL, register, play, view the leaderboard.

Env: `REPORT_RETRIES` (5), `REPORT_RETRY_MS` (2000).

## Deploy on Render

1. Deploy `ludo-api` first (see its README) and note its URL.
2. New → Blueprint → pick this repo. It creates `ludo-game-server` (no Redis needed for a single instance).
3. When asked, set `API_URL` (the API's `https://…onrender.com` address) and `INTERNAL_API_KEY` (same value as on the API).
4. Open `https://<your-game-server>.onrender.com/` on two phones to play. In the Tournaments panel enter the API URL.

Free instances sleep when idle, which drops live games; use a paid instance for real play.

## Web client (works like an app on phones)

The page served at `/` is a mobile-first game client: coloured board, animated dice, hopping pawns, sound effects (mute button top right), vibration on capture, and confetti when you win. It is also a PWA: open the address in Chrome on Android and choose **Add to Home screen** (Safari on iPhone: Share → Add to Home Screen). It then opens full screen with its own icon.

### 3D board

The board is drawn with three.js (`web/board3d.js`). After changing it run `npm run build:web`, which rebuilds `public/vendor/board3d.js` (commit that file; Render serves it as is). Devices without WebGL fall back to the flat 2D board, and slow devices automatically drop shadows and resolution.

## Player login

Set `JWT_SECRET` (same value as on `ludo-api`). Players then log in on the web page (mobile number + password, handled by
`ludo-api`) and the room takes their identity from the signed token; a spoofed `userId` is ignored and a missing or expired
token is refused with code 4008. Leave `JWT_SECRET` empty only for local development. `/config.json` tells the web client
whether login is required and where `ludo-api` is (`API_URL`).
