/**
 * RedisSync - Serverless multiplayer via Upstash Redis REST API.
 * No WebSocket server needed — works entirely from the browser on GitHub Pages.
 *
 * Protocol:
 *   room:{id}:info  → SET by host: { seed, teams, createdAt }
 *   room:{id}:guest → SET by guest: { playerName, playerId }
 *   room:{id}:start → SET by host once guest joins: { seed, teams }
 *   room:{id}:q:0   → RPUSH by team-0, LPOP by team-1
 *   room:{id}:q:1   → RPUSH by team-1, LPOP by team-0
 */

const UPSTASH_URL   = 'https://helped-teal-58323.upstash.io';
const UPSTASH_TOKEN = 'AePTAAIncDJjOGRmNmRhNTk5MDg0YTE4ODEwMzBlZWRmNDQ1ZDE3OXAyNTgzMjM';

const ROOM_TTL   = 3600;   // seconds
const POLL_MS    = 180;    // action polling interval
const JOIN_WAIT  = 120000; // max wait for opponent (ms)
const START_WAIT = 30000;  // max wait for game-start signal (ms)

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function roomId6() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function defaultTeams(hostName, guestName = 'Player 2') {
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

// ─────────────────────────────────────────────
// Upstash REST client
// ─────────────────────────────────────────────

async function redis(cmd) {
  const res = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
  });
  const json = await res.json();
  return json.result ?? null;
}

async function rGet(key) {
  const v = await redis(['GET', key]);
  return v ? JSON.parse(v) : null;
}

async function rSet(key, value, ttl = ROOM_TTL) {
  return redis(['SET', key, JSON.stringify(value), 'EX', ttl]);
}

async function rPush(key, value, ttl = ROOM_TTL) {
  await redis(['RPUSH', key, JSON.stringify(value)]);
  await redis(['EXPIRE', key, ttl]);
}

async function rPop(key) {
  const v = await redis(['LPOP', key]);
  return v ? JSON.parse(v) : null;
}

// ─────────────────────────────────────────────
// RedisSync class
// ─────────────────────────────────────────────

export class RedisSync {
  constructor() {
    this.playerId     = uid();
    this.roomId       = null;
    this.myTeamIndex  = null;
    this._handlers    = {};
    this._pollTimer   = null;
  }

  /** Register event handler. Events: 'remote_action', 'disconnect' */
  on(type, fn) {
    this._handlers[type] = fn;
  }

  _emit(type, payload) {
    if (this._handlers[type]) this._handlers[type](payload);
  }

  // ──────────────────────────────────────────
  // Send (compatible with WSClient interface)
  // ──────────────────────────────────────────

  /**
   * Send an action to the opponent.
   * msg format: { type: 'action', roomId, data } or { type: 'ping' }
   */
  send(msg) {
    if (msg.type !== 'action') return; // ignore pings etc.
    if (!this.roomId) return;
    rPush(`room:${this.roomId}:q:${this.myTeamIndex}`, msg.data).catch(() => {});
  }

  disconnect() {
    this._stopPolling();
  }

  // ──────────────────────────────────────────
  // Room Creation
  // ──────────────────────────────────────────

  /**
   * Create a new room as host (team 0).
   * Returns a Promise that resolves with game-start data once opponent joins.
   * Calls onRoomCreated(roomId) immediately so the UI can show the code.
   */
  createRoom(playerName, onRoomCreated) {
    return new Promise(async (resolve, reject) => {
      const roomId = roomId6();
      const seed   = Math.floor(Math.random() * 0xffffffff);
      const teams  = defaultTeams(playerName);

      this.roomId      = roomId;
      this.myTeamIndex = 0;

      // Write room info
      await rSet(`room:${roomId}:info`, { seed, teams, createdAt: Date.now() });

      if (onRoomCreated) onRoomCreated(roomId);

      // Poll for guest
      const deadline = Date.now() + JOIN_WAIT;
      const poll = setInterval(async () => {
        if (Date.now() > deadline) {
          clearInterval(poll);
          reject(new Error('Timeout: no opponent joined'));
          return;
        }
        try {
          const guest = await rGet(`room:${roomId}:guest`);
          if (!guest) return;

          clearInterval(poll);

          // Update team name with guest's name
          teams[1].name = guest.playerName;

          // Signal game start
          await rSet(`room:${roomId}:start`, { seed, teams }, 600);

          // Begin polling for actions
          this._startPolling(roomId, 0);

          resolve({
            roomId,
            seed,
            playerId:     this.playerId,
            myTeamIndex:  0,
            teams,
          });
        } catch (e) { /* retry */ }
      }, 600);
    });
  }

  // ──────────────────────────────────────────
  // Room Joining
  // ──────────────────────────────────────────

  /**
   * Join an existing room as guest (team 1).
   * Returns a Promise that resolves with game-start data.
   */
  async joinRoom(roomId, playerName) {
    roomId = roomId.toUpperCase().trim();

    const info = await rGet(`room:${roomId}:info`);
    if (!info) throw new Error('Room not found');

    this.roomId      = roomId;
    this.myTeamIndex = 1;

    // Register as guest
    await rSet(`room:${roomId}:guest`, { playerName, playerId: this.playerId }, 600);

    // Wait for host to signal game start
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + START_WAIT;
      const poll = setInterval(async () => {
        if (Date.now() > deadline) {
          clearInterval(poll);
          reject(new Error('Timeout: host did not start game'));
          return;
        }
        try {
          const start = await rGet(`room:${roomId}:start`);
          if (!start) return;

          clearInterval(poll);
          this._startPolling(roomId, 1);

          resolve({
            roomId,
            seed:         start.seed,
            playerId:     this.playerId,
            myTeamIndex:  1,
            teams:        start.teams,
          });
        } catch (e) { /* retry */ }
      }, 600);
    });
  }

  // ──────────────────────────────────────────
  // Action polling loop
  // ──────────────────────────────────────────

  _startPolling(roomId, myTeamIndex) {
    const opponentIdx = 1 - myTeamIndex;
    const qKey = `room:${roomId}:q:${opponentIdx}`;

    this._pollTimer = setInterval(async () => {
      try {
        const action = await rPop(qKey);
        if (action) {
          this._emit('remote_action', {
            type:     'remote_action',
            playerId: 'opponent',
            data:     action,
          });
        }
      } catch (e) { /* ignore transient errors */ }
    }, POLL_MS);
  }

  _stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }
}
