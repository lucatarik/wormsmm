import { WSClient } from '../network/WSClient.js';

const DEFAULT_SERVER_URL = 'wss://worms-server.onrender.com';
const LS_SERVER_URL_KEY = 'worms_server_url';
const LS_PLAYER_NAME_KEY = 'worms_player_name';

/**
 * MenuScene - Main menu with room creation/joining and connection status.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
    this.wsClient = null;
    this.statusText = null;
    this.connectStatus = 'disconnected';
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this._drawBackground();
    this._drawTitle(W, H);
    this._createUI(W, H);
    this._setupInputs();
  }

  _drawBackground() {
    const W = this.scale.width;
    const H = this.scale.height;

    // Sky gradient layers
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x16213e, 0x16213e, 1);
    sky.fillRect(0, 0, W, H);

    // Stars
    const starGfx = this.add.graphics();
    starGfx.fillStyle(0xffffff, 1);
    const starRng = Math.random;
    for (let i = 0; i < 80; i++) {
      const x = Math.floor(starRng() * W);
      const y = Math.floor(starRng() * (H * 0.7));
      const size = starRng() < 0.85 ? 1 : 2;
      starGfx.fillRect(x, y, size, size);
    }

    // Ground silhouette
    const ground = this.add.graphics();
    ground.fillStyle(0x0d1b2a, 1);
    ground.fillRect(0, H * 0.78, W, H * 0.22);

    // Hill silhouettes
    ground.fillStyle(0x0a1520, 1);
    ground.fillEllipse(W * 0.15, H * 0.80, 280, 100);
    ground.fillEllipse(W * 0.55, H * 0.82, 350, 90);
    ground.fillEllipse(W * 0.85, H * 0.79, 260, 110);
  }

  _drawTitle(W, H) {
    // Shadow
    this.add.text(W / 2 + 3, H * 0.14 + 3, 'WORMS ONLINE', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '44px',
      color: '#000000',
      alpha: 0.5,
    }).setOrigin(0.5);

    // Main title
    this.add.text(W / 2, H * 0.14, 'WORMS ONLINE', {
      fontFamily: 'Arial Black, Arial',
      fontSize: '44px',
      color: '#e8c86d',
      stroke: '#8B5E3C',
      strokeThickness: 4,
    }).setOrigin(0.5);

    // Subtitle
    this.add.text(W / 2, H * 0.24, 'MULTIPLAYER ARTILLERY MAYHEM', {
      fontFamily: 'Arial',
      fontSize: '14px',
      color: '#88aacc',
      letterSpacing: 4,
    }).setOrigin(0.5);
  }

  _createUI(W, H) {
    const panelX = W / 2;
    const panelY = H * 0.52;
    const panelW = 420;
    const panelH = 290;

    // Panel background
    const panel = this.add.graphics();
    panel.fillStyle(0x0d1b2a, 0.85);
    panel.lineStyle(2, 0x334466, 1);
    panel.fillRoundedRect(panelX - panelW / 2, panelY - panelH / 2, panelW, panelH, 12);
    panel.strokeRoundedRect(panelX - panelW / 2, panelY - panelH / 2, panelW, panelH, 12);

    const topY = panelY - panelH / 2 + 24;
    const fieldW = 340;
    const labelStyle = { fontFamily: 'Arial', fontSize: '12px', color: '#88aacc' };
    const valueStyle = { fontFamily: 'Arial', fontSize: '15px', color: '#ffffff' };

    // Player Name field
    this.add.text(panelX - fieldW / 2, topY, 'PLAYER NAME', labelStyle);
    this._nameInput = this._createInputField(panelX, topY + 18, fieldW, 30, 'YourName');

    // Room ID field
    this.add.text(panelX - fieldW / 2, topY + 64, 'ROOM ID', labelStyle);
    this._roomInput = this._createInputField(panelX, topY + 82, fieldW, 30, 'ABC123');

    // Server URL field
    this.add.text(panelX - fieldW / 2, topY + 128, 'SERVER URL', labelStyle);
    this._serverInput = this._createInputField(
      panelX,
      topY + 146,
      fieldW,
      30,
      localStorage.getItem(LS_SERVER_URL_KEY) || DEFAULT_SERVER_URL
    );

    // Buttons
    const btnY = topY + 200;
    this._createButton = this._makeButton(panelX - 95, btnY, 160, 36, 'CREATE ROOM', 0x228833, () => this._onCreateRoom());
    this._joinButton = this._makeButton(panelX + 95, btnY, 160, 36, 'JOIN ROOM', 0x225588, () => this._onJoinRoom());

    // Status text
    this.statusText = this.add.text(W / 2, H * 0.88, 'Single-player mode available offline', {
      fontFamily: 'Arial',
      fontSize: '12px',
      color: '#667788',
    }).setOrigin(0.5);

    // Version + controls hint
    this.add.text(W / 2, H * 0.94, 'v1.0  |  Arrows: move  |  W/S: aim  |  Space: fire  |  1/2/3: weapon', {
      fontFamily: 'Arial',
      fontSize: '11px',
      color: '#445566',
    }).setOrigin(0.5);
  }

  /**
   * Create a DOM-based input field overlay on the canvas.
   * @param {number} cx - Center X
   * @param {number} cy - Center Y
   * @param {number} w - Width
   * @param {number} h - Height
   * @param {string} placeholder
   * @returns {object} { element, getValue }
   */
  _createInputField(cx, cy, w, h, placeholder) {
    // Draw background box
    const bg = this.add.graphics();
    bg.fillStyle(0x0a1020, 1);
    bg.lineStyle(1, 0x334466, 1);
    bg.fillRoundedRect(cx - w / 2, cy, w, h, 6);
    bg.strokeRoundedRect(cx - w / 2, cy, w, h, 6);

    // We use a DOM input element
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.value = placeholder;

    // Get canvas position in page
    const canvas = this.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / this.scale.width;
    const scaleY = rect.height / this.scale.height;

    Object.assign(input.style, {
      position: 'fixed',
      left: (rect.left + (cx - w / 2) * scaleX) + 'px',
      top: (rect.top + cy * scaleY) + 'px',
      width: (w * scaleX) + 'px',
      height: (h * scaleY) + 'px',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: '#ffffff',
      fontFamily: 'Arial',
      fontSize: (14 * scaleY) + 'px',
      padding: '4px 10px',
      boxSizing: 'border-box',
      zIndex: '100',
    });

    document.body.appendChild(input);
    this._domInputs = this._domInputs || [];
    this._domInputs.push(input);

    // Reposition on resize
    this.scale.on('resize', () => {
      const r = canvas.getBoundingClientRect();
      const sx = r.width / this.scale.width;
      const sy = r.height / this.scale.height;
      input.style.left = (r.left + (cx - w / 2) * sx) + 'px';
      input.style.top = (r.top + cy * sy) + 'px';
      input.style.width = (w * sx) + 'px';
      input.style.height = (h * sy) + 'px';
      input.style.fontSize = (14 * sy) + 'px';
    });

    return input;
  }

  /**
   * Create an interactive button.
   */
  _makeButton(cx, cy, w, h, label, color, callback) {
    const bg = this.add.graphics();

    const drawBtn = (hover) => {
      bg.clear();
      bg.fillStyle(hover ? color + 0x222222 : color, 1);
      bg.lineStyle(2, 0xffffff, 0.3);
      bg.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
      if (hover) bg.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 8);
    };

    drawBtn(false);

    const text = this.add.text(cx, cy, label, {
      fontFamily: 'Arial Black, Arial',
      fontSize: '13px',
      color: '#ffffff',
    }).setOrigin(0.5);

    const zone = this.add.zone(cx, cy, w, h).setInteractive({ cursor: 'pointer' });
    zone.on('pointerover', () => drawBtn(true));
    zone.on('pointerout', () => drawBtn(false));
    zone.on('pointerdown', callback);

    return { bg, text, zone };
  }

  _setupInputs() {
    // Pre-fill saved player name
    const savedName = localStorage.getItem(LS_PLAYER_NAME_KEY);
    if (savedName && this._nameInput) {
      this._nameInput.value = savedName;
    }
  }

  _getInputValue(input, fallback = '') {
    if (!input) return fallback;
    const val = input.value.trim();
    return val || fallback;
  }

  async _onCreateRoom() {
    const playerName = this._getInputValue(this._nameInput, 'Player1');
    const serverUrl = this._getInputValue(this._serverInput, DEFAULT_SERVER_URL);

    localStorage.setItem(LS_PLAYER_NAME_KEY, playerName);
    localStorage.setItem(LS_SERVER_URL_KEY, serverUrl);

    this._setStatus('Connecting to server...', '#ffaa00');

    try {
      const ws = new WSClient(serverUrl);
      await ws.connect();
      this.wsClient = ws;
      this._setStatus('Connected! Creating room...', '#44ff44');

      ws.send({ type: 'create_room', playerName });

      ws.on('room_created', (msg) => {
        this._setStatus(`Room created: ${msg.roomId}`, '#44ff44');
        if (this._roomInput) this._roomInput.value = msg.roomId;
        this._waitForGameStart(ws, msg);
      });

      ws.on('error_msg', (msg) => {
        this._setStatus('Error: ' + msg.message, '#ff4444');
      });

      ws.on('disconnect', () => {
        this._setStatus('Disconnected from server', '#ff4444');
      });

    } catch (err) {
      console.warn('Connection failed, starting single-player:', err);
      this._setStatus('Server unavailable - starting single-player mode', '#ffaa00');
      setTimeout(() => this._startSinglePlayer(), 1500);
    }
  }

  async _onJoinRoom() {
    const playerName = this._getInputValue(this._nameInput, 'Player2');
    const roomId = this._getInputValue(this._roomInput, '').toUpperCase();
    const serverUrl = this._getInputValue(this._serverInput, DEFAULT_SERVER_URL);

    if (!roomId) {
      this._setStatus('Please enter a Room ID', '#ff4444');
      return;
    }

    localStorage.setItem(LS_PLAYER_NAME_KEY, playerName);
    localStorage.setItem(LS_SERVER_URL_KEY, serverUrl);

    this._setStatus('Connecting...', '#ffaa00');

    try {
      const ws = new WSClient(serverUrl);
      await ws.connect();
      this.wsClient = ws;
      this._setStatus('Connected! Joining room ' + roomId + '...', '#44ff44');

      ws.send({ type: 'join_room', roomId, playerName });

      ws.on('game_start', (msg) => {
        this._launchGame(ws, msg);
      });

      ws.on('error_msg', (msg) => {
        this._setStatus('Error: ' + msg.message, '#ff4444');
      });

      ws.on('disconnect', () => {
        this._setStatus('Disconnected from server', '#ff4444');
      });

    } catch (err) {
      console.warn('Connection failed:', err);
      this._setStatus('Could not connect to server', '#ff4444');
      setTimeout(() => this._startSinglePlayer(), 1500);
    }
  }

  _waitForGameStart(ws, roomCreatedMsg) {
    this._setStatus(`Room ${roomCreatedMsg.roomId} created - waiting for opponent...`, '#44ff44');
    ws.on('game_start', (msg) => {
      this._launchGame(ws, msg);
    });
  }

  _launchGame(ws, gameStartMsg) {
    this._setStatus('Game starting!', '#44ff44');
    this._cleanupDomInputs();

    const data = {
      seed: gameStartMsg.seed,
      playerId: gameStartMsg.playerId,
      playerName: gameStartMsg.playerName || this._getInputValue(this._nameInput, 'Player'),
      teams: gameStartMsg.teams,
      myTeamIndex: gameStartMsg.myTeamIndex,
      wsClient: ws,
    };

    this.scene.stop('MenuScene');
    this.scene.start('GameScene', data);
    this.scene.launch('UIScene', data);
  }

  _startSinglePlayer() {
    this._cleanupDomInputs();
    const playerName = this._getInputValue(this._nameInput, 'Player');
    const seed = Math.floor(Math.random() * 0xffffff);

    const data = {
      seed,
      playerId: 'local-player',
      playerName,
      teams: [
        {
          id: 'team-0',
          name: playerName,
          color: 0xff4444,
          worms: [
            { id: 'w0-0', name: 'Walker' },
            { id: 'w0-1', name: 'Runner' },
          ],
        },
        {
          id: 'team-1',
          name: 'CPU',
          color: 0x4488ff,
          worms: [
            { id: 'w1-0', name: 'Jumper' },
            { id: 'w1-1', name: 'Blaster' },
          ],
        },
      ],
      myTeamIndex: 0,
      wsClient: null,
      singlePlayer: true,
    };

    this.scene.stop('MenuScene');
    this.scene.start('GameScene', data);
    this.scene.launch('UIScene', data);
  }

  _setStatus(message, color = '#ffffff') {
    if (this.statusText) {
      this.statusText.setText(message);
      this.statusText.setStyle({ color });
    }
  }

  _cleanupDomInputs() {
    if (this._domInputs) {
      for (const el of this._domInputs) {
        if (el.parentNode) el.parentNode.removeChild(el);
      }
      this._domInputs = [];
    }
  }

  shutdown() {
    this._cleanupDomInputs();
  }
}
