# Imposter (Bare-Min Architecture)

A lightweight web-based multiplayer Imposter game starter using Ionic React + Node + Socket.IO.

## Finalized Game Rules (from your decisions)

- No authentication
- Shareable room code/link
- Predefined categories only
- Exactly **1 imposter** in every game
- Max players: **10**
- Fixed player order
- No clue submission phase
- Mandatory voting (cannot skip, cannot self-vote)
- Play through configured rounds, then final vote + elimination
- Tie vote => imposter wins
- Play again sends everyone back to lobby with settings editable by host

## Monorepo Structure

- `apps/web` — Ionic React + Vite client
- `apps/server` — Fastify + Socket.IO backend
- `packages/shared` — game rules/state machine used by backend (and optionally web)

## What this starter already includes

- Room create/join flow
- Host-only game start
- Shared game engine for room lifecycle
- Round progression to final voting
- Vote casting and final winner computation
- Play-again reset to lobby
- Unit tests for key winner/voting rules

## What is intentionally left as next implementation step

- Flip-card role reveal UI with privacy overlay
- Discussion/round timer UI screens
- Final voting UI screen
- Persistent reconnect identity (`localStorage` + reconnect token)
- Redis store (currently in-memory `Map` for bare-min local dev)

## Socket Event Contract (initial)

- `room:create` `{ hostName, settings }`
- `room:join` `{ roomCode, playerName }`
- `room:get` `{ roomCode }`
- `settings:update` `{ roomCode, actorId, settings }`
- `game:start` `{ roomCode, actorId }`
- `round:advance` `{ roomCode, actorId }`
- `vote:cast` `{ roomCode, voterId, targetId }`
- `game:finalize` `{ roomCode }`
- `game:playAgain` `{ roomCode, actorId }`
- Broadcast: `room:updated` with full room state

## Local Run

```powershell
npm install
npm run dev:server
npm run dev:web
```

Set web server URL if needed:

```powershell
$env:VITE_SERVER_URL="http://localhost:4000"
npm run dev:web
```

## Deployment (simple path)

- Frontend (`apps/web`): Vercel / Netlify
- Backend (`apps/server`): Render / Railway / Fly.io
- Data store: swap `roomStore` to Upstash Redis when moving from prototype to production

---

If you want, next step I can implement the **3 key gameplay screens** end-to-end:
1) role flip card, 2) round progress screen, 3) final voting + result screen.
