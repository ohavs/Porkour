# Porkour online server

`server.js` (Node 20+, dependencies `ws` + `jose`). It does three things and **never runs the game**:

1. **Who you are** — a Google account (the browser sends Google's ID token once, the server verifies its signature
   against Google's public keys) or a guest with a name.
2. **Rooms** — 4-letter codes, public room list, quick play, host controls (start, public/private, kick), lobby chat.
3. **Relay** — forwards game data between the host and the players when their browsers can't connect directly.
   Usually they *do* connect directly (WebRTC peer-to-peer, the server only passes the handshake), which is faster.

The game itself runs in the **host's browser** (host-authoritative, like Human: Fall Flat / Gang Beasts): players send
their controls, the host sends back compact snapshots of the world 30×/s. Code: `web/src/net/`.

## Run locally

    cd server && npm install && npm start        # ws://localhost:8080  (DEBUG=1 for logs)
    npm test                                      # protocol smoke test

The game on `localhost` uses `ws://localhost:8080` automatically (`?server=` overrides it).

## Put it online (free) — Render.com

1. Sign in at https://render.com with GitHub.
2. **New → Blueprint** → choose the `Porkour` repo → **Apply**. Render reads `render.yaml` and creates
   `porkour-server` (free plan, `server/` folder). Every push to `main` redeploys it.
3. When it shows **Live**, copy its address, e.g. `https://porkour-server-xxxx.onrender.com`.
   The game needs it as `wss://porkour-server-xxxx.onrender.com` → `BUILT_IN_SERVER` in `web/src/net/config.ts`
   (or the `VITE_SERVER_URL` build variable).

The free plan sleeps after ~15 minutes without players; the first connection then waits up to a minute (the lobby
says so). Any Node host with WebSockets works the same way (Railway, Fly.io, a VPS: `PORT=80 node server.js`).

## Sign in with Google — the Client ID

1. https://console.cloud.google.com → create a project (e.g. "Porkour").
2. **APIs & Services → OAuth consent screen**: External, app name "Porkour", your email → save
   (only the basic profile is used: name + picture; no review needed).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** → type **Web application**.
   **Authorized JavaScript origins**: `https://ohavs.github.io` (where the game is published),
   plus `http://localhost:5173` and `http://localhost:4173` for testing. No redirect URIs needed.
4. Copy the **Client ID** (`…apps.googleusercontent.com`). It is public, not a secret. It goes in two places:
   `BUILT_IN_GOOGLE_CLIENT_ID` in `web/src/net/config.ts` and in `server/server.js` (or the server's `GOOGLE_CLIENT_ID` env var).

Without a Client ID everything still works: players are guests with a name.

## Protocol

Text frames are JSON `{op: …}`: `hello` → `welcome`, `list` → `rooms`, `create` / `join` / `quick` → `joined`,
`room` (host: state / public / name), `kick`, `chat`, `outfit`, `name`, `signal` (WebRTC handshake), `ping` → `pong`.
Server pushes `peer_join`, `peer_leave`, `peer_update`, `room`, `closed` (host left), `kicked`, `error`.

Binary frames: `[u8 target peer id (0 = everyone else)] + payload`, delivered as `[u8 sender id] + payload`.
Payloads are defined in `web/src/net/sync.ts` (snapshots, inputs, keyframe requests, pings).
