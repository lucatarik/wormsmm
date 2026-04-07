/**
 * FirebaseSync — Real-time multiplayer sync via Firebase Realtime Database.
 *
 * Firebase RTDB uses WebSocket under the hood → true push, no polling.
 * The client config below is intentionally public (Firebase's design);
 * security is enforced via RTDB Security Rules on the Firebase console.
 *
 * RTDB Rules required (set in Firebase Console → Realtime Database → Rules):
 *   { "rules": { "rooms": { "$r": { ".read": true, ".write": true } } } }
 */

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getDatabase, ref, set, push, onValue, onChildAdded, remove,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';

// ── Firebase project config (public client key — see note above) ─────────────
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyAJEjaruW135ECpr4tQE441fKxOSKiGDIw',
  authDomain:        'progettomlx.firebaseapp.com',
  databaseURL:       'https://progettomlx-default-rtdb.europe-west1.firebasedatabase.app',
  projectId:         'progettomlx',
  storageBucket:     'progettomlx.firebasestorage.app',
  messagingSenderId: '857416814607',
  appId:             '1:857416814607:web:7f3e81dc715f66a7eb937a',
};

// Singleton Firebase app + DB (safe across hot-reloads)
const _existingApp = getApps().find(a => a.name === 'worms-game');
const _firebaseApp = _existingApp || initializeApp(FIREBASE_CONFIG, 'worms-game');
const _db = getDatabase(_firebaseApp);

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// ── Main class ────────────────────────────────────────────────────────────────
export class FirebaseSync {

  static generateRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.random() * chars.length | 0]).join('');
  }

  constructor() {
    this._handlers  = {};
    this._unsubs    = [];   // cleanup callbacks returned by onValue/onChildAdded
    this._roomCode  = null;
    this._myRole    = null; // 'host' | 'guest'
    this._sessionId = null; // tags messages so stale ones from prior games are ignored
    this.roomId     = null;
    this.myTeamIndex = null;
  }

  on(event, fn)    { this._handlers[event] = fn; }
  _emit(event, d)  { this._handlers[event]?.(d); }

  // ── HOST: create room, wait for guest ────────────────────────────────────

  createRoom(playerName, presetRoomId) {
    return new Promise(async (resolve, reject) => {
      const code = (presetRoomId || FirebaseSync.generateRoomId()).toUpperCase();
      this._roomCode   = code;
      this._myRole     = 'host';
      this.roomId      = code;
      this.myTeamIndex = 0;

      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(val);
      };
      const timer = setTimeout(() => done(new Error('Timeout: no guest joined within 60 s')), 60000);

      try {
        // Clean up any leftover data from a previous session with same code
        await remove(ref(_db, `rooms/${code}`));

        // Announce ourselves as host
        await set(ref(_db, `rooms/${code}/host`), { name: playerName, t: Date.now() });

        // Watch for guest appearance
        const unsub = onValue(ref(_db, `rooms/${code}/guest`), async snap => {
          if (!snap.exists()) return;
          unsub();

          const guest    = snap.val();
          const seed     = (Math.random() * 0xffffffff) >>> 0;
          const session  = Date.now().toString(36);
          const teams    = createTeams(playerName, guest.name || 'Player 2');

          this._sessionId = session;

          await set(ref(_db, `rooms/${code}/start`), { seed, teams, session });
          this._listenMsgs(code, 'host', session);

          done(null, { seed, teams, roomId: code, myTeamIndex: 0, playerId: 'host' });
        });
        this._unsubs.push(unsub);
      } catch (e) { done(e); }
    });
  }

  // ── GUEST: join existing room ────────────────────────────────────────────

  joinRoom(roomId, playerName) {
    return new Promise(async (resolve, reject) => {
      const code = roomId.toUpperCase().trim();
      this._roomCode   = code;
      this._myRole     = 'guest';
      this.roomId      = code;
      this.myTeamIndex = 1;

      let settled = false;
      const done = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(val);
      };
      const timer = setTimeout(() => done(new Error('Timeout: host did not respond within 60 s')), 60000);

      try {
        // Announce ourselves as guest (triggers host's onValue listener)
        await set(ref(_db, `rooms/${code}/guest`), { name: playerName, t: Date.now() });

        // Wait for start packet written by host
        const unsub = onValue(ref(_db, `rooms/${code}/start`), snap => {
          if (!snap.exists()) return;
          unsub();

          const { seed, teams, session } = snap.val();
          this._sessionId = session;
          this._listenMsgs(code, 'guest', session);

          done(null, { seed, teams, roomId: code, myTeamIndex: 1, playerId: 'guest' });
        });
        this._unsubs.push(unsub);
      } catch (e) { done(e); }
    });
  }

  // ── Incoming message listener (opponent → me) ─────────────────────────────

  _listenMsgs(code, myRole, session) {
    const otherRole = myRole === 'host' ? 'guest' : 'host';
    const r = ref(_db, `rooms/${code}/msgs/${otherRole}`);

    // onChildAdded fires for ALL existing children first, then new ones.
    // We use session tags to ignore any messages from a prior game session.
    const unsub = onChildAdded(r, snap => {
      const msg = snap.val();
      if (!msg || msg._s !== session) return;
      const { _s, ...data } = msg;          // strip internal tag
      this._emit('remote_action', { playerId: 'remote', data });
    });
    this._unsubs.push(unsub);
  }

  // ── Send game action to opponent ──────────────────────────────────────────

  send(msg) {
    if (msg.type !== 'action' || !this._roomCode || !this._sessionId) return;
    const r = ref(_db, `rooms/${this._roomCode}/msgs/${this._myRole}`);
    push(r, { ...msg.data, _s: this._sessionId }).catch(() => {});
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  disconnect() {
    for (const u of this._unsubs) { try { u(); } catch {} }
    this._unsubs = [];
    if (this._roomCode) {
      remove(ref(_db, `rooms/${this._roomCode}`)).catch(() => {});
    }
  }
}
