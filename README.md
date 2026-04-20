# GuessTheImposter

A real-time multiplayer party game built with **Ionic React**, **Fastify**, and **Socket.IO**.

Players join a room, one hidden imposter is assigned, everyone gives short clues over multiple rounds, and the lobby votes at the end.

## Tech Stack

- `apps/web`: Ionic React + Vite + Socket.IO client
- `apps/server`: Fastify + Socket.IO server
- `packages/shared`: shared game engine + rules + tests

## Monorepo Layout

```text
apps/
	web/
	server/
packages/
	shared/
```

## Current Gameplay Rules

- No authentication (room code/link based)
- Exactly **1 imposter** per game
- Max players: **10**
- At least **3 players** required to start
- Player names must be unique in a room (case-insensitive)
- Host can drag-reorder player order in staging
- Rounds use the same seeded secret word + imposter for the full match
- Clue submission is turn-based
- Clues are limited to **max 3 words**
- Final vote is mandatory (cannot self-vote)
- Tie/top-vote ambiguity => imposter wins
- Vote timeout rule is enforced
- If imposter disconnects during game/voting, crewmates win immediately
- Play again returns everyone to lobby/staging

## Features Implemented

- Room create/join with deep-link support
- Rejoin identity support with active-seat protection
- Host transfer and disconnect cleanup behavior
- Turn progression that skips disconnected players
- Final voting countdown + timeout resolution
- Result reveal screen with secret word display
- In-person mode and online mode support
- "How to Play" screen
- Shared engine test coverage for key game rules

## Quick Start (Local)

### Requirements

- Node.js `>=20`

### Install

```powershell
npm install
```

### Run server and web (two terminals)

```powershell
npm run dev:server
```

```powershell
npm run dev:web
```

If needed, point web to a custom backend:

```powershell
$env:VITE_SERVER_URL="http://localhost:4000"
npm run dev:web
```

## Scripts

From repository root:

- `npm run dev:server` — start backend in watch mode
- `npm run dev:web` — start web app
- `npm test` — run shared engine tests

Workspace scripts:

- `npm run build -w @imposter/web` — production web build
- `npm run start -w @imposter/server` — run backend in production mode

## Environment Variables

### Web

- `VITE_SERVER_URL` (optional)

### Server

- `PORT` (default: `4000`)
- `ROOM_IDLE_TTL_MS` (default: 2h)
- `ROOM_SWEEP_INTERVAL_MS` (default: 60s)
- `VOTE_TIMEOUT_SWEEP_MS` (default: 1s)
- `DISCONNECT_GRACE_MS` (default: 30s)

## Deployment Notes

This project currently uses an **in-memory room store** on the server.

For production right now:

- Run a **single backend instance** (no horizontal scaling yet)
- Use a host that supports WebSockets
- Set `VITE_SERVER_URL` in the web deployment

Recommended providers:

- Web: Vercel / Netlify / Cloudflare Pages
- Server: Railway / Render / Fly.io / VPS

## Health Check

- `GET /health` → `{ "ok": true }`

## Socket Events (Server)

Client -> server:

- `room:create`
- `room:join`
- `room:get`
- `room:reorderPlayers`
- `settings:update`
- `game:start`
- `round:advance`
- `round:submitWord`
- `vote:cast`
- `game:finalize`
- `game:playAgain`
- `game:restart`

Server -> client broadcasts:

- `room:updated`
- `room:playerDisconnected`
- `room:serverError`

## Next Step for Scale

Before multi-instance backend scaling, move room state from in-memory store to Redis/shared storage.
