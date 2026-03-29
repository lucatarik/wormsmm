/**
 * P2PSync — WebRTC P2P data channel with Upstash Redis signaling.
 *
 * Flow:
 *   HOST  → creates RTCPeerConnection, stores SDP offer in Redis,
 *           polls for answer, then P2P data channel opens.
 *   GUEST → reads SDP offer, creates answer, stores in Redis,
 *           P2P data channel opens.
 *
 * Once connected, all game messages flow directly P2P (< 20 ms latency).
 * No WebSocket server required. Works on GitHub Pages.
 *
 * Fallback: if WebRTC fails, falls back to Upstash Redis polling (80 ms).
 */

// ─────────────────────────────────────────────
// Upstash config
// ─────────────────────────────────────────────
const UPSTASH_URL   = 'https://helped-teal-58323.upstash.io';
const UPSTASH_TOKEN = 'AePTAAIncDJjOGRmNmRhNTk5MDg0YTE4ODEwMzBlZWRmNDQ1ZDE3OXAyNTgzMjM';
const TTL = 600; // 10 min – rooms expire quickly, we only need signaling

const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

// ─────────────────────────────────────────────
// Upstash helpers
// ─────────────────────────────────────────────
async function redis(cmd) {
  const r = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result ?? null;
}

const rGet  = async (k)      => { const v = await redis(['GET', k]);           return v ? JSON.parse(v) : null; };
const rSet  = async (k, v)   => redis(['SET', k, JSON.stringify(v), 'EX', TTL]);
const rPush = async (k, v)   => { await redis(['RPUSH', k, JSON.stringify(v)]); await redis(['EXPIRE', k, TTL]); };
const rPop  = async (k)      => { const v = await redis(['LPOP', k]);           return v ? JSON.parse(v) : null; };

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function uid()    { return Math.random().toString(36).slice(2, 10); }
function roomId6(){ const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({length:6},()=>c[Math.random()*c.length|0]).join(''); }
function teams(h, g='Player 2'){
  return [
    { id:'team-0', name:h, color:0xff4444, worms:[{id:'w0-0',name:'Walker'},{id:'w0-1',name:'Runner'}] },
    { id:'team-1', name:g, color:0x4488ff, worms:[{id:'w1-0',name:'Jumper'},{id:'w1-1',name:'Blaster'}] },
  ];
}

// ─────────────────────────────────────────────
export class P2PSync {
  static generateRoomId() { return roomId6(); }

  constructor() {
    this.playerId    = uid();
    this.roomId      = null;
    this.myTeamIndex = null;
    this._handlers   = {};
    this._pc         = null;
    this._dc         = null;
    this._pollTimer  = null;
    this._p2p        = false; // true once WebRTC data channel open
  }

  on(type, fn)       { this._handlers[type] = fn; }
  _emit(type, data)  { this._handlers[type]?.(data); }

  // ─────────────────────────────────────────────────
  // Public send (compatible with GameScene wsClient)
  // ─────────────────────────────────────────────────
  send(msg) {
    if (msg.type !== 'action') return;
    const payload = JSON.stringify(msg.data);
    if (this._p2p && this._dc?.readyState === 'open') {
      this._dc.send(payload);
    } else if (this.roomId !== null) {
      // Fallback: Redis queue
      rPush(`room:${this.roomId}:q:${this.myTeamIndex}`, msg.data).catch(()=>{});
    }
  }

  disconnect() {
    this._stopPoll();
    try { this._dc?.close(); } catch {}
    try { this._pc?.close(); } catch {}
  }

  // ─────────────────────────────────────────────────
  // HOST
  // ─────────────────────────────────────────────────
  async createRoom(playerName, presetRoomId) {
    const roomId = presetRoomId || roomId6();
    const seed   = Math.random() * 0xffffffff >>> 0;
    const t      = teams(playerName);

    this.roomId      = roomId;
    this.myTeamIndex = 0;

    await rSet(`room:${roomId}:info`, { seed, teams: t, createdAt: Date.now() });

    // ── Try WebRTC ────────────────────────────
    try {
      const result = await this._hostWebRTC(roomId, seed, t, playerName);
      return result;
    } catch (e) {
      console.warn('[P2P] WebRTC failed, falling back to Redis polling:', e.message);
      return this._hostFallback(roomId, seed, t);
    }
  }

  async _hostWebRTC(roomId, seed, t, playerName) {
    this._pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });

    // Create data channel
    this._dc = this._pc.createDataChannel('game', { ordered: true });
    this._setupDC();

    // Gather all ICE then publish offer
    const offer = await this._pc.createOffer();
    await this._pc.setLocalDescription(offer);
    await this._waitIceGathering();

    await rSet(`room:${roomId}:offer`, {
      sdp: this._pc.localDescription,
    });

    // Poll for answer
    const answer = await this._pollRedis(`room:${roomId}:answer`, 120000, 600);

    await this._pc.setRemoteDescription(new RTCSessionDescription(answer.sdp));

    // Wait for DC to open
    await this._waitDCOpen(15000);

    // Now update team guest name if available
    const guestInfo = await rGet(`room:${roomId}:guest`);
    if (guestInfo) t[1].name = guestInfo.playerName;

    return { roomId, seed, playerId: this.playerId, myTeamIndex: 0, teams: t };
  }

  async _hostFallback(roomId, seed, t) {
    // Wait for guest to join via Redis
    const guestInfo = await this._pollRedis(`room:${roomId}:guest`, 120000, 600);
    t[1].name = guestInfo.playerName;
    await rSet(`room:${roomId}:start`, { seed, teams: t });
    this._startPoll(roomId, 0);
    return { roomId, seed, playerId: this.playerId, myTeamIndex: 0, teams: t };
  }

  // ─────────────────────────────────────────────────
  // GUEST
  // ─────────────────────────────────────────────────
  async joinRoom(roomId, playerName) {
    roomId = roomId.toUpperCase().trim();
    const info = await rGet(`room:${roomId}:info`);
    if (!info) throw new Error('Room not found');

    this.roomId      = roomId;
    this.myTeamIndex = 1;

    const t    = info.teams;
    t[1].name  = playerName;

    // Register as guest
    await rSet(`room:${roomId}:guest`, { playerName, playerId: this.playerId });

    // ── Try WebRTC ────────────────────────────
    const offer = await rGet(`room:${roomId}:offer`);
    if (offer) {
      try {
        return await this._guestWebRTC(roomId, info.seed, t, offer);
      } catch (e) {
        console.warn('[P2P] WebRTC failed, falling back to Redis polling:', e.message);
      }
    }

    return this._guestFallback(roomId, info.seed, t);
  }

  async _guestWebRTC(roomId, seed, t, offer) {
    this._pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });

    this._pc.ondatachannel = (e) => {
      this._dc = e.channel;
      this._setupDC();
    };

    await this._pc.setRemoteDescription(new RTCSessionDescription(offer.sdp));

    const answer = await this._pc.createAnswer();
    await this._pc.setLocalDescription(answer);
    await this._waitIceGathering();

    await rSet(`room:${roomId}:answer`, { sdp: this._pc.localDescription });

    // Wait for DC
    await this._waitDCOpen(15000);

    return { roomId, seed, playerId: this.playerId, myTeamIndex: 1, teams: t };
  }

  async _guestFallback(roomId, seed, t) {
    await rSet(`room:${roomId}:start`, { seed, teams: t });
    this._startPoll(roomId, 1);
    return { roomId, seed, playerId: this.playerId, myTeamIndex: 1, teams: t };
  }

  // ─────────────────────────────────────────────────
  // WebRTC helpers
  // ─────────────────────────────────────────────────
  _setupDC() {
    this._dc.onopen = () => {
      this._p2p = true;
      this._stopPoll(); // no longer need Redis polling
      console.log('[P2P] Data channel open — using WebRTC');
    };

    this._dc.onmessage = ({ data }) => {
      try {
        const action = JSON.parse(data);
        this._emit('remote_action', { type: 'remote_action', playerId: 'opponent', data: action });
      } catch {}
    };

    this._dc.onclose   = () => { this._p2p = false; this._emit('disconnect', {}); };
    this._dc.onerror   = () => { this._p2p = false; };
  }

  _waitIceGathering() {
    return new Promise(resolve => {
      if (this._pc.iceGatheringState === 'complete') { resolve(); return; }
      const done = () => { if (this._pc.iceGatheringState === 'complete') { this._pc.onicegatheringstatechange = null; resolve(); } };
      this._pc.onicegatheringstatechange = done;
      setTimeout(resolve, 4000); // max wait
    });
  }

  _waitDCOpen(timeout = 10000) {
    return new Promise((resolve, reject) => {
      if (this._dc?.readyState === 'open') { this._p2p = true; resolve(); return; }
      const t = setTimeout(() => reject(new Error('DC open timeout')), timeout);
      const check = setInterval(() => {
        if (this._dc?.readyState === 'open') {
          clearInterval(check); clearTimeout(t);
          this._p2p = true; resolve();
        }
      }, 100);
    });
  }

  // ─────────────────────────────────────────────────
  // Redis fallback polling
  // ─────────────────────────────────────────────────
  _startPoll(roomId, myTeamIndex) {
    const opponentIdx = 1 - myTeamIndex;
    const key = `room:${roomId}:q:${opponentIdx}`;
    this._pollTimer = setInterval(async () => {
      try {
        const msg = await rPop(key);
        if (msg) this._emit('remote_action', { type: 'remote_action', playerId: 'opponent', data: msg });
      } catch {}
    }, 80);
  }

  _stopPoll() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  // ─────────────────────────────────────────────────
  // Generic Redis polling helper (for signaling)
  // ─────────────────────────────────────────────────
  _pollRedis(key, timeout, intervalMs) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeout;
      const iv = setInterval(async () => {
        if (Date.now() > deadline) { clearInterval(iv); reject(new Error('Timeout')); return; }
        try {
          const v = await rGet(key);
          if (v) { clearInterval(iv); resolve(v); }
        } catch {}
      }, intervalMs);
    });
  }
}
