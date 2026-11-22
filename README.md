# ludo-game-server

Real-time, authoritative game server for the Ludo tournament app. It owns all game state: it rolls the dice, validates every move, runs turn timers and fills empty seats with bots. Clients only display.

**Stack:** Node.js 20+, TypeScript, Colyseus (WebSocket), Redis (live state and the active-game counter).

## Responsibilities

- One Colyseus room per game (2 or 4 players)
- Server-side dice (CSPRNG) and move validation
- Turn timer, auto-play, reconnect, bot takeover
- Enforce the limit of 3 active games per user (see `src/config.ts`)
- Report finished games and placements to `ludo-api`

## Getting started

```bash
cp .env.example .env
npm install
npm run dev        # http://localhost:2567/health
```

Other scripts: `npm run build`, `npm start`, `npm run typecheck`.

## Status

Skeleton only. The room, state and config exist; the rules engine, the 3-game check and bots are marked `TODO` in `src/rooms/LudoRoom.ts`.

## Related repositories

`ludo-mobile-app`, `ludo-api`, `ludo-admin-panel`
