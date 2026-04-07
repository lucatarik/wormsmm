/**
 * P2PSync — WebRTC P2P via PeerJS.
 *
 * Signaling: custom Cloudflare Worker (see cloudflareworker.md).
 * Falls back to the free PeerJS cloud if CF_WORKER_HOST is not set.
 *
 * HOST: creates Peer with id = 'worms-ROOMCODE', waits for connection.
 * GUEST: creates anonymous Peer, connects to 'worms-ROOMCODE'.
 *
 * Public API (same shape as FirebaseSync):
 *   createRoom(playerName, presetRoomId?) → Promise<gameData>
 *   joinRoom(roomId, playerName)          → Promise<gameData>
 *   send(msg)                             → void  (msg.type must be 'action')
 *   on(event, fn)                         → void
 *   disconnect()                          → void
 */

// ── Signaling server config ───────────────────────────────────────────────────
// Set CF_WORKER_HOST to your deployed worker, e.g.
//   'worms-signaling.YOUR_SUBDOMAIN.workers.dev'
// Leave empty to fall back to the free PeerJS cloud.
const CF_WORKER_HOST = '';   // ← fill in after deploying the CF Worker

// TURN servers improve NAT traversal for players behind symmetric NAT.
// Open Relay Project provides free TURN servers.
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
  : { host: '0.peerjs.com',  port: 443, path: '/',       secure: true,                debug: 0, config: { iceServers: ICE_SERVERS } };

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.random() * chars.length | 0]).join('');
}

function createTeams(hostName, guestName = 'Player 2') {
  return [
    {
      id: 'team-0', name: hostName, color: 0xff4444,
      worms: [
        { id: 'w0-0', name: 'Walker' }, { id: 'w0-1', name: 'Runner' },
        { id: 'w0-2', name: 'Digger' }, { id: 'w0-3', name: 'Basher' },
      ],
    },
    {
      id: 'team-1', name: guestName, color: 0x4488ff,
      worms: [
        { id: 'w1-0', name: 'Jumper' }, { id: 'w1-1', name: 'Blaster' },
        { id: 'w1-2', name: 'Ninja'  }, { id: 'w1-3', name: 'Sniper'  },
      ],
    },
  ];
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

  /**
   * HOST — create a room and wait for a guest to join.
   * Returns Promise<gameData>
   */
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
      const timer = setTimeout(
        () => done(new Error('Timeout: no guest connected within 60 s')), 60000,
      );

      let peer;
      try { peer = new Peer(peerId, PEER_CONFIG); }
      catch (e) { done(e); return; }
      this._peer = peer;

      peer.on('error', done);

      peer.on('connection', (conn) => {
        this._conn = conn;
        conn.on('error', done);

        conn.on('open', () => {
          // Expect first message: { type:'hello', name }
          conn.once('data', (raw) => {
            const msg = _parse(raw);
            if (!msg || msg.type !== 'hello') {
              done(new Error('Unexpected first message from guest'));
              return;
            }

            const guestName = msg.name || 'Player 2';
            const seed      = (Math.random() * 0xffffffff) >>> 0;
            const teams     = createTeams(playerName, guestName);

            conn.send({ type: 'start', seed, teams });

            // Ongoing listener
            conn.on('data', (raw2) => {
              const action = _parse(raw2);
              if (action && action.type !== 'start' && action.type !== 'hello') {
                this._emit('remote_action', { playerId: 'remote', data: action });
              }
            });
            conn.on('close', () => this._emit('disconnect', {}));

            done(null, { seed, teams, roomId: roomCode, myTeamIndex: 0, playerId: 'host' });
          });
        });
      });
    });
  }

  /**
   * GUEST — join an existing room.
   * Returns Promise<gameData>
   */
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
      const timer = setTimeout(
        () => done(new Error('Timeout: could not connect to host within 60 s')), 60000,
      );

      let peer;
      try { peer = new Peer(PEER_CONFIG); }
      catch (e) { done(e); return; }
      this._peer = peer;

      peer.on('error', done);

      peer.on('open', () => {
        // Force JSON serialization — avoids msgpack binary encoding issues
        const conn = peer.connect(hostPeerId, { reliable: true, serialization: 'json' });
        this._conn = conn;
        conn.on('error', done);

        conn.on('open', () => {
          conn.send({ type: 'hello', name: playerName });

          conn.once('data', (raw) => {
            const msg = _parse(raw);
            if (!msg || msg.type !== 'start') {
              done(new Error('Unexpected first message from host'));
              return;
            }

            const { seed, teams } = msg;

            conn.on('data', (raw2) => {
              const action = _parse(raw2);
              if (action && action.type !== 'start' && action.type !== 'hello') {
                this._emit('remote_action', { playerId: 'remote', data: action });
              }
            });
            conn.on('close', () => this._emit('disconnect', {}));

            done(null, { seed, teams, roomId: roomCode, myTeamIndex: 1, playerId: 'guest' });
          });
        });
      });
    });
  }

  /**
   * Send a game action to the opponent.
   */
  send(msg) {
    if (msg.type !== 'action') return;
    if (this._conn?.open) {
      this._conn.send(msg.data);
    }
  }

  /** Tear down the peer connection. */
  disconnect() {
    try { this._conn?.close(); } catch {}
    try { this._peer?.destroy(); } catch {}
    this._conn = null;
    this._peer = null;
  }
}

function _parse(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch { return null; }
}
