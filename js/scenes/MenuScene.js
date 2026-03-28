import { RedisSync } from '../network/RedisSync.js';

const LS_NAME_KEY   = 'worms_player_name';
const BASE_URL      = 'https://lucatarik.github.io/wormsmm/';

/**
 * MenuScene — Main menu with room creation, copy-link sharing, and URL auto-join.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
    this._domEls  = [];   // all DOM elements to clean up
    this._overlay = null; // room-sharing overlay
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this._drawBackground(W, H);
    this._drawTitle(W, H);
    this._createUI(W, H);
    this._prefill();
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
      stars.fillRect(
        Math.floor(Math.random() * W),
        Math.floor(Math.random() * H * 0.7),
        Math.random() < 0.85 ? 1 : 2,
        1,
      );
    }

    const g = this.add.graphics();
    g.fillStyle(0x0d1b2a, 1);
    g.fillRect(0, H * 0.78, W, H * 0.22);
    g.fillStyle(0x0a1520, 1);
    g.fillEllipse(W * 0.15, H * 0.80, 280, 100);
    g.fillEllipse(W * 0.55, H * 0.82, 350, 90);
    g.fillEllipse(W * 0.85, H * 0.79, 260, 110);
  }

  _drawTitle(W, H) {
    this.add.text(W / 2 + 3, H * 0.13 + 3, 'WORMS ONLINE', {
      fontFamily: 'Arial Black, Arial', fontSize: '44px', color: '#000',
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

    const top = panelY - panelH / 2 + 22;
    const fW  = 330;
    const lbl = { fontFamily: 'Arial', fontSize: '11px', color: '#88aacc' };

    // Player name
    this.add.text(panelX - fW / 2, top, 'YOUR NAME', lbl);
    this._nameInput = this._input(panelX, top + 18, fW, 30, 'Player1');

    // Room code (to join)
    this.add.text(panelX - fW / 2, top + 64, 'ROOM CODE  (paste to join)', lbl);
    this._roomInput = this._input(panelX, top + 82, fW, 30, '');

    // Buttons
    const btnY = top + 148;
    this._btn(panelX - 100, btnY, 168, 36, 'CREATE ROOM', 0x1a6632, () => this._onCreate());
    this._btn(panelX + 100, btnY, 168, 36, 'JOIN ROOM',   0x163d6e, () => this._onJoin());

    // Single-player
    this._btn(panelX, top + 196, 200, 30, 'SINGLE PLAYER (offline)', 0x2a2a3a, () => this._solo());

    // Status
    this._statusTxt = this.add.text(W / 2, H * 0.885, '', {
      fontFamily: 'Arial', fontSize: '13px', color: '#aabbcc',
      stroke: '#000', strokeThickness: 2,
    }).setOrigin(0.5);

    // Controls
    this.add.text(W / 2, H * 0.965,
      'Arrows: move  |  W/S: aim  |  Space: fire  |  1/2/3: weapon', {
      fontFamily: 'Arial', fontSize: '10px', color: '#445566',
    }).setOrigin(0.5);
  }

  // ─────────────────────────────────────────────
  // Actions
  // ─────────────────────────────────────────────

  async _onCreate() {
    const name = this._val(this._nameInput, 'Player1');
    localStorage.setItem(LS_NAME_KEY, name);
    this._status('Connecting to Redis…', '#ffcc44');

    const sync = new RedisSync();
    try {
      const gameData = await sync.createRoom(name, (roomId) => {
        // Show the sharing overlay as soon as we have the room code
        this._showShareOverlay(roomId);
        this._status('Waiting for opponent to join…', '#44ff88');
        if (this._roomInput) this._roomInput.value = roomId;
        // Update browser URL so this tab also has the link
        history.replaceState(null, '', `?room=${roomId}`);
      });

      this._hideShareOverlay();
      this._status('Opponent joined! Starting…', '#44ff44');
      this._launch(sync, gameData);

    } catch (err) {
      this._hideShareOverlay();
      this._status('Error: ' + err.message, '#ff4444');
      sync.disconnect();
    }
  }

  async _onJoin() {
    const name   = this._val(this._nameInput, 'Player2');
    const roomId = this._val(this._roomInput, '').toUpperCase().replace(/\s/g, '');

    if (!roomId || roomId.length !== 6) {
      this._status('Enter the 6-character room code', '#ff4444');
      return;
    }

    localStorage.setItem(LS_NAME_KEY, name);

    const sync = new RedisSync();
    this._showJoinOverlay(roomId, () => {
      sync.disconnect();
      this._hideJoinOverlay();
      this._status('Cancelled', '#ff8844');
      history.replaceState(null, '', window.location.pathname);
    });

    try {
      const gameData = await sync.joinRoom(roomId, name);
      this._hideJoinOverlay();
      this._launch(sync, gameData);
    } catch (err) {
      this._hideJoinOverlay();
      this._status('Error: ' + err.message, '#ff4444');
      sync.disconnect();
    }
  }

  _solo() {
    this._cleanupDom();
    const name  = this._val(this._nameInput, 'Player');
    const seed  = Math.floor(Math.random() * 0xffffffff);
    const teams = [
      { id: 'team-0', name, color: 0xff4444,
        worms: [{ id: 'w0-0', name: 'Walker' }, { id: 'w0-1', name: 'Runner' }] },
      { id: 'team-1', name: 'CPU', color: 0x4488ff,
        worms: [{ id: 'w1-0', name: 'Jumper' }, { id: 'w1-1', name: 'Blaster' }] },
    ];
    this.scene.stop('MenuScene');
    this.scene.start('GameScene', { seed, playerId: 'local', playerName: name, teams, myTeamIndex: 0, wsClient: null, singlePlayer: true });
    this.scene.launch('UIScene', { myTeamIndex: 0, teams });
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
  // Share overlay (DOM)
  // ─────────────────────────────────────────────

  _showShareOverlay(roomId) {
    if (this._overlay) this._hideShareOverlay();

    const shareUrl  = `${BASE_URL}?room=${roomId}`;
    const canvas    = this.game.canvas;
    const rect      = canvas.getBoundingClientRect();

    const overlay = document.createElement('div');
    overlay.id = 'worms-share-overlay';
    Object.assign(overlay.style, {
      position:        'fixed',
      left:            rect.left + 'px',
      top:             (rect.top + rect.height * 0.64) + 'px',
      width:           rect.width + 'px',
      display:         'flex',
      flexDirection:   'column',
      alignItems:      'center',
      gap:             '8px',
      zIndex:          '200',
      pointerEvents:   'none',
    });

    // Room code badge
    const badge = document.createElement('div');
    Object.assign(badge.style, {
      background:   'rgba(10,16,32,0.92)',
      border:       '2px solid #e8c86d',
      borderRadius: '10px',
      padding:      '8px 22px',
      color:        '#e8c86d',
      fontFamily:   'Arial Black, Arial',
      fontSize:     Math.round(rect.height * 0.06) + 'px',
      letterSpacing:'0.18em',
      pointerEvents:'none',
    });
    badge.textContent = roomId;

    // Link row
    const linkRow = document.createElement('div');
    Object.assign(linkRow.style, {
      display:      'flex',
      gap:          '6px',
      alignItems:   'center',
      pointerEvents:'auto',
    });

    // Link input (read-only, selectable)
    const linkInput = document.createElement('input');
    linkInput.readOnly = true;
    linkInput.value    = shareUrl;
    Object.assign(linkInput.style, {
      background:   'rgba(10,16,32,0.9)',
      border:       '1px solid #334466',
      borderRadius: '6px',
      color:        '#88aacc',
      fontFamily:   'Arial',
      fontSize:     Math.round(rect.height * 0.028) + 'px',
      padding:      '5px 10px',
      width:        Math.round(rect.width * 0.52) + 'px',
      outline:      'none',
      cursor:       'text',
    });
    linkInput.addEventListener('focus', () => linkInput.select());

    // Copy Link button
    const copyLinkBtn = this._copyBtn('Copy Link', () => {
      navigator.clipboard.writeText(shareUrl).then(() => {
        copyLinkBtn.textContent = 'Copied!';
        setTimeout(() => { copyLinkBtn.textContent = 'Copy Link'; }, 2000);
      });
    }, rect);

    // Copy Code button
    const copyCodeBtn = this._copyBtn('Copy Code', () => {
      navigator.clipboard.writeText(roomId).then(() => {
        copyCodeBtn.textContent = 'Copied!';
        setTimeout(() => { copyCodeBtn.textContent = 'Copy Code'; }, 2000);
      });
    }, rect);

    linkRow.appendChild(linkInput);
    linkRow.appendChild(copyLinkBtn);
    linkRow.appendChild(copyCodeBtn);

    overlay.appendChild(badge);
    overlay.appendChild(linkRow);
    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._domEls.push(overlay);

    // Keep overlay positioned if canvas resizes
    this._overlayRoomId = roomId;
    this.scale.on('resize', this._repositionOverlay, this);
  }

  _copyBtn(label, cb, rect) {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
      background:   '#1a6632',
      border:       '1px solid #2a9942',
      borderRadius: '6px',
      color:        '#ffffff',
      fontFamily:   'Arial',
      fontSize:     Math.round(rect.height * 0.026) + 'px',
      padding:      '5px 12px',
      cursor:       'pointer',
      whiteSpace:   'nowrap',
    });
    btn.addEventListener('mouseenter', () => { btn.style.background = '#22884a'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#1a6632'; });
    btn.addEventListener('click', cb);
    return btn;
  }

  _repositionOverlay() {
    if (!this._overlay) return;
    const rect = this.game.canvas.getBoundingClientRect();
    this._overlay.style.left  = rect.left + 'px';
    this._overlay.style.top   = (rect.top + rect.height * 0.64) + 'px';
    this._overlay.style.width = rect.width + 'px';
  }

  _hideShareOverlay() {
    if (this._overlay) {
      this._overlay.remove();
      this._overlay = null;
    }
    this.scale.off('resize', this._repositionOverlay, this);
  }

  // ─────────────────────────────────────────────
  // Join waiting overlay
  // ─────────────────────────────────────────────

  _showJoinOverlay(roomId, onCancel) {
    if (this._joinOverlay) this._hideJoinOverlay();

    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();

    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position:       'fixed',
      left:           rect.left + 'px',
      top:            rect.top  + 'px',
      width:          rect.width  + 'px',
      height:         rect.height + 'px',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      background:     'rgba(10,16,32,0.82)',
      zIndex:         '300',
      gap:            '18px',
    });

    // Spinner (CSS animation via a style tag)
    const styleId = 'worms-spinner-style';
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style');
      s.id = styleId;
      s.textContent = `
        @keyframes worms-spin { to { transform: rotate(360deg); } }
        @keyframes worms-pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
        .worms-spinner {
          width: 52px; height: 52px;
          border: 5px solid rgba(232,200,109,0.2);
          border-top-color: #e8c86d;
          border-radius: 50%;
          animation: worms-spin 0.9s linear infinite;
        }
        .worms-dots span {
          display:inline-block; width:8px; height:8px;
          border-radius:50%; background:#e8c86d; margin:0 3px;
          animation: worms-pulse 1.2s ease-in-out infinite;
        }
        .worms-dots span:nth-child(2){ animation-delay:.2s }
        .worms-dots span:nth-child(3){ animation-delay:.4s }
      `;
      document.head.appendChild(s);
    }

    const spinner = document.createElement('div');
    spinner.className = 'worms-spinner';

    const title = document.createElement('div');
    Object.assign(title.style, {
      color: '#e8c86d', fontFamily: 'Arial Black, Arial',
      fontSize: Math.round(rect.height * 0.048) + 'px',
      letterSpacing: '0.1em',
    });
    title.textContent = 'JOINING ROOM';

    const codeBadge = document.createElement('div');
    Object.assign(codeBadge.style, {
      color: '#ffffff', fontFamily: 'Arial Black, Arial',
      fontSize: Math.round(rect.height * 0.072) + 'px',
      letterSpacing: '0.22em',
      background: 'rgba(232,200,109,0.12)',
      border: '2px solid rgba(232,200,109,0.4)',
      borderRadius: '10px',
      padding: '6px 28px',
    });
    codeBadge.textContent = roomId;

    const dots = document.createElement('div');
    dots.className = 'worms-dots';
    dots.innerHTML = '<span></span><span></span><span></span>';

    const subText = document.createElement('div');
    Object.assign(subText.style, {
      color: '#88aacc', fontFamily: 'Arial', fontSize: Math.round(rect.height * 0.028) + 'px',
    });
    subText.textContent = 'Waiting for the host to start the game…';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, {
      marginTop:    '8px',
      background:   'transparent',
      border:       '1px solid #445566',
      borderRadius: '6px',
      color:        '#88aacc',
      fontFamily:   'Arial',
      fontSize:     Math.round(rect.height * 0.028) + 'px',
      padding:      '6px 24px',
      cursor:       'pointer',
    });
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.borderColor = '#ff4444'; cancelBtn.style.color = '#ff4444'; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.borderColor = '#445566'; cancelBtn.style.color = '#88aacc'; });
    cancelBtn.addEventListener('click', onCancel);

    wrap.appendChild(spinner);
    wrap.appendChild(title);
    wrap.appendChild(codeBadge);
    wrap.appendChild(dots);
    wrap.appendChild(subText);
    wrap.appendChild(cancelBtn);
    document.body.appendChild(wrap);

    this._joinOverlay = wrap;
    this._domEls.push(wrap);

    // Reposition on resize
    this._joinOverlayResize = () => {
      const r = canvas.getBoundingClientRect();
      wrap.style.left   = r.left   + 'px';
      wrap.style.top    = r.top    + 'px';
      wrap.style.width  = r.width  + 'px';
      wrap.style.height = r.height + 'px';
    };
    this.scale.on('resize', this._joinOverlayResize);
  }

  _hideJoinOverlay() {
    if (this._joinOverlay) {
      this._joinOverlay.remove();
      this._joinOverlay = null;
    }
    if (this._joinOverlayResize) {
      this.scale.off('resize', this._joinOverlayResize);
      this._joinOverlayResize = null;
    }
  }

  // ─────────────────────────────────────────────
  // DOM helpers
  // ─────────────────────────────────────────────

  _input(cx, cy, w, h, placeholder) {
    const bg = this.add.graphics();
    bg.fillStyle(0x0a1020, 1);
    bg.lineStyle(1, 0x334466, 1);
    bg.fillRoundedRect(cx - w / 2, cy, w, h, 6);
    bg.strokeRoundedRect(cx - w / 2, cy, w, h, 6);

    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx = rect.width  / this.scale.width;
    const sy = rect.height / this.scale.height;

    const el = document.createElement('input');
    el.type        = 'text';
    el.placeholder = placeholder;
    el.value       = placeholder;
    Object.assign(el.style, {
      position:   'fixed',
      left:       (rect.left + (cx - w / 2) * sx) + 'px',
      top:        (rect.top  + cy * sy) + 'px',
      width:      (w * sx) + 'px',
      height:     (h * sy) + 'px',
      background: 'transparent',
      border:     'none',
      outline:    'none',
      color:      '#ffffff',
      fontFamily: 'Arial',
      fontSize:   Math.round(14 * sy) + 'px',
      padding:    '4px 10px',
      boxSizing:  'border-box',
      zIndex:     '100',
    });
    document.body.appendChild(el);
    this._domEls.push(el);

    this.scale.on('resize', () => {
      const r  = canvas.getBoundingClientRect();
      const tx = r.width  / this.scale.width;
      const ty = r.height / this.scale.height;
      el.style.left   = (r.left + (cx - w / 2) * tx) + 'px';
      el.style.top    = (r.top  + cy * ty) + 'px';
      el.style.width  = (w * tx) + 'px';
      el.style.height = (h * ty) + 'px';
      el.style.fontSize = Math.round(14 * ty) + 'px';
    });

    return el;
  }

  _btn(cx, cy, w, h, label, color, cb) {
    const bg = this.add.graphics();
    const draw = (hover) => {
      bg.clear();
      bg.fillStyle(hover ? Math.min(color + 0x181818, 0xffffff) : color, 1);
      bg.lineStyle(1, 0xffffff, hover ? 0.35 : 0.15);
      bg.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, 7);
      bg.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, 7);
    };
    draw(false);
    this.add.text(cx, cy, label, {
      fontFamily: 'Arial Black, Arial', fontSize: '12px', color: '#fff',
    }).setOrigin(0.5);
    const z = this.add.zone(cx, cy, w, h).setInteractive({ cursor: 'pointer' });
    z.on('pointerover',  () => draw(true));
    z.on('pointerout',   () => draw(false));
    z.on('pointerdown',  cb);
  }

  _val(el, fallback = '') {
    return el?.value?.trim() || fallback;
  }

  _status(msg, color = '#aabbcc') {
    this._statusTxt?.setText(msg).setStyle({ color });
  }

  _prefill() {
    // Pre-fill saved player name
    const savedName = localStorage.getItem(LS_NAME_KEY);
    if (savedName && this._nameInput) this._nameInput.value = savedName;

    // Auto-join from URL param: ?room=XXXXXX
    const params    = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      const code = roomParam.toUpperCase().slice(0, 6);
      if (this._roomInput) this._roomInput.value = code;
      this._status(`Connecting to room ${code}…`, '#44ff88');
      // Auto-join after a short delay (lets scene finish rendering)
      this.time.delayedCall(600, () => this._onJoin());
    }
  }

  _cleanupDom() {
    this._hideShareOverlay();
    for (const el of this._domEls) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    this._domEls = [];
  }

  shutdown() {
    this._cleanupDom();
    // Clean URL param on exit
    history.replaceState(null, '', window.location.pathname);
  }
}
