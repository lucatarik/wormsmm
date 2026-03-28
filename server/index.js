/**
 * Worms Online - WebSocket Game Server
 * Uses Upstash Redis REST API for persistent room state.
 * Deploys to Railway / Render / any Node.js host.
 */

import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';

// ─────────────────────────────────────────────────────────────────────────────
// Config from environment
// ─────────────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || 'https://helped-teal-58323.upstash.io';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || 'AePTAAIncDJjOGRmNmRhNTk5MDg0YTE4ODEwMzBlZWRmNDQ1ZDE3OXAyNTgzMjM';
const ROOM_TTL_SECONDS = 3600; // 1 hour

// ─────────────────────────────────────────────────────────────────────────────
// Redis Helpers (Upstash REST API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a Redis command via Upstash REST API.
 * @param {...string} args - Redis command and arguments
 * @returns {Promise<any>} Parsed response body
 */
async function redisCommand(...args) {
  const path = args.map(a => encodeURIComponent(String(a))).join('/');
  try {
    const response = await fetch(`${REDIS_URL}/${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Redis HTTP ${response.status}: ${text}`);
    }
    return response.json();
  } catch (err) {
    console.error('[Redis] Command failed:', args.join(' '), err.message);
    throw err;
  }
}

/**
 * POST version for commands that modify state (SET, HSET, DEL, EXPIRE).
 */
async function redisPost(...args) {
  try {
    const response = await fetch(`${REDIS_URL}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${REDIS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Redis HTTP ${response.status}: ${text}`);
    }
    return response.json();
  } catch (err) {
    console.error('[Redis] POST failed:', args.join(' '), err.message);
    throw err;
  }
}

/**
 * Get room data from Redis.
 * @param {string} roomId
 * @returns {Promise<object|null>}
 */
async function getRoom(roomId) {
  try {
    const result = await redisCommand('GET', `room:${roomId}`);
    if (!result?.result) return null;
    return JSON.parse(result.result);
  } catch {
    return null;
  }
}

/**
 * Save room data to Redis with TTL.
 * @param {string} roomId
 * @param {object} room
 */
async function setRoom(roomId, room) {
  try {
    await redisPost('SET', `room:${roomId}`, JSON.stringify(room), 'EX', ROOM_TTL_SECONDS);
  } catch (err) {
    console.error('[Redis] setRoom failed:', err.message);
  }
}

/**
 * Delete room from Redis.
 * @param {string} roomId
 */
async function deleteRoom(roomId) {
  try {
    await redisPost('DEL', `room:${roomId}`);
  } catch (err) {
    console.error('[Redis] deleteRoom failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Room ID Generation
// ─────────────────────────────────────────────────────────────────────────────

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function generateSeed() {
  return Math.floor(Math.random() * 0xffffffff);
}

// ─────────────────────────────────────────────────────────────────────────────
// Team Structure
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the default 2-team structure.
 * @param {string} hostName - Name of the host player
 * @param {string} guestName - Name of the guest player (can be placeholder)
 */
function buildTeams(hostName, guestName = 'Waiting...') {
  return [
    {
      id: 'team-0',
      name: hostName,
      color: 0xff4444,
      worms: [
        { id: 'w0-0', name: 'Walker' },
        { id: 'w0-1', name: 'Runner' },
      ],
    },
    {
      id: 'team-1',
      name: guestName,
      color: 0x4488ff,
      worms: [
        { id: 'w1-0', name: 'Jumper' },
        { id: 'w1-1', name: 'Blaster' },
      ],
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Server State (in-memory for fast relay)
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<WebSocket, {playerId: string, roomId: string|null, playerName: string}>} */
const clients = new Map();

/** @type {Map<string, Set<WebSocket>>} roomId → connected ws clients */
const roomSockets = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket Server
// ─────────────────────────────────────────────────────────────────────────────

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: roomSockets.size, clients: clients.size }));
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Worms Online Server\n');
  }
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const playerId = uuidv4();
  clients.set(ws, { playerId, roomId: null, playerName: 'Unknown' });

  console.log(`[WS] Client connected: ${playerId} from ${req.socket.remoteAddress}`);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendTo(ws, { type: 'error_msg', message: 'Invalid JSON' });
      return;
    }

    const clientInfo = clients.get(ws);
    if (!clientInfo) return;

    try {
      await handleMessage(ws, clientInfo, msg);
    } catch (err) {
      console.error('[WS] Handler error:', err);
      sendTo(ws, { type: 'error_msg', message: 'Server error' });
    }
  });

  ws.on('close', () => {
    const info = clients.get(ws);
    if (info?.roomId) {
      leaveRoom(ws, info.roomId);
    }
    clients.delete(ws);
    console.log(`[WS] Client disconnected: ${info?.playerId}`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Socket error:', err.message);
  });

  // Greet
  sendTo(ws, { type: 'connected', playerId });
});

// ─────────────────────────────────────────────────────────────────────────────
// Message Handlers
// ─────────────────────────────────────────────────────────────────────────────

async function handleMessage(ws, clientInfo, msg) {
  switch (msg.type) {

    case 'create_room': {
      const playerName = sanitize(msg.playerName) || 'Host';
      clientInfo.playerName = playerName;

      // Generate unique room ID
      let roomId = generateRoomId();
      let existing = await getRoom(roomId);
      let attempts = 0;
      while (existing && attempts < 10) {
        roomId = generateRoomId();
        existing = await getRoom(roomId);
        attempts++;
      }

      const seed = generateSeed();
      const teams = buildTeams(playerName);

      const room = {
        roomId,
        seed,
        hostId: clientInfo.playerId,
        state: 'waiting',
        players: [
          { playerId: clientInfo.playerId, playerName, teamIndex: 0 },
        ],
        teams,
        createdAt: Date.now(),
      };

      await setRoom(roomId, room);

      clientInfo.roomId = roomId;
      joinRoomSocket(ws, roomId);

      console.log(`[Room] Created: ${roomId} by ${playerName}`);

      sendTo(ws, {
        type: 'room_created',
        roomId,
        seed,
        playerId: clientInfo.playerId,
        playerName,
        teamIndex: 0,
        teams,
      });
      break;
    }

    case 'join_room': {
      const roomId = sanitize(msg.roomId)?.toUpperCase();
      const playerName = sanitize(msg.playerName) || 'Guest';

      if (!roomId || roomId.length !== 6) {
        sendTo(ws, { type: 'error_msg', message: 'Invalid room ID' });
        return;
      }

      const room = await getRoom(roomId);
      if (!room) {
        sendTo(ws, { type: 'error_msg', message: 'Room not found' });
        return;
      }
      if (room.state !== 'waiting') {
        sendTo(ws, { type: 'error_msg', message: 'Game already in progress' });
        return;
      }
      if (room.players.length >= 2) {
        sendTo(ws, { type: 'error_msg', message: 'Room is full' });
        return;
      }

      clientInfo.playerName = playerName;
      clientInfo.roomId = roomId;

      // Update team name
      room.teams[1].name = playerName;
      room.players.push({ playerId: clientInfo.playerId, playerName, teamIndex: 1 });
      room.state = 'playing';

      await setRoom(roomId, room);
      joinRoomSocket(ws, roomId);

      console.log(`[Room] ${playerName} joined ${roomId}`);

      // Notify all players in room
      const hostWs = getSocketByPlayerId(room.players[0].playerId);
      const guestWs = ws;

      // Build payload
      const basePayload = {
        type: 'game_start',
        roomId,
        seed: room.seed,
        teams: room.teams,
      };

      // Host gets myTeamIndex 0
      if (hostWs) {
        sendTo(hostWs, {
          ...basePayload,
          playerId: room.players[0].playerId,
          playerName: room.players[0].playerName,
          myTeamIndex: 0,
        });
      }

      // Guest gets myTeamIndex 1
      sendTo(guestWs, {
        ...basePayload,
        playerId: clientInfo.playerId,
        playerName,
        myTeamIndex: 1,
      });

      break;
    }

    case 'action': {
      const roomId = sanitize(msg.roomId);
      if (!roomId) return;

      // Relay to all OTHER clients in the room
      broadcastToRoom(roomId, ws, {
        type: 'remote_action',
        playerId: clientInfo.playerId,
        data: msg.data,
      });
      break;
    }

    case 'ping':
      sendTo(ws, { type: 'pong', timestamp: Date.now() });
      break;

    case 'leave_room': {
      if (clientInfo.roomId) {
        leaveRoom(ws, clientInfo.roomId);
        clientInfo.roomId = null;
      }
      break;
    }

    default:
      console.warn('[WS] Unknown message type:', msg.type);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Room Socket Management
// ─────────────────────────────────────────────────────────────────────────────

function joinRoomSocket(ws, roomId) {
  if (!roomSockets.has(roomId)) {
    roomSockets.set(roomId, new Set());
  }
  roomSockets.get(roomId).add(ws);
}

function leaveRoom(ws, roomId) {
  const sockets = roomSockets.get(roomId);
  if (sockets) {
    sockets.delete(ws);
    if (sockets.size === 0) {
      roomSockets.delete(roomId);
      // Clean up Redis room after delay
      setTimeout(() => deleteRoom(roomId), 5000);
    } else {
      // Notify remaining clients
      broadcastToRoom(roomId, ws, { type: 'player_left', playerId: clients.get(ws)?.playerId });
    }
  }
}

function getSocketByPlayerId(playerId) {
  for (const [ws, info] of clients) {
    if (info.playerId === playerId) return ws;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Messaging Utilities
// ─────────────────────────────────────────────────────────────────────────────

function sendTo(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error('[WS] Send failed:', err.message);
    }
  }
}

function broadcastToRoom(roomId, excludeWs, msg) {
  const sockets = roomSockets.get(roomId);
  if (!sockets) return;
  const payload = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws !== excludeWs && ws.readyState === ws.OPEN) {
      try {
        ws.send(payload);
      } catch (err) {
        console.error('[WS] Broadcast send failed:', err.message);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Input Sanitization
// ─────────────────────────────────────────────────────────────────────────────

function sanitize(str, maxLen = 64) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'&]/g, '').slice(0, maxLen).trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[Server] Worms Online WebSocket server running on port ${PORT}`);
  console.log(`[Server] Redis: ${REDIS_URL.replace(/\/\/.*@/, '//<credentials>@')}`);
  console.log(`[Server] Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, shutting down...');
  wss.close(() => {
    httpServer.close(() => process.exit(0));
  });
});

process.on('SIGINT', () => {
  console.log('[Server] SIGINT received, shutting down...');
  process.exit(0);
});
