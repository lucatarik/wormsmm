/**
 * P2PSync — WebRTC P2P via PeerJS.
 *
 * Signaling: custom Cloudflare Worker (see cloudflareworker.md) or free PeerJS cloud.
 *
 * Flow (NO round-trip hello/start handshake — avoids serialization races):
 *   HOST  : creates Peer id=worms-ROOMCODE, waits for connection.
 *            On open → immediately sends {type:'start',seed,teams} via JSON.stringify.
 *            Resolves promise right away (doesn't wait for ack).
 *   GUEST : creates anonymous Peer, connects with metadata.name = playerName.
 *            Waits for first 'data' event with type==='start'.
 *            Resolves promise with received game data.
 *
 * ALL messages sent via JSON.stringify, received via _parseAny() which handles
 * string / ArrayBuffer / already-decoded-object — bypasses any binarypack issues.
 */

const CF_WORKER_HOST = '';   // ← fill in after deploying CF Worker

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80',                username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',               username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

export const PEER_CONFIG = CF_WORKER_HOST
  ? { host: CF_WORKER_HOST, port: 443, path: '/peerjs', secure: true, key: 'wormsmm', debug: 0, config: { iceServers: ICE_SERVERS } }
  : { host: '0.peerjs.com',  port: 443, path: '/',       secure: true,                debug: 1, config: { iceServers: ICE_SERVERS } };

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.random() * chars.length | 0]).join('');
}

function createTeams(hostName, guestName = 'Player 2') {
  return [
    { id: 'team-0', name: hostName, color: 0xff4444,
      worms: [
        { id: 'w0-0', name: 'Walker' }, { id: 'w0-1', name: 'Runner' },
        { id: 'w0-2', name: 'Digger' }, { id: 'w0-3', name: 'Basher' },
      ] },
    { id: 'team-1', name: guestName, color: 0x4488ff,
      worms: [
        { id: 'w1-0', name: 'Jumper' }, { id: 'w1-1', name: 'Blaster' },
        { id: 'w1-2', name: 'Ninja'  }, { id: 'w1-3', name: 'Sniper'  },
      ] },
  ];
}

/** Parse any PeerJS data event payload — handles string, ArrayBuffer, or plain object. */
function _parseAny(raw) {
  try {
    if (typeof raw === 'string') return JSON.parse(raw);
    if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
      return JSON.parse(new TextDecoder().decode(raw));
    }
    return raw;   // binarypack already decoded it to an object
  } catch { return null; }
}

// ── Main class ────────────────────────────────────────────────────────────────
export class P2PSync {
  static generateRoomId() { return generateRoomId(); }

  constructor() {
    this._handlers   = {};
    this._peer       = null;
    this._conn       = null;
    this.roomId      = null;
    this.myTeamIndex = null;
    this.playerId    = null;
  }

  on(event, fn) { this._handlers[event] = fn; }
  _emit(event, data) { this._handlers[event]?.(data); }

  // ── HOST ─────────────────────────────────────────────────────────────────
  createRoom(playerName, presetRoomId) {
    return new Promise((resolve, reject) => {
      const roomCode  = (presetRoomId || generateRoomId()).toUpperCase();
      const peerId    = 'worms-' + roomCode.toLowerCase();
      this.roomId      = roomCode;
      this.myTeamIndex = 0;
      this.playerId    = 'host';

      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(val);
      };
      const timer = setTimeout(() => done(new Error('Timeout: no guest connected within 60 s')), 60000);

      let peer;
      try { peer = new Peer(peerId, PEER_CONFIG); }
      catch (e) { done(e); return; }
      this._peer = peer;

      peer.on('error', (err) => {
        console.error('[P2PSync host] peer error:', err);
        done(err);
      });

      peer.on('open', (id) => {
        console.log('[P2PSync host] peer open, id:', id);
      });

      peer.on('connection', (conn) => {
        console.log('[P2PSync host] incoming connection, metadata:', conn.metadata);
        this._conn = conn;

        // Guest name is passed via connection metadata — no round-trip needed
        const guestName = conn.metadata?.name || 'Player 2';
        const seed      = (Math.random() * 0xffffffff) >>> 0;
        const teams     = createTeams(playerName, guestName);

        conn.on('error', (err) => console.error('[P2PSync host] conn error:', err));

        conn.on('open', () => {
          console.log('[P2PSync host] data channel open');

          // Send start data immediately — no hello handshake needed
          conn.send(JSON.stringify({ type: 'start', seed, teams }));
          console.log('[P2PSync host] sent start packet');

          // Ongoing game action listener
          conn.on('data', (raw) => {
            const msg = _parseAny(raw);
            if (!msg || msg.type === 'start') return;
            this._emit('remote_action', { playerId: 'remote', data: msg });
          });
          conn.on('close', () => this._emit('disconnect', {}));

          done(null, { seed, teams, roomId: roomCode, myTeamIndex: 0, playerId: 'host' });
        });
      });
    });
  }

  // ── GUEST ────────────────────────────────────────────────────────────────
  joinRoom(roomId, playerName) {
    return new Promise((resolve, reject) => {
      const roomCode   = roomId.toUpperCase().trim();
      const hostPeerId = 'worms-' + roomCode.toLowerCase();
      this.roomId      = roomCode;
      this.myTeamIndex = 1;
      this.playerId    = 'guest';

      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(val);
      };
      const timer = setTimeout(() => done(new Error('Timeout: host did not respond within 60 s')), 60000);

      let peer;
      try { peer = new Peer(PEER_CONFIG); }
      catch (e) { done(e); return; }
      this._peer = peer;

      peer.on('error', (err) => {
        console.error('[P2PSync guest] peer error:', err);
        done(err);
      });

      peer.on('open', (id) => {
        console.log('[P2PSync guest] peer open, id:', id, '— connecting to', hostPeerId);

        const conn = peer.connect(hostPeerId, {
          reliable:      true,
          serialization: 'json',      // avoid binarypack, use plain JSON
          metadata:      { name: playerName },
        });
        this._conn = conn;

        conn.on('error', (err) => {
          console.error('[P2PSync guest] conn error:', err);
          done(err);
        });

        conn.on('open', () => {
          console.log('[P2PSync guest] data channel open — waiting for start packet');
          let gameStarted = false;

          conn.on('data', (raw) => {
            const msg = _parseAny(raw);
            if (!msg) return;

            if (!gameStarted && msg.type === 'start') {
              gameStarted = true;
              console.log('[P2PSync guest] received start packet, seed:', msg.seed);
              conn.on('close', () => this._emit('disconnect', {}));
              done(null, { seed: msg.seed, teams: msg.teams, roomId: roomCode, myTeamIndex: 1, playerId: 'guest' });
              return;
            }

            if (gameStarted) {
              this._emit('remote_action', { playerId: 'remote', data: msg });
            }
          });
        });
      });
    });
  }

  send(msg) {
    if (msg.type !== 'action') return;
    if (this._conn?.open) {
      this._conn.send(JSON.stringify(msg.data));
    }
  }

  disconnect() {
    try { this._conn?.close(); } catch {}
    try { this._peer?.destroy(); } catch {}
    this._conn = null;
    this._peer = null;
  }
}
