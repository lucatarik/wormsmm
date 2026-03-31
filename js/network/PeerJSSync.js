/**
 * PeerJSSync — WebRTC P2P data channels via PeerJS.
 *
 * No Upstash, no Redis, no polling.
 * PeerJS free signaling server handles SDP exchange automatically.
 *
 * HOST:  creates Peer with ID = 'worms-ROOMCODE', waits for connection.
 * GUEST: creates anonymous Peer, connects to 'worms-ROOMCODE'.
 *
 * All game data flows through a reliable WebRTC data channel.
 */

const PEER_CONFIG = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
};

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.random() * chars.length | 0]).join('');
}

function createTeams(hostName, guestName = 'Player 2') {
  return [
    {
      id: 'team-0', name: hostName, color: 0xff4444,
      worms: [{ id: 'w0-0', name: 'Walker' }, { id: 'w0-1', name: 'Runner' }],
    },
    {
      id: 'team-1', name: guestName, color: 0x4488ff,
      worms: [{ id: 'w1-0', name: 'Jumper' }, { id: 'w1-1', name: 'Blaster' }],
    },
  ];
}

export class PeerJSSync {
  static generateRoomId() {
    return generateRoomId();
  }

  constructor() {
    this._handlers = {};
    this._peer = null;
    this._conn = null;
    this.roomId = null;
    this.myTeamIndex = null;
    this.playerId = null;
  }

  on(event, fn) {
    this._handlers[event] = fn;
  }

  _emit(event, data) {
    this._handlers[event]?.(data);
  }

  /**
   * Send a game action to the opponent.
   * Only sends messages of type 'action'.
   */
  send(msg) {
    if (msg.type !== 'action') return;
    if (this._conn && this._conn.open) {
      this._conn.send(msg.data);
    }
  }

  /**
   * HOST: create a room and wait for a guest to join.
   * Returns Promise<gameData>
   */
  createRoom(playerName, presetRoomId) {
    return new Promise((resolve, reject) => {
      const roomCode = (presetRoomId || generateRoomId()).toUpperCase();
      const peerId = 'worms-' + roomCode.toLowerCase();
      this.roomId = roomCode;
      this.myTeamIndex = 0;
      this.playerId = 'host';

      let settled = false;
      const finish = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (err) reject(err); else resolve(val);
      };

      const timeoutHandle = setTimeout(() => {
        finish(new Error('Timeout: no guest connected within 60 seconds'));
      }, 60000);

      let peer;
      try {
        peer = new Peer(peerId, PEER_CONFIG);
      } catch (e) {
        finish(e);
        return;
      }
      this._peer = peer;

      peer.on('error', (err) => {
        finish(err);
      });

      peer.on('open', () => {
        // Ready — waiting for guest
      });

      peer.on('connection', (conn) => {
        this._conn = conn;

        conn.on('error', (err) => {
          finish(err);
        });

        conn.on('open', () => {
          // Wait for first message: {type:'hello', name: guestName}
          conn.once('data', (raw) => {
            let msg;
            try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { msg = raw; }

            if (!msg || msg.type !== 'hello') {
              finish(new Error('Unexpected first message from guest'));
              return;
            }

            const guestName = msg.name || 'Player 2';
            const seed = Math.random() * 0xffffffff >>> 0;
            const teams = createTeams(playerName, guestName);

            // Send start packet to guest
            conn.send({ type: 'start', seed, teams, guestTeamIndex: 1 });

            // Set up ongoing data listener
            conn.on('data', (raw2) => {
              let action;
              try { action = typeof raw2 === 'string' ? JSON.parse(raw2) : raw2; } catch { return; }
              if (action && action.type !== 'start' && action.type !== 'hello') {
                this._emit('remote_action', { playerId: 'remote', data: action });
              }
            });

            conn.on('close', () => {
              this._emit('disconnect', {});
            });

            finish(null, {
              seed,
              teams,
              roomId: roomCode,
              myTeamIndex: 0,
              playerId: 'host',
            });
          });
        });
      });
    });
  }

  /**
   * GUEST: join an existing room by roomId.
   * Returns Promise<gameData>
   */
  joinRoom(roomId, playerName) {
    return new Promise((resolve, reject) => {
      const roomCode = roomId.toUpperCase().trim();
      const hostPeerId = 'worms-' + roomCode.toLowerCase();
      this.roomId = roomCode;
      this.myTeamIndex = 1;
      this.playerId = 'guest';

      let settled = false;
      const finish = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (err) reject(err); else resolve(val);
      };

      const timeoutHandle = setTimeout(() => {
        finish(new Error('Timeout: could not connect to host within 60 seconds'));
      }, 60000);

      let peer;
      try {
        peer = new Peer(PEER_CONFIG);
      } catch (e) {
        finish(e);
        return;
      }
      this._peer = peer;

      peer.on('error', (err) => {
        finish(err);
      });

      peer.on('open', () => {
        const conn = peer.connect(hostPeerId, { reliable: true });
        this._conn = conn;

        conn.on('error', (err) => {
          finish(err);
        });

        conn.on('open', () => {
          // Send hello with our name
          conn.send({ type: 'hello', name: playerName });

          // Wait for start packet
          conn.once('data', (raw) => {
            let msg;
            try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { msg = raw; }

            if (!msg || msg.type !== 'start') {
              finish(new Error('Unexpected first message from host'));
              return;
            }

            const { seed, teams } = msg;

            // Set up ongoing data listener
            conn.on('data', (raw2) => {
              let action;
              try { action = typeof raw2 === 'string' ? JSON.parse(raw2) : raw2; } catch { return; }
              if (action && action.type !== 'start' && action.type !== 'hello') {
                this._emit('remote_action', { playerId: 'remote', data: action });
              }
            });

            conn.on('close', () => {
              this._emit('disconnect', {});
            });

            finish(null, {
              seed,
              teams,
              roomId: roomCode,
              myTeamIndex: 1,
              playerId: 'guest',
            });
          });
        });
      });
    });
  }

  /**
   * Disconnect from the peer network.
   */
  disconnect() {
    try { this._conn?.close(); } catch {}
    try { this._peer?.destroy(); } catch {}
    this._conn = null;
    this._peer = null;
  }
}
