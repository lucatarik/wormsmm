/**
 * UIScene - Overlay HUD displaying game state, timers, wind, weapons, and health bars.
 * Runs in parallel with GameScene.
 */
export class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });
  }

  init(data) {
    this.gameData = data;
    this.myTeamIndex = data.myTeamIndex ?? 0;
    this.teamsData = data.teams || [];
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;

    this._buildHUD(W, H);
    this._subscribeToGameEvents();

    // Initial state
    this.currentWind = 0;
    this.timerPct = 1;
    this.currentWeapon = 'bazooka';
    this.isMyTurn = false;
    this.activeTeamName = '';
    this.activeWormName = '';
  }

  _buildHUD(W, H) {
    // ── Turn Timer Bar (top center) ─────────────────────
    const timerBarW = 300;
    const timerBarH = 12;
    const timerBarX = (W - timerBarW) / 2;
    const timerBarY = 10;

    this.timerBg = this.add.graphics();
    this.timerBg.fillStyle(0x000000, 0.5);
    this.timerBg.fillRoundedRect(timerBarX - 2, timerBarY - 2, timerBarW + 4, timerBarH + 4, 4);
    this.timerBg.setDepth(200);

    this.timerBar = this.add.graphics().setDepth(201);
    this.timerBarParams = { x: timerBarX, y: timerBarY, w: timerBarW, h: timerBarH };

    this.timerText = this.add.text(W / 2, timerBarY + timerBarH + 10, '30', {
      fontFamily: 'Arial Black',
      fontSize: '18px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(202);

    this.turnLabel = this.add.text(W / 2, timerBarY + timerBarH + 30, '', {
      fontFamily: 'Arial',
      fontSize: '13px',
      color: '#aaccff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(202);

    // ── Team Health Panel (top left) ──────────────────────
    const panelX = 8;
    const panelY = 8;

    this.healthPanelBg = this.add.graphics().setDepth(200);
    this.healthPanelBg.fillStyle(0x000000, 0.55);
    this.healthPanelBg.fillRoundedRect(panelX, panelY, 180, 90, 8);

    this.healthRows = [];
    for (let ti = 0; ti < this.teamsData.length; ti++) {
      const team = this.teamsData[ti];
      const rowY = panelY + 12 + ti * 36;

      const teamColor = team.color || (ti === 0 ? 0xff4444 : 0x4488ff);
      const hexColor = '#' + teamColor.toString(16).padStart(6, '0');

      const teamLabel = this.add.text(panelX + 8, rowY, team.name, {
        fontFamily: 'Arial Bold',
        fontSize: '11px',
        color: hexColor,
        stroke: '#000000',
        strokeThickness: 2,
      }).setDepth(202);

      const wormBars = [];
      for (let wi = 0; wi < team.worms.length; wi++) {
        const worm = team.worms[wi];
        const bx = panelX + 8 + wi * 82;
        const by = rowY + 13;

        const barBg = this.add.graphics().setDepth(201);
        barBg.fillStyle(0x333333, 1);
        barBg.fillRect(bx, by, 70, 6);

        const barFill = this.add.graphics().setDepth(202);

        const nameText = this.add.text(bx, by - 10, worm.name, {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: '#cccccc',
        }).setDepth(202);

        const hpText = this.add.text(bx + 72, by - 1, '100', {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: '#ffffff',
        }).setDepth(202).setOrigin(0, 0.5);

        wormBars.push({ barFill, hpText, bx, by, health: 100, alive: true });
      }

      this.healthRows.push({ teamLabel, wormBars, teamColor });
    }

    // ── Wind Indicator (top right) ────────────────────────
    const windX = W - 120;
    const windY = 10;

    const windBg = this.add.graphics().setDepth(200);
    windBg.fillStyle(0x000000, 0.55);
    windBg.fillRoundedRect(windX - 4, windY - 4, 116, 44, 8);

    this.add.text(windX + 4, windY + 2, 'WIND', {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#88aacc',
    }).setDepth(202);

    this.windArrow = this.add.graphics().setDepth(202);
    this.windText = this.add.text(windX + 64, windY + 20, '0.0', {
      fontFamily: 'Arial Bold',
      fontSize: '13px',
      color: '#88ddff',
    }).setOrigin(0.5, 0.5).setDepth(202);

    this._windParams = { x: windX + 4, y: windY + 18, w: 58 };

    // ── Current Weapon (bottom center) ───────────────────
    const weapY = H - 52;
    const weapBg = this.add.graphics().setDepth(200);
    weapBg.fillStyle(0x000000, 0.55);
    weapBg.fillRoundedRect(W / 2 - 80, weapY - 8, 160, 48, 8);

    this.weaponIcon = this.add.image(W / 2 - 50, weapY + 16, 'weapon-bazooka')
      .setDepth(201)
      .setScale(1.2)
      .setOrigin(0.5);

    this.weaponName = this.add.text(W / 2 - 10, weapY + 4, 'BAZOOKA', {
      fontFamily: 'Arial Bold',
      fontSize: '13px',
      color: '#ffffff',
    }).setDepth(202);

    this.weaponAmmoText = this.add.text(W / 2 - 10, weapY + 20, 'Ammo: ∞', {
      fontFamily: 'Arial',
      fontSize: '11px',
      color: '#aaaaaa',
    }).setDepth(202);

    // ── Weapon selector bar (bottom center) ─────────────
    const WEAP_DEFS = [
      { key: 'bazooka', label: 'Bazooka',  slot: 1 },
      { key: 'grenade', label: 'Grenade',  slot: 2 },
      { key: 'cluster', label: 'Cluster',  slot: 3 },
      { key: 'shotgun', label: 'Shotgun',  slot: 4 },
      { key: 'airstrike',label: 'Strike',  slot: 5 },
      { key: 'dynamite', label: 'Dynamite',slot: 6 },
      { key: 'mine',    label: 'Mine',     slot: 7 },
    ];
    const barY   = H - 4;
    const slotW  = Math.min(92, (W - 20) / WEAP_DEFS.length);
    const startX = W / 2 - (slotW * WEAP_DEFS.length) / 2;

    this._weapSlots = {};
    for (const wd of WEAP_DEFS) {
      const cx = startX + (wd.slot - 1) * slotW + slotW / 2;
      const txt = this.add.text(cx, barY,
        `[${wd.slot}] ${wd.label}`, {
          fontFamily: 'Arial', fontSize: '9px', color: '#667788',
        }).setOrigin(0.5, 1).setDepth(200);
      const ammoTxt = this.add.text(cx, barY - 12,
        '', { fontFamily: 'Arial Bold', fontSize: '9px', color: '#aaccff' })
        .setOrigin(0.5, 1).setDepth(201);
      this._weapSlots[wd.key] = { labelTxt: txt, ammoTxt };
    }

    // ── Controls legend (bottom right, always visible) ───
    const legendLines = [
      '← → : move',
      'RClick / ↑ : jump',
      'LClick / Space : fire',
      'MClick / G : hook',
      'W / S : aim',
      'Q / E : cycle weapon',
      'Scroll : zoom',
    ];
    const lx = W - 6;
    const ly = H - 4 - legendLines.length * 13;
    const legBg = this.add.graphics().setDepth(199);
    legBg.fillStyle(0x000000, 0.45);
    legBg.fillRoundedRect(lx - 112, ly - 4, 118, legendLines.length * 13 + 8, 5);
    legendLines.forEach((line, i) => {
      this.add.text(lx - 4, ly + i * 13, line, {
        fontFamily: 'Arial', fontSize: '9px', color: '#4a6070',
      }).setOrigin(1, 0).setDepth(200);
    });

    // ── "YOUR TURN" / "WAITING" indicator ───────────────
    this.turnFlash = this.add.text(W / 2, H / 2 - 60, '', {
      fontFamily: 'Arial Black',
      fontSize: '30px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 5,
    }).setOrigin(0.5).setDepth(210).setAlpha(0);

    // ── Network status (bottom left) ─────────────────────
    this.netStatusText = this.add.text(8, H - 16, '', {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#ff4444',
    }).setDepth(200);

    this._drawTimerBar(1);
    this._drawWindArrow(0);
  }

  // ─────────────────────────────────────────────
  // Event Subscriptions
  // ─────────────────────────────────────────────

  _subscribeToGameEvents() {
    const gameScene = this.scene.get('GameScene');
    if (!gameScene) return;

    gameScene.events.on('turnStart', (data) => {
      this.isMyTurn = data.isMyTurn;
      this.currentWind = data.wind;
      this.activeTeamName = data.worm?.team?.name || '';
      this.activeWormName = data.worm?.name || '';

      this._drawWindArrow(data.wind);
      this._updateTurnLabel();
      this._flashTurnMessage(data.isMyTurn ? 'YOUR TURN!' : `${this.activeTeamName}'s TURN`);
      this._drawTimerBar(1);
    }, this);

    gameScene.events.on('timerUpdate', (data) => {
      this._drawTimerBar(data.pct);
      const secs = Math.ceil(data.remaining / 1000);
      this.timerText.setText(secs.toString());
      if (data.pct < 0.25) {
        this.timerText.setStyle({ color: '#ff4444' });
      } else {
        this.timerText.setStyle({ color: '#ffffff' });
      }
    }, this);

    gameScene.events.on('wormDied', (data) => {
      const { worm } = data;
      this._updateHealthBar(worm.teamIndex, worm.wormIndex, 0, false);
    }, this);

    gameScene.events.on('weaponChanged', (weaponKey) => {
      this._updateWeaponDisplay(weaponKey);
    }, this);

    gameScene.events.on('gameOver', (data) => {
      // UIScene can show final screen elements if needed
    }, this);

    gameScene.events.on('networkStatus', (data) => {
      if (!data.connected) {
        this.netStatusText.setText('DISCONNECTED');
      } else {
        this.netStatusText.setText('');
      }
    }, this);
  }

  // ─────────────────────────────────────────────
  // HUD Drawing
  // ─────────────────────────────────────────────

  _drawTimerBar(pct) {
    const { x, y, w, h } = this.timerBarParams;
    this.timerBar.clear();

    const color = pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xffcc00 : 0xff4444;
    this.timerBar.fillStyle(color, 1);
    this.timerBar.fillRoundedRect(x, y, Math.max(0, w * pct), h, 4);
  }

  _drawWindArrow(wind) {
    const { x, y, w } = this._windParams;
    this.windArrow.clear();

    const magnitude = Math.abs(wind);
    const maxWind = 5;
    const arrowLen = Math.round((magnitude / maxWind) * w);
    const dir = wind >= 0 ? 1 : -1;

    if (arrowLen < 2) {
      this.windText.setText('Calm');
      return;
    }

    const color = 0x44aaff;
    this.windArrow.lineStyle(3, color, 1);

    const startX = wind >= 0 ? x : x + w;
    const endX = startX + arrowLen * dir;

    this.windArrow.beginPath();
    this.windArrow.moveTo(startX, y);
    this.windArrow.lineTo(endX, y);
    this.windArrow.strokePath();

    // Arrowhead
    this.windArrow.fillStyle(color, 1);
    this.windArrow.fillTriangle(
      endX, y,
      endX - dir * 8, y - 5,
      endX - dir * 8, y + 5
    );

    this.windText.setText(magnitude.toFixed(1));
  }

  _updateTurnLabel() {
    const label = this.isMyTurn
      ? `YOUR TURN - ${this.activeWormName}`
      : `${this.activeTeamName} - ${this.activeWormName}`;
    this.turnLabel.setText(label);
    this.turnLabel.setStyle({
      color: this.isMyTurn ? '#ffdd44' : '#aaccff',
    });
  }

  _flashTurnMessage(msg) {
    this.turnFlash.setText(msg);
    this.turnFlash.setAlpha(1);
    this.tweens.add({
      targets: this.turnFlash,
      alpha: 0,
      delay: 1200,
      duration: 600,
      ease: 'Power2',
    });
  }

  _updateWeaponDisplay(weaponKey) {
    const NAMES = {
      bazooka: 'BAZOOKA', grenade: 'GRENADE', cluster: 'CLUSTER',
      shotgun: 'SHOTGUN', airstrike: 'AIR STRIKE', dynamite: 'DYNAMITE',
      mine: 'MINE', hook: 'HOOK',
    };
    const ICONS = {
      bazooka: 'weapon-bazooka', grenade: 'weapon-grenade',
      mine: 'weapon-mine',
    };

    this.currentWeapon = weaponKey;
    this.weaponName.setText(NAMES[weaponKey] || weaponKey.toUpperCase());
    this.weaponIcon.setTexture(ICONS[weaponKey] || 'weapon-bazooka');

    const gameScene = this.scene.get('GameScene');
    if (gameScene) {
      const ammo = gameScene.weaponAmmo?.[weaponKey];
      this.weaponAmmoText.setText(
        ammo === undefined || ammo === Infinity ? 'Ammo: ∞' : `Ammo: ${ammo}`,
      );
      // Refresh all slot ammo labels
      this._refreshWeapSlots(gameScene);
    }
  }

  _refreshWeapSlots(gameScene) {
    if (!this._weapSlots) return;
    for (const [key, slot] of Object.entries(this._weapSlots)) {
      const ammo = gameScene?.weaponAmmo?.[key];
      const label = ammo === undefined || ammo === Infinity ? '∞' : String(ammo);
      slot.ammoTxt.setText(label);
      const active = key === this.currentWeapon;
      slot.labelTxt.setStyle({ color: active ? '#e8c86d' : '#667788' });
      slot.ammoTxt.setStyle({ color: ammo === 0 ? '#ff4444' : '#aaccff' });
    }
  }

  /**
   * Update a specific worm's health bar in the panel.
   * @param {number} teamIndex
   * @param {number} wormIndex
   * @param {number} health 0-100
   * @param {boolean} alive
   */
  _updateHealthBar(teamIndex, wormIndex, health, alive) {
    const row = this.healthRows[teamIndex];
    if (!row) return;
    const barData = row.wormBars[wormIndex];
    if (!barData) return;

    barData.health = health;
    barData.alive = alive;

    barData.barFill.clear();
    if (alive || health > 0) {
      const pct = health / 100;
      const color = pct > 0.5 ? 0x44cc44 : pct > 0.25 ? 0xffcc00 : 0xff4444;
      barData.barFill.fillStyle(color, 1);
      barData.barFill.fillRect(barData.bx, barData.by, Math.round(70 * pct), 6);
    }

    barData.hpText.setText(alive ? Math.ceil(health).toString() : 'KO');
    if (!alive) barData.hpText.setStyle({ color: '#ff4444' });
  }

  update() {
    const gameScene = this.scene.get('GameScene');
    if (!gameScene || !gameScene.teams) return;

    this._refreshWeapSlots(gameScene);

    for (let ti = 0; ti < gameScene.teams.length; ti++) {
      const team = gameScene.teams[ti];
      if (!team) continue;
      for (let wi = 0; wi < team.worms.length; wi++) {
        const worm = team.worms[wi];
        if (!worm) continue;
        this._updateHealthBar(ti, wi, worm.health, worm.alive);
      }
    }
  }
}
