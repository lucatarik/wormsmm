import { RedisSync } from '../network/RedisSync.js';

const LS_NAME_KEY = 'worms_player_name';
const BASE_URL    = 'https://lucatarik.github.io/wormsmm/';

/**
 * MenuScene — Two flows:
 *
 * HOST  (no ?room param): page auto-generates a room ID and shows the
 *   share link immediately. User enters name → clicks PLAY → waits for
 *   opponent.
 *
 * GUEST (?room=XXXXX): user sees an invite screen, enters name → clicks
 *   JOIN → overlay "waiting for host" → game starts.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MenuScene' });
    this._domEls = [];
  }

  create() {
    const params  = new URLSearchParams(window.location.search);
    this._roomParam = (params.get('room') || '').toUpperCase().slice(0, 6);
    this._isGuest   = this._roomParam.length === 6;

    // Pre-generate a room ID for the host so the share link is known immediately
    if (!this._isGuest) {
      this._pendingRoomId = RedisSync.generateRoomId();
    }

    this._drawBg();
    this._drawTitle();
    if (this._isGuest) {
      this._buildGuestUI();
    } else {
      this._buildHostUI();
    }
  }

  // ─────────────────────────────────────────────
  // Background
  // ─────────────────────────────────────────────

  _drawBg() {
    const W = this.scale.width, H = this.scale.height;
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x0d1b2e, 0x0d1b2e, 1);
    sky.fillRect(0, 0, W, H);
    const s = this.add.graphics();
    s.fillStyle(0xffffff, 1);
    for (let i = 0; i < 100; i++) {
      s.fillRect(Math.random() * W | 0, (Math.random() * H * 0.75) | 0,
        Math.random() < 0.8 ? 1 : 2, 1);
    }
    const g = this.add.graphics();
    g.fillStyle(0x0a1520, 1);
    g.fillRect(0, H * 0.78, W, H);
    g.fillEllipse(W * 0.15, H * 0.80, 320, 110);
    g.fillEllipse(W * 0.55, H * 0.82, 400, 95);
    g.fillEllipse(W * 0.88, H * 0.79, 280, 115);
  }

  _drawTitle() {
    const W = this.scale.width, H = this.scale.height;
    this.add.text(W / 2 + 3, H * 0.10 + 3, 'WORMS ONLINE',
      { fontFamily: 'Arial Black,Arial', fontSize: '42px', color: '#000' })
      .setOrigin(0.5).setAlpha(0.35);
    this.add.text(W / 2, H * 0.10, 'WORMS ONLINE',
      { fontFamily: 'Arial Black,Arial', fontSize: '42px',
        color: '#e8c86d', stroke: '#7a4e1c', strokeThickness: 4 })
      .setOrigin(0.5);
  }

  // ─────────────────────────────────────────────
  // HOST UI
  // ─────────────────────────────────────────────

  _buildHostUI() {
    const W = this.scale.width, H = this.scale.height;
    const shareUrl = `${BASE_URL}?room=${this._pendingRoomId}`;

    // ── Panel ──────────────────────────────────
    const pW = 420, pH = 300, px = W / 2, py = H * 0.52;
    const panel = this.add.graphics();
    panel.fillStyle(0x0d1b2a, 0.9);
    panel.lineStyle(2, 0x2a3d5a, 1);
    panel.fillRoundedRect(px - pW/2, py - pH/2, pW, pH, 14);
    panel.strokeRoundedRect(px - pW/2, py - pH/2, pW, pH, 14);

    const top = py - pH / 2 + 24;
    const lbl = { fontFamily: 'Arial', fontSize: '11px', color: '#6688aa' };

    // Name input
    this.add.text(px - 170, top, 'YOUR NAME', lbl);
    this._nameEl = this._input(px, top + 18, 340, 34, 'Player1');
    const saved = localStorage.getItem(LS_NAME_KEY);
    if (saved) this._nameEl.value = saved;

    // PLAY button
    this._playBtn(px, top + 88, 200, 42, 'PLAY', () => this._hostPlay());

    // Divider
    const div = this.add.graphics();
    div.lineStyle(1, 0x2a3d5a, 1);
    div.lineBetween(px - 170, top + 128, px + 170, top + 128);
    this.add.text(px, top + 128, ' SHARE WITH A FRIEND ',
      { fontFamily: 'Arial', fontSize: '10px', color: '#445566',
        backgroundColor: '#0d1b2a' }).setOrigin(0.5);

    // Share link (read-only)
    this._linkEl = this._readonlyInput(px, top + 148, 260, 30, shareUrl);

    // Copy button (DOM)
    this._copyDomBtn(px + 158, top + 148 + 15, 'Copy', () => {
      navigator.clipboard.writeText(shareUrl).then(() => {
        this._copyLabel && (this._copyLabel.textContent = 'Copied!');
        setTimeout(() => { this._copyLabel && (this._copyLabel.textContent = 'Copy'); }, 2000);
      });
    });

    // Solo mode
    this.add.text(W / 2, py + pH / 2 + 18, 'or  play solo vs CPU  (no link needed)',
      { fontFamily: 'Arial', fontSize: '11px', color: '#334455' })
      .setOrigin(0.5).setInteractive({ cursor: 'pointer' })
      .on('pointerdown', () => this._solo())
      .on('pointerover', function () { this.setStyle({ color: '#6688aa' }); })
      .on('pointerout',  function () { this.setStyle({ color: '#334455' }); });

    // Status
    this._statusTxt = this.add.text(W / 2, py + pH / 2 + 40, '', {
      fontFamily: 'Arial', fontSize: '12px', color: '#aabbcc',
    }).setOrigin(0.5);

    // Controls hint
    this.add.text(W / 2, H * 0.965,
      'Arrows: move  |  W/S: aim  |  Space: fire  |  1/2/3: weapon',
      { fontFamily: 'Arial', fontSize: '10px', color: '#2a3a4a' }).setOrigin(0.5);
  }

  async _hostPlay() {
    const name = this._nameEl?.value?.trim() || 'Player1';
    localStorage.setItem(LS_NAME_KEY, name);

    const sync = new RedisSync();
    try {
      this._showWaitOverlay(this._pendingRoomId, 'Waiting for opponent…', () => {
        sync.disconnect();
        this._hideWaitOverlay();
        this._status('Cancelled.', '#ff8844');
      });

      const gameData = await sync.createRoom(name, this._pendingRoomId);
      this._hideWaitOverlay();
      this._launch(sync, gameData);
    } catch (err) {
      this._hideWaitOverlay();
      this._status(err.message, '#ff4444');
      sync.disconnect();
    }
  }

  // ─────────────────────────────────────────────
  // GUEST UI
  // ─────────────────────────────────────────────

  _buildGuestUI() {
    const W = this.scale.width, H = this.scale.height;
    const code = this._roomParam;

    // ── Panel ──────────────────────────────────
    const pW = 380, pH = 260, px = W / 2, py = H * 0.5;
    const panel = this.add.graphics();
    panel.fillStyle(0x0d1b2a, 0.92);
    panel.lineStyle(2, 0x2a3d5a, 1);
    panel.fillRoundedRect(px - pW/2, py - pH/2, pW, pH, 14);
    panel.strokeRoundedRect(px - pW/2, py - pH/2, pW, pH, 14);

    const top = py - pH / 2 + 22;

    // Invite header
    this.add.text(px, top + 4, "You've been invited!", {
      fontFamily: 'Arial', fontSize: '14px', color: '#88aacc',
    }).setOrigin(0.5);

    // Room badge
    const badge = this.add.graphics();
    badge.fillStyle(0x162436, 1);
    badge.lineStyle(1, 0xe8c86d, 0.5);
    badge.fillRoundedRect(px - 70, top + 26, 140, 36, 8);
    badge.strokeRoundedRect(px - 70, top + 26, 140, 36, 8);
    this.add.text(px, top + 44, code,
      { fontFamily: 'Arial Black,Arial', fontSize: '22px',
        color: '#e8c86d', letterSpacing: 6 }).setOrigin(0.5);

    // Name input
    this.add.text(px - 150, top + 86, 'YOUR NAME',
      { fontFamily: 'Arial', fontSize: '11px', color: '#6688aa' });
    this._nameEl = this._input(px, top + 104, 300, 34, 'Player2');
    const saved = localStorage.getItem(LS_NAME_KEY);
    if (saved) this._nameEl.value = saved;
    // Allow pressing Enter to join
    this._nameEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._guestJoin();
    });

    // JOIN button
    this._playBtn(px, top + 168, 200, 42, 'JOIN GAME', () => this._guestJoin());

    // Status
    this._statusTxt = this.add.text(W / 2, py + pH / 2 + 18, '', {
      fontFamily: 'Arial', fontSize: '12px', color: '#aabbcc',
    }).setOrigin(0.5);
  }

  async _guestJoin() {
    const name = this._nameEl?.value?.trim() || 'Player2';
    localStorage.setItem(LS_NAME_KEY, name);

    const sync = new RedisSync();
    this._showWaitOverlay(this._roomParam, 'Connecting to game…', () => {
      sync.disconnect();
      this._hideWaitOverlay();
      this._status('Cancelled.', '#ff8844');
    });

    try {
      const gameData = await sync.joinRoom(this._roomParam, name);
      this._hideWaitOverlay();
      this._launch(sync, gameData);
    } catch (err) {
      this._hideWaitOverlay();
      this._status(err.message, '#ff4444');
      sync.disconnect();
    }
  }

  // ─────────────────────────────────────────────
  // Solo
  // ─────────────────────────────────────────────

  _solo() {
    this._cleanupDom();
    const name  = this._nameEl?.value?.trim() || 'Player';
    const seed  = Math.random() * 0xffffffff | 0;
    const teams = [
      { id: 'team-0', name, color: 0xff4444,
        worms: [{ id: 'w0-0', name: 'Walker' }, { id: 'w0-1', name: 'Runner' }] },
      { id: 'team-1', name: 'CPU', color: 0x4488ff,
        worms: [{ id: 'w1-0', name: 'Jumper' }, { id: 'w1-1', name: 'Blaster' }] },
    ];
    this.scene.stop('MenuScene');
    this.scene.start('GameScene', { seed, playerId: 'local', playerName: name,
      teams, myTeamIndex: 0, wsClient: null, singlePlayer: true });
    this.scene.launch('UIScene', { myTeamIndex: 0, teams });
  }

  // ─────────────────────────────────────────────
  // Launch game
  // ─────────────────────────────────────────────

  _launch(sync, gameData) {
    this._cleanupDom();
    const data = {
      seed:        gameData.seed,
      roomId:      gameData.roomId,
      playerId:    gameData.playerId,
      playerName:  this._nameEl?.value?.trim() || 'Player',
      teams:       gameData.teams,
      myTeamIndex: gameData.myTeamIndex,
      wsClient:    sync,
    };
    this.scene.stop('MenuScene');
    this.scene.start('GameScene', data);
    this.scene.launch('UIScene', { myTeamIndex: data.myTeamIndex, teams: data.teams });
  }

  // ─────────────────────────────────────────────
  // Waiting overlay
  // ─────────────────────────────────────────────

  _showWaitOverlay(roomId, message, onCancel) {
    if (this._waitOverlay) this._hideWaitOverlay();

    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();

    // Inject CSS once
    if (!document.getElementById('worms-anim-style')) {
      const s = document.createElement('style');
      s.id = 'worms-anim-style';
      s.textContent = `
        @keyframes _wspin  { to { transform: rotate(360deg); } }
        @keyframes _wpulse { 0%,100%{opacity:.25} 50%{opacity:1} }
        ._wspinner {
          width:56px; height:56px;
          border: 5px solid rgba(232,200,109,.15);
          border-top-color: #e8c86d;
          border-radius:50%;
          animation: _wspin .85s linear infinite;
        }
        ._wdots span {
          display:inline-block; width:9px; height:9px;
          border-radius:50%; background:#e8c86d; margin:0 4px;
          animation: _wpulse 1.1s ease-in-out infinite;
        }
        ._wdots span:nth-child(2){animation-delay:.18s}
        ._wdots span:nth-child(3){animation-delay:.36s}
      `;
      document.head.appendChild(s);
    }

    const wrap = document.createElement('div');
    const fs   = (n) => Math.round(rect.height * n);
    Object.assign(wrap.style, {
      position: 'fixed', left: rect.left+'px', top: rect.top+'px',
      width: rect.width+'px', height: rect.height+'px',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: '16px',
      background: 'rgba(8,12,24,0.88)', zIndex: '400',
    });

    const spinner = document.createElement('div');
    spinner.className = '_wspinner';

    const msgEl = document.createElement('div');
    Object.assign(msgEl.style, {
      color: '#88aacc', fontFamily: 'Arial', fontSize: fs(.03)+'px',
    });
    msgEl.textContent = message;

    const codeBadge = document.createElement('div');
    Object.assign(codeBadge.style, {
      color: '#e8c86d', fontFamily: 'Arial Black,Arial',
      fontSize: fs(.078)+'px', letterSpacing: '0.22em',
      background: 'rgba(232,200,109,.08)',
      border: '2px solid rgba(232,200,109,.35)',
      borderRadius: '10px', padding: '6px 28px',
    });
    codeBadge.textContent = roomId;

    const dots = document.createElement('div');
    dots.className = '_wdots';
    dots.innerHTML = '<span></span><span></span><span></span>';

    const hint = document.createElement('div');
    Object.assign(hint.style, {
      color: '#445566', fontFamily: 'Arial', fontSize: fs(.025)+'px',
    });
    hint.textContent = this._isGuest
      ? 'Waiting for the host to start…'
      : 'Share the code above with your friend';

    // Copy link button (for host)
    let copyBtn = null;
    if (!this._isGuest) {
      const shareUrl = `${BASE_URL}?room=${roomId}`;
      copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy invite link';
      Object.assign(copyBtn.style, {
        background: '#1a6632', border: '1px solid #2a9942',
        borderRadius: '7px', color: '#fff', fontFamily: 'Arial',
        fontSize: fs(.028)+'px', padding: '7px 22px', cursor: 'pointer',
      });
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(shareUrl).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy invite link'; }, 2000);
        });
      });
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, {
      background: 'transparent', border: '1px solid #334455',
      borderRadius: '7px', color: '#556677', fontFamily: 'Arial',
      fontSize: fs(.027)+'px', padding: '6px 22px', cursor: 'pointer',
      marginTop: '4px',
    });
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.borderColor = '#ff4444'; cancelBtn.style.color = '#ff4444';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.borderColor = '#334455'; cancelBtn.style.color = '#556677';
    });
    cancelBtn.addEventListener('click', onCancel);

    wrap.appendChild(spinner);
    wrap.appendChild(msgEl);
    wrap.appendChild(codeBadge);
    wrap.appendChild(dots);
    wrap.appendChild(hint);
    if (copyBtn) wrap.appendChild(copyBtn);
    wrap.appendChild(cancelBtn);
    document.body.appendChild(wrap);

    this._waitOverlay = wrap;
    this._domEls.push(wrap);

    this._waitOverlayResize = () => {
      const r = canvas.getBoundingClientRect();
      Object.assign(wrap.style, {
        left: r.left+'px', top: r.top+'px',
        width: r.width+'px', height: r.height+'px',
      });
    };
    this.scale.on('resize', this._waitOverlayResize);
  }

  _hideWaitOverlay() {
    if (this._waitOverlay) { this._waitOverlay.remove(); this._waitOverlay = null; }
    if (this._waitOverlayResize) {
      this.scale.off('resize', this._waitOverlayResize);
      this._waitOverlayResize = null;
    }
  }

  // ─────────────────────────────────────────────
  // DOM helpers
  // ─────────────────────────────────────────────

  _input(cx, cy, w, h, placeholder) {
    const bg = this.add.graphics();
    bg.fillStyle(0x08121e, 1);
    bg.lineStyle(1, 0x2a3d5a, 1);
    bg.fillRoundedRect(cx - w/2, cy, w, h, 6);
    bg.strokeRoundedRect(cx - w/2, cy, w, h, 6);

    const canvas = this.game.canvas;
    const r0 = canvas.getBoundingClientRect();
    const sx = r0.width / this.scale.width, sy = r0.height / this.scale.height;

    const el = document.createElement('input');
    el.type = 'text'; el.placeholder = placeholder; el.value = placeholder;
    Object.assign(el.style, {
      position: 'fixed',
      left: (r0.left + (cx - w/2) * sx)+'px',
      top:  (r0.top  + cy * sy)+'px',
      width: (w * sx)+'px', height: (h * sy)+'px',
      background: 'transparent', border: 'none', outline: 'none',
      color: '#ffffff', fontFamily: 'Arial',
      fontSize: Math.round(15 * sy)+'px',
      padding: '4px 12px', boxSizing: 'border-box', zIndex: '100',
    });
    document.body.appendChild(el);
    this._domEls.push(el);

    this.scale.on('resize', () => {
      const r = canvas.getBoundingClientRect();
      const tx = r.width / this.scale.width, ty = r.height / this.scale.height;
      el.style.left = (r.left + (cx - w/2) * tx)+'px';
      el.style.top  = (r.top  + cy * ty)+'px';
      el.style.width = (w * tx)+'px'; el.style.height = (h * ty)+'px';
      el.style.fontSize = Math.round(15 * ty)+'px';
    });
    return el;
  }

  _readonlyInput(cx, cy, w, h, value) {
    const bg = this.add.graphics();
    bg.fillStyle(0x060e18, 1);
    bg.lineStyle(1, 0x1e2e40, 1);
    bg.fillRoundedRect(cx - w/2, cy, w, h, 6);
    bg.strokeRoundedRect(cx - w/2, cy, w, h, 6);

    const canvas = this.game.canvas;
    const r0 = canvas.getBoundingClientRect();
    const sx = r0.width / this.scale.width, sy = r0.height / this.scale.height;

    const el = document.createElement('input');
    el.readOnly = true; el.value = value;
    Object.assign(el.style, {
      position: 'fixed',
      left: (r0.left + (cx - w/2) * sx)+'px',
      top:  (r0.top  + cy * sy)+'px',
      width: (w * sx)+'px', height: (h * sy)+'px',
      background: 'transparent', border: 'none', outline: 'none',
      color: '#557799', fontFamily: 'Arial',
      fontSize: Math.round(11 * sy)+'px',
      padding: '4px 10px', boxSizing: 'border-box', zIndex: '100',
    });
    el.addEventListener('focus', () => el.select());
    document.body.appendChild(el);
    this._domEls.push(el);

    this.scale.on('resize', () => {
      const r = canvas.getBoundingClientRect();
      const tx = r.width / this.scale.width, ty = r.height / this.scale.height;
      el.style.left = (r.left + (cx - w/2) * tx)+'px';
      el.style.top  = (r.top  + cy * ty)+'px';
      el.style.width = (w * tx)+'px'; el.style.height = (h * ty)+'px';
      el.style.fontSize = Math.round(11 * ty)+'px';
    });
    return el;
  }

  _copyDomBtn(cx, cy, label, cb) {
    const canvas = this.game.canvas;
    const r0 = canvas.getBoundingClientRect();
    const sx = r0.width / this.scale.width, sy = r0.height / this.scale.height;

    const btn = document.createElement('button');
    this._copyLabel = btn;
    btn.textContent = label;
    const bw = 60 * sx, bh = 30 * sy;
    Object.assign(btn.style, {
      position: 'fixed',
      left: (r0.left + cx * sx - bw/2)+'px',
      top:  (r0.top  + (cy - 15) * sy)+'px',
      width: bw+'px', height: bh+'px',
      background: '#1a4a6e', border: '1px solid #2a6a9e',
      borderRadius: '6px', color: '#aaccff', fontFamily: 'Arial',
      fontSize: Math.round(11 * sy)+'px', cursor: 'pointer', zIndex: '100',
    });
    btn.addEventListener('click', cb);
    document.body.appendChild(btn);
    this._domEls.push(btn);

    this.scale.on('resize', () => {
      const r = canvas.getBoundingClientRect();
      const tx = r.width / this.scale.width, ty = r.height / this.scale.height;
      btn.style.left = (r.left + cx * tx - (60*tx)/2)+'px';
      btn.style.top  = (r.top  + (cy - 15) * ty)+'px';
      btn.style.width = (60*tx)+'px'; btn.style.height = (30*ty)+'px';
      btn.style.fontSize = Math.round(11 * ty)+'px';
    });
  }

  _playBtn(cx, cy, w, h, label, cb) {
    const bg = this.add.graphics();
    const draw = (hot) => {
      bg.clear();
      bg.fillStyle(hot ? 0x1d7a40 : 0x145a2e, 1);
      bg.lineStyle(2, hot ? 0x44cc66 : 0x1d7a40, 1);
      bg.fillRoundedRect(cx - w/2, cy - h/2, w, h, 9);
      bg.strokeRoundedRect(cx - w/2, cy - h/2, w, h, 9);
    };
    draw(false);
    this.add.text(cx, cy, label,
      { fontFamily: 'Arial Black,Arial', fontSize: '15px', color: '#ffffff' })
      .setOrigin(0.5);
    this.add.zone(cx, cy, w, h).setInteractive({ cursor: 'pointer' })
      .on('pointerover',  () => draw(true))
      .on('pointerout',   () => draw(false))
      .on('pointerdown',  cb);
  }

  _status(msg, color = '#aabbcc') {
    this._statusTxt?.setText(msg).setStyle({ color });
  }

  _cleanupDom() {
    this._hideWaitOverlay();
    for (const el of this._domEls) el.parentNode?.removeChild(el);
    this._domEls = [];
  }

  shutdown() {
    this._cleanupDom();
    history.replaceState(null, '', window.location.pathname);
  }
}
