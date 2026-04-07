# Cloudflare Worker — PeerJS Signaling Server

Deploy a custom signaling server for PeerJS WebRTC on Cloudflare Workers
(free tier). Uses **Durable Objects** to hold WebSocket connections in memory.

---

## 1. Project layout

```
worms-signaling/
├── src/
│   └── index.js        ← Worker + Durable Object
└── wrangler.toml
```

---

## 2. `wrangler.toml`

```toml
name = "worms-signaling"
main = "src/index.js"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name        = "SIGNALING_HUB"
class_name  = "SignalingHub"

[[migrations]]
tag            = "v1"
new_classes    = ["SignalingHub"]
```

---

## 3. `src/index.js`

```js
/**
 * Cloudflare Worker — PeerJS-compatible signaling server.
 *
 * Protocol (PeerJS open-source server protocol):
 *   WS  /peerjs?key=KEY&id=PEER_ID&token=TOKEN
 *
 * Message types routed between peers:
 *   OPEN        server → client   (peer registered)
 *   HEARTBEAT   client ↔ server   (keepalive)
 *   OFFER       client → server → dst peer
 *   ANSWER      client → server → dst peer
 *   CANDIDATE   client → server → dst peer
 *   LEAVE       client → server → broadcast
 *   ERROR       server → client   (dst not found)
 *   ID-TAKEN    server → client   (peer id collision)
 *
 * Rooms / lobby:
 *   Peers with the same `key` share one SignalingHub Durable Object.
 *   A "room" is simply host's peer-id = "worms-ROOMCODE".
 *   The guest connects and sends OFFER directly to that peer-id.
 *   No extra room state is needed — PeerJS handles SDP exchange.
 */

// ── Worker entry point ───────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health / info endpoint
    if (url.pathname === '/' || url.pathname === '') {
      return json({ name: 'worms-signaling', version: '1.0.0', online: true });
    }

    // PeerJS endpoint — route to Durable Object per key
    if (url.pathname.startsWith('/peerjs')) {
      const key = url.searchParams.get('key') || 'default';
      // One DO per signaling key (namespace)
      const id   = env.SIGNALING_HUB.idFromName(key);
      const stub = env.SIGNALING_HUB.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// ── Durable Object ───────────────────────────────────────────────────────────
/**
 * SignalingHub — holds all active WebSocket sessions for one signaling key.
 *
 * Uses the Hibernatable WebSockets API so sessions survive DO sleep.
 * Each WebSocket is tagged with its peer ID for fast lookup.
 */
export class SignalingHub {
  constructor(state) {
    this.state = state;
  }

  // ── Incoming HTTP request (WebSocket upgrade) ────────────────────────────
  async fetch(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const url    = new URL(request.url);
    const peerId = url.searchParams.get('id');
    if (!peerId) {
      return new Response('Missing ?id param', { status: 400 });
    }

    // Reject duplicate peer IDs
    const existing = this.state.getWebSockets(peerId);
    if (existing.length > 0) {
      const [client, server] = Object.values(new WebSocketPair());
      server.accept();
      server.send(JSON.stringify({ type: 'ID-TAKEN', src: 'server', payload: { msg: 'Peer ID already in use' } }));
      server.close(4001, 'ID taken');
      return new Response(null, { status: 101, webSocket: client });
    }

    // Accept and tag with peer ID (enables hibernation + getWebSockets(tag))
    const [client, server] = Object.values(new WebSocketPair());
    this.state.acceptWebSocket(server, [peerId]);

    // Greet the peer
    server.send(JSON.stringify({ type: 'OPEN', src: peerId }));

    return new Response(null, {
      status:    101,
      webSocket: client,
      headers:   { 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ── Hibernatable WebSocket handlers ─────────────────────────────────────

  /** Called for every message received on any WebSocket. */
  webSocketMessage(ws, raw) {
    const tags   = this.state.getTags(ws);
    const srcId  = tags[0];
    if (!srcId) return;

    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    msg.src = srcId;

    // Keepalive — echo back
    if (msg.type === 'HEARTBEAT') {
      ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
      return;
    }

    // Peer wants to leave gracefully
    if (msg.type === 'LEAVE') {
      this._notifyLeave(srcId, ws);
      try { ws.close(1000, 'leave'); } catch {}
      return;
    }

    // Forward signaling message to destination peer
    const dstId  = msg.dst;
    if (!dstId) return;

    const dstSockets = this.state.getWebSockets(dstId);
    if (!dstSockets.length) {
      ws.send(JSON.stringify({
        type:    'ERROR',
        src:     'server',
        payload: { msg: `Peer ${dstId} not found`, type: msg.type },
      }));
      return;
    }

    try {
      dstSockets[0].send(JSON.stringify(msg));
    } catch {
      ws.send(JSON.stringify({ type: 'ERROR', src: 'server', payload: { msg: 'Delivery failed' } }));
    }
  }

  /** Called when a WebSocket closes (including after hibernation). */
  webSocketClose(ws) {
    const tags  = this.state.getTags(ws);
    const srcId = tags?.[0];
    if (srcId) this._notifyLeave(srcId, ws);
  }

  /** Called on WebSocket error. */
  webSocketError(ws) {
    this.webSocketClose(ws);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Broadcast LEAVE to all other connected peers. */
  _notifyLeave(peerId, closingWs) {
    const payload = JSON.stringify({ type: 'LEAVE', src: peerId });
    for (const ws of this.state.getWebSockets()) {
      if (ws === closingWs) continue;
      try { ws.send(payload); } catch {}
    }
  }
}
```

---

## 4. Deploy

```bash
# Install Wrangler CLI
npm install -g wrangler

# Login
wrangler login

# Create project and deploy
cd worms-signaling
npm init -y
wrangler deploy
```

After deploy, your signaling URL is:

```
wss://worms-signaling.<YOUR_SUBDOMAIN>.workers.dev/peerjs
```

---

## 5. Connect PeerJS client to the Worker

In `js/network/P2PSync.js`, set:

```js
export const PEER_CONFIG = {
  host:   'worms-signaling.<YOUR_SUBDOMAIN>.workers.dev',
  port:    443,
  path:   '/peerjs',
  secure:  true,
  key:    'wormsmm',
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  },
};
```

---

## 6. Firebase RTDB Rules (reference — not needed for CF Worker)

If you ever switch back to Firebase, set these in Firebase Console →
Realtime Database → Rules:

```json
{
  "rules": {
    "rooms": {
      "$r": { ".read": true, ".write": true }
    }
  }
}
```

---

## 7. Costs

- Cloudflare Workers free tier: 100k requests/day, unlimited WebSocket messages.
- Durable Objects free tier: 1M requests/month.
- Zero cost for a small game.
