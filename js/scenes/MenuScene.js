import { RedisSync } from '../network/RedisSync.js';

const LS_PLAYER_NAME_KEY = 'worms_player_name';

/**
 * MenuScene — Main menu. Multiplayer via Upstash Redis (no server needed).
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
    this._domInputs = [];
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this._drawBackground(W, H);
    this._drawTitle(W, H);
    this._createUI(W, H);
    this._prefillSavedName();
  }

  // ─────────────────────────────────────────────
  // Background & Title
  // ─────────────────────────────────────────────

  _drawBackground(W, H) {
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x16213e, 0x16213e, 1);
    sky.fillRect(0, 0, W, H);

    const stars = this.add.graphics();
    stars.fillStyle(0xffffff, 1);
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(Math.random() * W);
      const y = Math.floor(Math.random() * H * 0.7);
      stars.fillRect(x, y, Math.random() < 0.85 ? 1 : 2, Math.random() < 0.85 ? 1 : 2);
    }

    const ground = this.add.graphics();
    ground.fillStyle(0x0d1b2a, 1);
    ground.fillRect(0, H * 0.78, W, H * 0.22);
    ground.fillStyle(0x0a1520, 1);
    ground.fillEllipse(W * 0.15, H * 0.80, 280, 100);
    ground.fillEllipse(W * 0.55, H * 0.82, 350, 90);
    ground.fillEllipse(W * 0.85, H * 0.79, 260, 110);
  }

  _drawTitle(W, H) {
    this.add.text(W / 2 + 3, H * 0.13 + 3, 'WORMS ONLINE', {
      fontFamily: 'Arial Black, Arial', fontSize: '44px', color: '#000000',
    }).setOrigin(0.5).setAlpha(0.4);

    this.add.text(W / 2, H * 0.13, 'WORMS ONLINE', {
      fontFamily: 'Arial Black, Arial', fontSize: '44px',
      color: '#e8c86d', stroke: '#8B5E3C', strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(W / 2, H * 0.225, 'MULTIPLAYER — NO SERVER NEEDED', {
      fontFamily: 'Arial', fontSize: '12px', color: '#88aacc',
    }).setOrigin(0.5);
  }

  // ─────────────────────────────────────────────
  // UI
  // ─────────────────────────────────────────────

  _createUI(W, H) {
    const panelX = W / 2;
    const panelY = H * 0.52;
    const panelW = 400;
    const panelH = 270;

    const panel = this.add.graphics();
    panel.fillStyle(0x0d1b2a, 0.88);
    panel.lineStyle(2, 0x334466, 1);
    panel.fillRoundedRect(panelX - panelW / 2, panelY - panelH / 2, panelW, panelH, 12);
    panel.strokeRoundedRect(panelX - panelW / 2, panelY - panelH / 2, panelW, panelH, 12);

    const top   = panelY - panelH / 2 + 22;
    const fW    = 330;
    const lbl   = { fontFamily: 'Arial', fontSize: '11px', color: '#88aacc' };

    // Player name
    this.add.text(panelX - fW / 2, top, 'YOUR NAME', lbl);
    this._nameInput = this._domInput(panelX, top + 18, fW, 30, 'Player1');

    // Room code
    this.add.text(panelX - fW / 2, top + 64, 'ROOM CODE  (to join)', lbl);
    this._roomInput = this._domInput(panelX, top + 82, fW, 30, '');

    // Buttons row
    const btnY = top + 148;
    this._makeBtn(panelX - 100, btnY, 168, 36, 'CREATE ROOM', 0x226633, () => this._onCreate());
    this._makeBtn(panelX + 100, btnY, 168, 36, 'JOIN ROOM',   0x224488, () => this._onJoin());

    // Single-player shortcut
    const spY = top + 196;
    this._makeBtn(panelX, spY, 180, 30, 'SINGLE PLAYER (offline)', 0x333344, () => this._singlePlayer());

    // Status text
    this._statusTxt = this.add.text(W / 2, H * 0.875, '', {
      fontFamily: 'Arial', fontSize: '13px', color: '#aabbcc',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);

    // Room-code display (shown after CREATE)
    this._roomCodeBanner = this.add.text(W / 2, H * 0.925, '', {
      fontFamily: 'Arial Black, Arial', fontSize: '20px',
      color: '#e8c86d', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);

    // Controls hint
    this.add.text(W / 2, H * 0.965, 'Arrows: move  |  W/S: aim  |  Space: fire  |  1/2/3: weapon', {
      fontFamily: 'Arial', fontSize: '10px', color: '#445566',
    }).setOrigin(0.5);
  }

  // ─────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────

  async _onCreate() {
    const playerName = this._val(this._nameInput, 'Player1');
    localStorage.setItem(LS_PLAYER_NAME_KEY, playerName);

    this._setStatus('Creating room…', '#ffcc44');
    const sync = new RedisSync();

    try {
      const gameData = await sync.createRoom(playerName, (roomId) => {
        this._setStatus(`Room created — share this code:`, '#44ff88');
        this._roomCodeBanner.setText(`🔑 ${roomId}`);
        if (this._roomInput) this._roomInput.value = roomId;
      });

      this._setStatus('Opponent joined! Starting…', '#44ff44');
      this._launch(sync, gameData);

    } catch (err) {
      this._setStatus('Error: ' + err.message, '#ff4444');
      sync.disconnect();
    }
  }

  async _onJoin() {
    const playerName = this._val(this._nameInput, 'Player2');
    const roomId     = this._val(this._roomInput, '').toUpperCase();

    if (!roomId || roomId.length !== 6) {
      this._setStatus('Enter a 6-character room code', '#ff4444');
      return;
    }

    localStorage.setItem(LS_PLAYER_NAME_KEY, playerName);
    this._setStatus(`Joining room ${roomId}…`, '#ffcc44');

    const sync = new RedisSync();
    try {
      const gameData = await sync.joinRoom(roomId, playerName);
      this._setStatus('Game starting!', '#44ff44');
      this._launch(sync, gameData);
    } catch (err) {
      this._setStatus('Error: ' + err.message, '#ff4444');
      sync.disconnect();
    }
  }

  _singlePlayer() {
    this._cleanupDom();
    const playerName = this._val(this._nameInput, 'Player');
    const seed = Math.floor(Math.random() * 0xffffffff);

    this.scene.stop('MenuScene');
    this.scene.start('GameScene', {
      seed,
      playerId:    'local',
      playerName,
      teams: [
        { id: 'team-0', name: playerName, color: 0xff4444,
          worms: [{ id: 'w0-0', name: 'Walker' }, { id: 'w0-1', name: 'Runner' }] },
        { id: 'team-1', name: 'CPU', color: 0x4488ff,
          worms: [{ id: 'w1-0', name: 'Jumper' }, { id: 'w1-1', name: 'Blaster' }] },
      ],
      myTeamIndex: 0,
      wsClient:    null,
      singlePlayer: true,
    });
    this.scene.launch('UIScene', { myTeamIndex: 0 });
  }

  _launch(sync, gameData) {
    this._cleanupDom();
    const data = {
      seed:        gameData.seed,
      roomId:      gameData.roomId,
      playerId:    gameData.playerId,
      playerName:  this._val(this._nameInput, 'Player'),
      teams:       gameData.teams,
      myTeamIndex: gameData.myTeamIndex,
      wsClient:    sync,
    };
    this.scene.stop('MenuScene');
    this.scene.start('GameScene', data);
    this.scene.launch('UIScene', { myTeamIndex: data.myTeamIndex, teams: data.teams });
  }

  // ─────────────────────────────────────────────
  // DOM helpers
  // ─────────────────────────────────────────────

  _domInput(cx, cy, w, h, placeholder) {
    const bg = this.add.graphics();
    bg.fillStyle(0x0a1020, 1);
    bg.lineStyle(1, 0x334466, 1);
    bg.fillRoundedRect(cx - w / 2, cy, w, h, 6);
    bg.strokeRoundedRect(cx - w / 2, cy, w, h, 6);

    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx = rect.width  / this.scale.width;
    const sy = rect.height / this.scale.height;

    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = placeholder;
    input.value       = placeholder;

    Object.assign(input.style, {
      position: 'fixed',
      left:     (rect.left + (cx - w / 2) * sx) + 'px',
      top:      (rect.top  + cy * sy) + 'px',
      width:    (w * sx) + 'px',
      height:   (h * sy) + 'px',
      background: 'transparent',
      border:   'none',
      outline:  'none',
      color:    '#ffffff',
      fontFamily: 'Arial',
      fontSize:   (14 * sy) + 'px',
      padding:  '4px 10px',
      boxSizing: 'border-box',
      zIndex:   '100',
    });

    document.body.appendChild(input);
    this._domInputs.push(input);

    this.scale.on('resize', () => {
      const r = canvas.getBoundingClientRect();
      const tx = r.width  / this.scale.width;
      const ty = r.height / this.scale.height;
      input.style.left   = (r.left + (cx - w / 2) * tx) + 'px';
      input.style.top    = (r.top  + cy * ty) + 'px';
      input.style.width  = (w * tx) + 'px';
      input.style.height = (h * ty) + 'px';
      input.style.fontSize = (14 * ty) + 'px';
    });

    return input;
  }

  _makeBtn(cx, cy, w, h, label, color, cb) {
    const bg = this.add.graphics();
    const draw = (hover) => {
      bg.clear();
      bg.fillStyle(hover ? Math.min(color + 0x111111, 0xffffff) : color, 1);
      bg.lineStyle(1, 0xffffff, 0.25);
      bg.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 7);
      if (hover) bg.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 7);
    };
    draw(false);
    this.add.text(cx, cy, label, {
      fontFamily: 'Arial Black, Arial', fontSize: '12px', color: '#ffffff',
    }).setOrigin(0.5);
    const zone = this.add.zone(cx, cy, w, h).setInteractive({ cursor: 'pointer' });
    zone.on('pointerover', () => draw(true));
    zone.on('pointerout',  () => draw(false));
    zone.on('pointerdown', cb);
  }

  _val(input, fallback = '') {
    return input?.value?.trim() || fallback;
  }

  _setStatus(msg, color = '#aabbcc') {
    if (this._statusTxt) {
      this._statusTxt.setText(msg).setStyle({ color });
    }
  }

  _prefillSavedName() {
    const saved = localStorage.getItem(LS_PLAYER_NAME_KEY);
    if (saved && this._nameInput) this._nameInput.value = saved;
  }

  _cleanupDom() {
    for (const el of this._domInputs) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    this._domInputs = [];
  }

  shutdown() {
    this._cleanupDom();
  }
}
