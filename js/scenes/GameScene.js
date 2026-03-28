import { generateHeightmap, buildTerrainPixels, findSurfaceY } from '../utils/terrain-gen.js';
import { mulberry32 } from '../utils/rng.js';

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 500;
const GRAVITY = 0.32;
const WORM_RADIUS = 10;
const TURN_DURATION = 30000; // ms
const MOVE_SPEED = 2.2;
const JUMP_FORCE = -7.5;
const AI_THINK_DELAY = 1800;

const WEAPONS = {
  bazooka: {
    name: 'Bazooka',
    key: 'bazooka',
    speed: 12,
    gravity: 0.15,
    windFactor: 1.0,
    explodeRadius: 50,
    damage: 40,
    fuse: null,
    projectileKey: 'projectile-bazooka',
    ammo: Infinity,
  },
  grenade: {
    name: 'Grenade',
    key: 'grenade',
    speed: 9,
    gravity: 0.25,
    windFactor: 0.3,
    explodeRadius: 60,
    damage: 35,
    fuse: 3000,
    projectileKey: 'projectile-grenade',
    ammo: 3,
  },
  mine: {
    name: 'Mine',
    key: 'mine',
    placed: true,
    explodeRadius: 45,
    damage: 50,
    armTime: 1500,
    triggerRadius: 22,
    projectileKey: 'mine',
    ammo: 2,
  },
};

const WEAPON_ORDER = ['bazooka', 'grenade', 'mine'];

/**
 * GameScene - The main gameplay scene with terrain, worms, weapons, physics, and networking.
 */
export class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });
  }

  init(data) {
    this.gameData = data;
    this.seed = data.seed || Math.floor(Math.random() * 0xffffff);
    this.playerId = data.playerId || 'local';
    this.playerName = data.playerName || 'Player';
    this.teamsData = data.teams || [];
    this.myTeamIndex = data.myTeamIndex ?? 0;
    this.wsClient = data.wsClient || null;
    this.isSinglePlayer = data.singlePlayer || !data.wsClient;
  }

  create() {
    this._setupWorld();
    this._setupTerrain();
    this._spawnWorms();
    this._setupCamera();
    this._setupInput();
    this._setupWeapons();
    this._setupTurnManager();
    this._setupNetworking();
    this._setupEventBridge();

    // Start first turn
    this._startTurn();
  }

  // ─────────────────────────────────────────────
  // World Setup
  // ─────────────────────────────────────────────

  _setupWorld() {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Sky background
    const sky = this.add.graphics();
    sky.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x0d2040, 0x0d2040, 1);
    sky.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    sky.setScrollFactor(0.1); // Parallax

    // Stars
    const starGfx = this.add.graphics();
    starGfx.setScrollFactor(0.15);
    starGfx.fillStyle(0xffffff, 1);
    const rng = mulberry32(this.seed + 999);
    for (let i = 0; i < 200; i++) {
      const sx = Math.floor(rng() * WORLD_WIDTH);
      const sy = Math.floor(rng() * WORLD_HEIGHT * 0.6);
      starGfx.fillRect(sx, sy, rng() < 0.8 ? 1 : 2, rng() < 0.8 ? 1 : 2);
    }

    this.projectiles = [];
    this.mines = [];
    this.explosionGroup = this.add.group();
    this.particleGroup = this.add.group();
    this.trailDots = [];
    this.gameOver = false;
    this.turnActive = false;
    this.fired = false;
    this.aiThinking = false;
  }

  // ─────────────────────────────────────────────
  // Terrain
  // ─────────────────────────────────────────────

  _setupTerrain() {
    this.heightmap = generateHeightmap(this.seed, WORLD_WIDTH, WORLD_HEIGHT);
    this.terrainPixels = buildTerrainPixels(this.heightmap, WORLD_WIDTH, WORLD_HEIGHT);

    // Create OffscreenCanvas for terrain
    this.terrainCanvas = new OffscreenCanvas(WORLD_WIDTH, WORLD_HEIGHT);
    this.terrainCtx = this.terrainCanvas.getContext('2d');

    this._drawTerrainToCanvas();

    // Register as Phaser texture
    this.textures.addCanvas('terrain', this.terrainCanvas);

    // Create image from texture
    this.terrainImage = this.add.image(0, 0, 'terrain').setOrigin(0, 0);
  }

  _drawTerrainToCanvas() {
    const ctx = this.terrainCtx;
    const w = WORLD_WIDTH;
    const h = WORLD_HEIGHT;

    ctx.clearRect(0, 0, w, h);

    // Draw terrain using ImageData for performance
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;

    for (let x = 0; x < w; x++) {
      const surfaceY = this.heightmap[x];
      for (let y = 0; y < h; y++) {
        if (this.terrainPixels[y * w + x] !== 1) continue;
        const i = (y * w + x) * 4;
        if (y === surfaceY) {
          // Grass top
          data[i] = 34; data[i+1] = 139; data[i+2] = 34; data[i+3] = 255;
        } else if (y <= surfaceY + 4) {
          // Sub-surface dirt (darker green transition)
          data[i] = 60; data[i+1] = 100; data[i+2] = 40; data[i+3] = 255;
        } else if (y <= surfaceY + 12) {
          // Top soil
          data[i] = 101; data[i+1] = 67; data[i+2] = 33; data[i+3] = 255;
        } else {
          // Deep ground with slight variation
          const v = (x * 3 + y * 7) % 20;
          data[i] = 120 + v - 10; data[i+1] = 85 + v - 8; data[i+2] = 50 + v - 5; data[i+3] = 255;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Refresh Phaser texture if it already exists
    if (this.textures.exists('terrain')) {
      this.textures.get('terrain').refresh();
    }
  }

  /**
   * Check if world pixel (x, y) is solid terrain.
   */
  isSolid(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= WORLD_WIDTH || iy < 0 || iy >= WORLD_HEIGHT) {
      return iy >= WORLD_HEIGHT; // Floor at bottom
    }
    return this.terrainPixels[iy * WORLD_WIDTH + ix] === 1;
  }

  /**
   * Destroy terrain in a circle.
   */
  digCircle(cx, cy, radius) {
    const r = Math.ceil(radius);
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(WORLD_WIDTH - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(WORLD_HEIGHT - 1, Math.ceil(cy + r));
    const r2 = radius * radius;

    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r2) {
          this.terrainPixels[y * WORLD_WIDTH + x] = 0;
        }
      }
    }

    // Also update heightmap in affected columns
    for (let x = x0; x <= x1; x++) {
      let newSurface = WORLD_HEIGHT;
      for (let y = 0; y < WORLD_HEIGHT; y++) {
        if (this.terrainPixels[y * WORLD_WIDTH + x] === 1) {
          newSurface = y;
          break;
        }
      }
      this.heightmap[x] = newSurface;
    }

    this._drawTerrainToCanvas();
  }

  // ─────────────────────────────────────────────
  // Worm Spawning
  // ─────────────────────────────────────────────

  _spawnWorms() {
    this.teams = [];
    this.allWorms = [];

    const totalWorms = this.teamsData.reduce((sum, t) => sum + t.worms.length, 0);
    const spacing = WORLD_WIDTH / (totalWorms + 1);
    let wormIndex = 0;

    for (let ti = 0; ti < this.teamsData.length; ti++) {
      const teamData = this.teamsData[ti];
      const team = {
        id: teamData.id,
        name: teamData.name,
        color: teamData.color,
        worms: [],
        ammo: { bazooka: Infinity, grenade: 3, mine: 2 },
      };

      for (let wi = 0; wi < teamData.worms.length; wi++) {
        const wormData = teamData.worms[wi];
        wormIndex++;
        const spawnX = spacing * wormIndex;
        const spawnY = this._findSpawnY(spawnX);

        const textureKey = ti === 0 ? 'worm-red' : 'worm-blue';
        const sprite = this.add.image(spawnX, spawnY, textureKey).setDepth(10);

        const worm = {
          id: wormData.id,
          name: wormData.name,
          team,
          teamIndex: ti,
          x: spawnX,
          y: spawnY,
          vx: 0,
          vy: 0,
          health: 100,
          alive: true,
          grounded: false,
          sprite,
          facing: 1,
          aimAngle: 0,
          aimIndicator: null,
          healthBarBg: null,
          healthBarFill: null,
          healthLabel: null,
          turnIndicator: null,
          wormIndex: wi,
        };

        this._createWormUI(worm);
        team.worms.push(worm);
        this.allWorms.push(worm);
      }

      this.teams.push(team);
    }
  }

  _findSpawnY(x) {
    const ix = Math.max(0, Math.min(WORLD_WIDTH - 1, Math.floor(x)));
    const surfaceY = findSurfaceY(this.terrainPixels, ix, WORLD_WIDTH, WORLD_HEIGHT);
    return surfaceY - WORM_RADIUS - 2;
  }

  _createWormUI(worm) {
    const depth = 20;

    // Aim indicator (dotted line / arrow)
    const aimGfx = this.add.graphics().setDepth(depth + 1);
    worm.aimIndicator = aimGfx;

    // Turn indicator arrow
    const turnGfx = this.add.graphics().setDepth(depth + 2);
    worm.turnIndicator = turnGfx;

    // Health bar background
    const hbBg = this.add.graphics().setDepth(depth);
    worm.healthBarBg = hbBg;

    // Health bar fill
    const hbFill = this.add.graphics().setDepth(depth + 1);
    worm.healthBarFill = hbFill;

    // Health label
    const hl = this.add.text(0, 0, '100', {
      fontFamily: 'Arial',
      fontSize: '10px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setDepth(depth + 2).setOrigin(0.5, 0.5);
    worm.healthLabel = hl;

    // Worm name label
    const nameLabel = this.add.text(0, 0, worm.name, {
      fontFamily: 'Arial',
      fontSize: '9px',
      color: '#dddddd',
      stroke: '#000000',
      strokeThickness: 2,
    }).setDepth(depth + 2).setOrigin(0.5, 1);
    worm.nameLabel = nameLabel;
  }

  // ─────────────────────────────────────────────
  // Camera
  // ─────────────────────────────────────────────

  _setupCamera() {
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setZoom(1);

    this.panMode = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.cameraPanning = false;
    this.cameraFollowing = true;
  }

  _followActiveWorm() {
    const worm = this._getActiveWorm();
    if (worm && this.cameraFollowing) {
      this.cameras.main.pan(worm.x, worm.y, 400, 'Sine.easeInOut');
    }
  }

  // ─────────────────────────────────────────────
  // Input
  // ─────────────────────────────────────────────

  _setupInput() {
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      fire: Phaser.Input.Keyboard.KeyCodes.SPACE,
      w1: Phaser.Input.Keyboard.KeyCodes.ONE,
      w2: Phaser.Input.Keyboard.KeyCodes.TWO,
      w3: Phaser.Input.Keyboard.KeyCodes.THREE,
      camLeft: Phaser.Input.Keyboard.KeyCodes.A,
      camRight: Phaser.Input.Keyboard.KeyCodes.D,
    });

    // Fire on spacebar
    this.input.keyboard.on('keydown-SPACE', () => {
      if (this._isMyTurn() && this.turnActive && !this.fired) {
        this._fire();
      }
    });

    // Weapon selection
    this.input.keyboard.on('keydown-ONE', () => { if (this._isMyTurn()) this._selectWeapon(0); });
    this.input.keyboard.on('keydown-TWO', () => { if (this._isMyTurn()) this._selectWeapon(1); });
    this.input.keyboard.on('keydown-THREE', () => { if (this._isMyTurn()) this._selectWeapon(2); });

    // Mouse/pointer for aiming
    this.input.on('pointermove', (pointer) => {
      if (this._isMyTurn() && this.turnActive) {
        const worm = this._getActiveWorm();
        if (worm) {
          const wx = pointer.worldX - worm.x;
          const wy = pointer.worldY - worm.y;
          this.aimAngle = Math.atan2(wy, wx);
          if (wx !== 0) worm.facing = wx > 0 ? 1 : -1;
          this._sendAction({ type: 'AIM', angle: this.aimAngle });
        }
      }
    });

    this.input.on('pointerdown', (pointer) => {
      if (pointer.button === 1) { // Middle mouse
        this.cameraPanning = true;
        this.panStartX = pointer.x + this.cameras.main.scrollX;
        this.panStartY = pointer.y + this.cameras.main.scrollY;
        this.cameraFollowing = false;
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (this.cameraPanning) {
        this.cameras.main.scrollX = this.panStartX - pointer.x;
        this.cameras.main.scrollY = this.panStartY - pointer.y;
      }
    });

    this.input.on('pointerup', (pointer) => {
      if (pointer.button === 1) {
        this.cameraPanning = false;
      }
    });

    // Scroll wheel zoom
    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      const zoom = this.cameras.main.zoom;
      const newZoom = Phaser.Math.Clamp(zoom - deltaY * 0.001, 0.5, 2.0);
      this.cameras.main.setZoom(newZoom);
    });
  }

  _handleMovementInput() {
    if (!this._isMyTurn() || !this.turnActive || this.fired) return;
    const worm = this._getActiveWorm();
    if (!worm || !worm.alive) return;

    let moved = false;
    let jumped = false;

    if (this.cursors.left.isDown) {
      worm.vx = -MOVE_SPEED;
      worm.facing = -1;
      moved = true;
    } else if (this.cursors.right.isDown) {
      worm.vx = MOVE_SPEED;
      worm.facing = 1;
      moved = true;
    } else {
      worm.vx *= 0.6;
    }

    if (this.cursors.up.isDown && worm.grounded) {
      worm.vy = JUMP_FORCE;
      worm.grounded = false;
      jumped = true;
    }

    // Aim control with W/S
    if (Phaser.Input.Keyboard.JustDown(this.wasd.up)) {
      this.aimAngle -= 0.1;
      this._sendAction({ type: 'AIM', angle: this.aimAngle });
    }
    if (Phaser.Input.Keyboard.JustDown(this.wasd.down)) {
      this.aimAngle += 0.1;
      this._sendAction({ type: 'AIM', angle: this.aimAngle });
    }

    // Camera pan during opponent turn
    if (!this._isMyTurn() || !this.cameraFollowing) {
      const camSpeed = 4;
      if (this.wasd.camLeft.isDown) this.cameras.main.scrollX -= camSpeed;
      if (this.wasd.camRight.isDown) this.cameras.main.scrollX += camSpeed;
    }

    if (moved) this._sendAction({ type: 'MOVE', dir: worm.vx > 0 ? 'right' : 'left' });
    if (jumped) this._sendAction({ type: 'JUMP' });
  }

  // ─────────────────────────────────────────────
  // Weapons
  // ─────────────────────────────────────────────

  _setupWeapons() {
    this.currentWeaponIndex = 0;
    this.aimAngle = 0;
    this.weaponAmmo = {};
    for (const key of WEAPON_ORDER) {
      this.weaponAmmo[key] = WEAPONS[key].ammo === Infinity ? Infinity : WEAPONS[key].ammo;
    }
  }

  _selectWeapon(index) {
    if (index >= 0 && index < WEAPON_ORDER.length) {
      this.currentWeaponIndex = index;
      this.events.emit('weaponChanged', WEAPON_ORDER[index]);
    }
  }

  get currentWeapon() {
    return WEAPONS[WEAPON_ORDER[this.currentWeaponIndex]];
  }

  _fire() {
    const worm = this._getActiveWorm();
    if (!worm || !worm.alive) return;

    const weapon = this.currentWeapon;
    const ammo = this.weaponAmmo[weapon.key];
    if (ammo !== Infinity && ammo <= 0) {
      this._selectWeapon(0); // Fall back to bazooka
      return;
    }

    if (ammo !== Infinity) {
      this.weaponAmmo[weapon.key]--;
    }

    this.fired = true;
    this.cameraFollowing = false;

    if (weapon.placed) {
      this._placeMine(worm.x, worm.y);
      this._sendAction({ type: 'PLACE_MINE', x: worm.x, y: worm.y });
      this.time.delayedCall(500, () => this._endTurn());
    } else {
      const vx = Math.cos(this.aimAngle) * weapon.speed;
      const vy = Math.sin(this.aimAngle) * weapon.speed;
      this._createProjectile(worm.x, worm.y, vx, vy, weapon, worm.teamIndex);

      this._sendAction({
        type: 'FIRE',
        weapon: weapon.key,
        angle: this.aimAngle,
        x: worm.x,
        y: worm.y,
      });
    }
  }

  _createProjectile(x, y, vx, vy, weapon, ownerTeamIndex) {
    const sprite = this.add.image(x, y, weapon.projectileKey).setDepth(15);

    const proj = {
      x, y, vx, vy,
      weapon,
      ownerTeamIndex,
      sprite,
      alive: true,
      fuseTimer: weapon.fuse ? this.time.now + weapon.fuse : null,
      trail: [],
    };

    this.projectiles.push(proj);

    // Start camera tracking projectile
    this.trackedProjectile = proj;

    return proj;
  }

  _placeMine(x, y) {
    const surfaceY = this._findGroundBelow(x, y);
    const sprite = this.add.image(x, surfaceY - 4, 'mine').setDepth(12);

    const mine = {
      x,
      y: surfaceY - 4,
      sprite,
      armed: false,
      alive: true,
      armTimer: this.time.now + WEAPONS.mine.armTime,
      pulseTime: 0,
      ownerTeamIndex: this.currentTeamIndex,
    };

    // Pulse indicator
    const indicator = this.add.graphics().setDepth(13);
    mine.indicator = indicator;

    this.mines.push(mine);
  }

  _findGroundBelow(x, startY) {
    const ix = Math.max(0, Math.min(WORLD_WIDTH - 1, Math.floor(x)));
    for (let y = Math.floor(startY); y < WORLD_HEIGHT; y++) {
      if (this.terrainPixels[y * WORLD_WIDTH + ix] === 1) return y;
    }
    return WORLD_HEIGHT - 1;
  }

  // ─────────────────────────────────────────────
  // Turn Manager
  // ─────────────────────────────────────────────

  _setupTurnManager() {
    this.currentTeamIndex = 0;
    this.currentWormIndex = 0;
    this.turnStartTime = 0;
    this.turnTimer = TURN_DURATION;
    this.wind = this._randomWind();
    this.turnCount = 0;
  }

  _randomWind() {
    return (Math.random() - 0.5) * 10;
  }

  _getActiveWorm() {
    const team = this.teams[this.currentTeamIndex];
    if (!team) return null;
    return team.worms[this.currentWormIndex] || null;
  }

  _isMyTurn() {
    return this.currentTeamIndex === this.myTeamIndex;
  }

  _startTurn() {
    this.turnActive = true;
    this.fired = false;
    this.trackedProjectile = null;
    this.cameraFollowing = true;
    this.aiThinking = false;

    // New wind each turn
    this.wind = this._randomWind();

    const worm = this._getActiveWorm();
    if (!worm) { this._nextTurn(); return; }

    this.turnStartTime = this.time.now;

    // Reset worm velocity
    worm.vx = 0;
    worm.vy = 0;

    this._followActiveWorm();

    this.events.emit('turnStart', {
      teamIndex: this.currentTeamIndex,
      worm,
      wind: this.wind,
      duration: TURN_DURATION,
      isMyTurn: this._isMyTurn(),
    });

    // Reset weapon to bazooka for new turn
    this._selectWeapon(0);

    // AI turn?
    if (this.isSinglePlayer && !this._isMyTurn()) {
      this._scheduleAITurn(worm);
    }
  }

  _scheduleAITurn(worm) {
    if (this.aiThinking) return;
    this.aiThinking = true;
    this.time.delayedCall(AI_THINK_DELAY, () => {
      if (this.gameOver || !this.turnActive) return;
      this._doAIAction(worm);
    });
  }

  _doAIAction(worm) {
    if (this.gameOver || !this.turnActive || this.fired) return;

    // Find closest enemy worm
    const enemies = this.teams
      .filter((_, i) => i !== this.currentTeamIndex)
      .flatMap(t => t.worms.filter(w => w.alive));

    if (enemies.length === 0) { this._endTurn(); return; }

    const target = enemies.reduce((best, w) => {
      const d = Math.hypot(w.x - worm.x, w.y - worm.y);
      return d < Math.hypot(best.x - worm.x, best.y - worm.y) ? w : best;
    }, enemies[0]);

    // Move towards target a bit
    const dx = target.x - worm.x;
    const moveSteps = Math.min(3, Math.floor(Math.abs(dx) / 40));

    let step = 0;
    const moveTimer = this.time.addEvent({
      delay: 120,
      repeat: moveSteps,
      callback: () => {
        if (!this.turnActive || this.fired || this.gameOver) {
          moveTimer.remove();
          return;
        }
        worm.vx = dx > 0 ? MOVE_SPEED : -MOVE_SPEED;
        worm.facing = dx > 0 ? 1 : -1;
        step++;
        if (step >= moveSteps) {
          worm.vx = 0;
          this.time.delayedCall(300, () => this._aiFireAtTarget(worm, target));
        }
      },
    });
  }

  _aiFireAtTarget(worm, target) {
    if (this.gameOver || !this.turnActive || this.fired) return;

    const dx = target.x - worm.x;
    const dy = target.y - worm.y;
    const dist = Math.hypot(dx, dy);

    // Add some inaccuracy
    const spread = (Math.random() - 0.5) * 0.4;

    // Simple ballistic aim (ignoring wind for AI)
    this.aimAngle = Math.atan2(dy - dist * 0.1, dx) + spread;

    this._fire();
    this.time.delayedCall(200, () => this._endTurn());
  }

  _endTurn() {
    if (!this.turnActive) return;
    this.turnActive = false;
    this.fired = false;
    this.trackedProjectile = null;

    // Wait for projectiles to settle
    const checkSettle = () => {
      if (this.projectiles.some(p => p.alive)) {
        this.time.delayedCall(200, checkSettle);
      } else {
        this._checkGameOver();
        if (!this.gameOver) {
          this.time.delayedCall(600, () => this._nextTurn());
        }
      }
    };
    this.time.delayedCall(300, checkSettle);
  }

  _nextTurn() {
    this.turnCount++;

    // Advance turn order: Team0 W0 → Team1 W0 → Team0 W1 → Team1 W1 → ...
    const totalTeams = this.teams.length;
    const maxWormsPerTeam = Math.max(...this.teams.map(t => t.worms.length));

    let found = false;
    let tries = 0;
    const maxTries = totalTeams * maxWormsPerTeam * 2;

    while (!found && tries < maxTries) {
      // Advance
      this.currentTeamIndex = (this.currentTeamIndex + 1) % totalTeams;
      if (this.currentTeamIndex === 0) {
        this.currentWormIndex = (this.currentWormIndex + 1) % maxWormsPerTeam;
      }

      const team = this.teams[this.currentTeamIndex];
      if (!team) { tries++; continue; }

      const wi = this.currentWormIndex % team.worms.length;
      this.currentWormIndex = wi;
      const worm = team.worms[wi];

      if (worm && worm.alive) {
        found = true;
      }
      tries++;
    }

    if (!found) {
      this._checkGameOver();
      return;
    }

    this._startTurn();
  }

  _checkGameOver() {
    const aliveTeams = this.teams.filter(t => t.worms.some(w => w.alive));
    if (aliveTeams.length <= 1) {
      this.gameOver = true;
      const winner = aliveTeams[0] || null;
      this.events.emit('gameOver', { winner });
      this._showGameOverScreen(winner);
      return true;
    }
    return false;
  }

  _showGameOverScreen(winner) {
    const cam = this.cameras.main;
    const cx = cam.scrollX + cam.width / 2;
    const cy = cam.scrollY + cam.height / 2;

    const panel = this.add.graphics().setDepth(100);
    panel.fillStyle(0x000000, 0.7);
    panel.fillRoundedRect(cx - 200, cy - 80, 400, 160, 16);

    const title = winner
      ? `${winner.name} WINS!`
      : 'DRAW!';

    this.add.text(cx, cy - 30, title, {
      fontFamily: 'Arial Black',
      fontSize: '36px',
      color: '#e8c86d',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(101).setScrollFactor(0);

    this.add.text(cx, cy + 20, 'Press R to restart', {
      fontFamily: 'Arial',
      fontSize: '18px',
      color: '#ffffff',
    }).setOrigin(0.5).setDepth(101).setScrollFactor(0);

    this.input.keyboard.once('keydown-R', () => {
      this.scene.stop('UIScene');
      this.scene.stop('GameScene');
      this.scene.start('MenuScene');
    });
  }

  // ─────────────────────────────────────────────
  // Physics Update
  // ─────────────────────────────────────────────

  update(time, delta) {
    if (this.gameOver) return;

    this._handleMovementInput();
    this._updateWorms(delta);
    this._updateProjectiles(delta);
    this._updateMines(time);
    this._updateWormUI();
    this._updateTimerBar(time);
    this._cleanupParticles();

    // Camera follow projectile if active
    if (this.trackedProjectile && this.trackedProjectile.alive) {
      this.cameras.main.pan(
        this.trackedProjectile.x,
        this.trackedProjectile.y,
        100,
        'Linear'
      );
    }
  }

  _updateWorms(delta) {
    for (const worm of this.allWorms) {
      if (!worm.alive) continue;

      // Gravity
      worm.vy += GRAVITY;

      // Move
      worm.x += worm.vx;
      worm.y += worm.vy;

      // Terrain collision (feet at worm.y + WORM_RADIUS)
      const feetY = worm.y + WORM_RADIUS;
      if (this.isSolid(worm.x, feetY)) {
        // Find exact surface
        let surfaceY = Math.floor(feetY);
        while (surfaceY > 0 && this.isSolid(worm.x, surfaceY - 1)) {
          surfaceY--;
        }
        worm.y = surfaceY - WORM_RADIUS;
        if (worm.vy > 0) {
          // Landing impact
          if (worm.vy > 8) {
            const fallDamage = Math.floor((worm.vy - 8) * 3);
            if (fallDamage > 0) this._applyDamageToWorm(worm, fallDamage, false);
          }
          worm.vy = 0;
        }
        worm.vx *= 0.75;
        worm.grounded = true;
      } else {
        worm.grounded = false;
      }

      // Side terrain collision
      if (this.isSolid(worm.x + worm.facing * WORM_RADIUS, worm.y)) {
        worm.vx = 0;
        // Try to step up
        if (!this.isSolid(worm.x + worm.facing * WORM_RADIUS, worm.y - 8)) {
          worm.y -= 3;
        }
      }

      // World bounds
      worm.x = Phaser.Math.Clamp(worm.x, WORM_RADIUS, WORLD_WIDTH - WORM_RADIUS);

      // Fell off bottom = death
      if (worm.y > WORLD_HEIGHT + 50) {
        this._killWorm(worm, true);
      }

      // Update sprite position
      worm.sprite.setPosition(worm.x, worm.y);
      worm.sprite.setFlipX(worm.facing < 0);
    }
  }

  _updateProjectiles(delta) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      if (!proj.alive) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Save trail point
      proj.trail.push({ x: proj.x, y: proj.y });
      if (proj.trail.length > 12) proj.trail.shift();

      // Wind and gravity
      proj.vx += this.wind * proj.weapon.windFactor * 0.01;
      proj.vy += proj.weapon.gravity;

      proj.x += proj.vx;
      proj.y += proj.vy;

      // Rotate sprite to face velocity direction
      proj.sprite.setRotation(Math.atan2(proj.vy, proj.vx));
      proj.sprite.setPosition(proj.x, proj.y);

      // Draw trail
      this._drawProjectileTrail(proj);

      // Fuse check (grenade)
      if (proj.weapon.fuse && this.time.now >= proj.fuseTimer) {
        this._explode(proj.x, proj.y, proj.weapon, proj.ownerTeamIndex);
        this._destroyProjectile(proj, i);
        continue;
      }

      // Terrain collision
      if (this.isSolid(proj.x, proj.y) || proj.y >= WORLD_HEIGHT) {
        this._explode(proj.x, proj.y, proj.weapon, proj.ownerTeamIndex);
        this._destroyProjectile(proj, i);
        continue;
      }

      // Worm collision
      for (const worm of this.allWorms) {
        if (!worm.alive) continue;
        if (worm.teamIndex === proj.ownerTeamIndex && !proj.weapon.fuse) continue;
        const dist = Math.hypot(proj.x - worm.x, proj.y - worm.y);
        if (dist < WORM_RADIUS + 6) {
          this._explode(proj.x, proj.y, proj.weapon, proj.ownerTeamIndex);
          this._destroyProjectile(proj, i);
          break;
        }
      }

      // Out of world bounds
      if (proj.x < -100 || proj.x > WORLD_WIDTH + 100 || proj.y < -500) {
        this._destroyProjectile(proj, i);
      }
    }
  }

  _drawProjectileTrail(proj) {
    // Clean up old trail graphics
    if (proj.trailGraphics) {
      proj.trailGraphics.clear();
    } else {
      proj.trailGraphics = this.add.graphics().setDepth(14);
    }

    const gfx = proj.trailGraphics;
    for (let j = 0; j < proj.trail.length; j++) {
      const alpha = (j / proj.trail.length) * 0.6;
      const size = (j / proj.trail.length) * 3;
      gfx.fillStyle(0xffaa00, alpha);
      gfx.fillCircle(proj.trail[j].x, proj.trail[j].y, size);
    }
  }

  _destroyProjectile(proj, index) {
    proj.alive = false;
    proj.sprite.destroy();
    if (proj.trailGraphics) {
      proj.trailGraphics.destroy();
    }
    if (this.trackedProjectile === proj) {
      this.trackedProjectile = null;
      this.cameraFollowing = true;
    }
  }

  _updateMines(time) {
    for (const mine of this.mines) {
      if (!mine.alive) continue;

      if (!mine.armed && time >= mine.armTimer) {
        mine.armed = true;
      }

      // Pulse indicator
      if (mine.indicator) {
        mine.indicator.clear();
        if (mine.armed) {
          const pulse = 0.5 + 0.5 * Math.sin(time * 0.005);
          mine.indicator.lineStyle(2, 0xff0000, pulse);
          mine.indicator.strokeCircle(mine.x, mine.y, 14 + pulse * 4);
        } else {
          mine.indicator.lineStyle(1, 0xffff00, 0.5);
          mine.indicator.strokeCircle(mine.x, mine.y, 10);
        }
      }

      if (!mine.armed) continue;

      // Trigger check
      for (const worm of this.allWorms) {
        if (!worm.alive) continue;
        // Don't trigger on owner team immediately (only after armed)
        const dist = Math.hypot(worm.x - mine.x, worm.y - mine.y);
        if (dist < WEAPONS.mine.triggerRadius) {
          this._explode(mine.x, mine.y, WEAPONS.mine, mine.ownerTeamIndex);
          mine.alive = false;
          mine.sprite.destroy();
          if (mine.indicator) mine.indicator.destroy();
          break;
        }
      }
    }

    // Remove dead mines
    this.mines = this.mines.filter(m => m.alive);
  }

  // ─────────────────────────────────────────────
  // Explosion
  // ─────────────────────────────────────────────

  _explode(cx, cy, weapon, ownerTeamIndex) {
    const radius = weapon.explodeRadius;

    // Dig terrain
    this.digCircle(cx, cy, radius);

    // Camera shake
    this.cameras.main.shake(300, 0.012);

    // Damage worms
    for (const worm of this.allWorms) {
      if (!worm.alive) continue;
      const dist = Math.hypot(worm.x - cx, worm.y - cy);
      if (dist < radius + WORM_RADIUS) {
        const falloff = 1 - Math.max(0, (dist - WORM_RADIUS) / radius);
        const dmg = Math.round(weapon.damage * falloff);
        if (dmg > 0) {
          // Knockback
          const angle = Math.atan2(worm.y - cy, worm.x - cx);
          worm.vx += Math.cos(angle) * falloff * 8;
          worm.vy += Math.sin(angle) * falloff * 8 - 3;
          this._applyDamageToWorm(worm, dmg, true);
        }
      }
    }

    // Explosion sprite
    this._spawnExplosionEffect(cx, cy, radius);

    // Spawn dirt particles
    this._spawnDirtParticles(cx, cy, radius);
  }

  _spawnExplosionEffect(cx, cy, radius) {
    const sprite = this.add.image(cx, cy, 'explosion')
      .setScale(radius / 32)
      .setDepth(50)
      .setAlpha(1);

    this.tweens.add({
      targets: sprite,
      scaleX: (radius / 32) * 2.5,
      scaleY: (radius / 32) * 2.5,
      alpha: 0,
      duration: 500,
      ease: 'Power2',
      onComplete: () => sprite.destroy(),
    });
  }

  _spawnDirtParticles(cx, cy, radius) {
    const count = Math.min(20, Math.floor(radius * 0.6));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      const gfx = this.add.graphics().setDepth(30);
      const px = { x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 3, alpha: 1 };

      const update = () => {
        if (!this.scene.isActive()) return;
        px.vy += 0.3;
        px.x += px.vx;
        px.y += px.vy;
        px.alpha -= 0.03;

        gfx.clear();
        if (px.alpha > 0) {
          const brown = Math.random() < 0.5 ? 0x8B5E3C : 0x228B22;
          gfx.fillStyle(brown, px.alpha);
          gfx.fillRect(px.x - 2, px.y - 2, 4, 4);
          this.time.delayedCall(30, update);
        } else {
          gfx.destroy();
        }
      };
      this.time.delayedCall(Math.random() * 100, update);
    }
  }

  _applyDamageToWorm(worm, damage, knockback) {
    worm.health = Math.max(0, worm.health - damage);

    // Floating damage number
    const dmgText = this.add.text(worm.x, worm.y - 20, `-${damage}`, {
      fontFamily: 'Arial Black',
      fontSize: '14px',
      color: '#ff4444',
      stroke: '#000000',
      strokeThickness: 3,
    }).setDepth(60).setOrigin(0.5);

    this.tweens.add({
      targets: dmgText,
      y: dmgText.y - 30,
      alpha: 0,
      duration: 800,
      onComplete: () => dmgText.destroy(),
    });

    if (worm.health <= 0) {
      this._killWorm(worm, false);
    }
  }

  _killWorm(worm, drowned) {
    worm.alive = false;
    worm.health = 0;
    worm.sprite.setAlpha(0.3);
    worm.sprite.setTint(0x444444);

    // Death animation
    if (!drowned) {
      this._spawnExplosionEffect(worm.x, worm.y, 20);
      this.cameras.main.shake(200, 0.008);
    }

    // Death label
    const deathText = this.add.text(worm.x, worm.y - 30, drowned ? 'DROWNED!' : 'KO!', {
      fontFamily: 'Arial Black',
      fontSize: '18px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setDepth(70).setOrigin(0.5);

    this.tweens.add({
      targets: deathText,
      y: deathText.y - 50,
      alpha: 0,
      duration: 1500,
      onComplete: () => deathText.destroy(),
    });

    this.events.emit('wormDied', { worm });
  }

  // ─────────────────────────────────────────────
  // HUD Updates
  // ─────────────────────────────────────────────

  _updateWormUI() {
    const activeWorm = this._getActiveWorm();

    for (const worm of this.allWorms) {
      if (!worm.alive) {
        this._hideWormUI(worm);
        continue;
      }

      const isActive = worm === activeWorm;
      const wx = worm.x;
      const wy = worm.y;

      // Health bar
      const barW = 32, barH = 4;
      const barX = wx - barW / 2;
      const barY = wy - WORM_RADIUS - 14;

      worm.healthBarBg.clear();
      worm.healthBarBg.fillStyle(0x000000, 0.6);
      worm.healthBarBg.fillRect(barX - 1, barY - 1, barW + 2, barH + 2);

      const hpPct = worm.health / 100;
      const barColor = hpPct > 0.5 ? 0x44cc44 : hpPct > 0.25 ? 0xffcc00 : 0xff4444;

      worm.healthBarFill.clear();
      worm.healthBarFill.fillStyle(barColor, 1);
      worm.healthBarFill.fillRect(barX, barY, Math.round(barW * hpPct), barH);

      worm.healthLabel.setPosition(wx, wy - WORM_RADIUS - 20);
      worm.healthLabel.setText(Math.ceil(worm.health).toString());

      worm.nameLabel.setPosition(wx, wy - WORM_RADIUS - 26);

      // Turn indicator
      worm.turnIndicator.clear();
      if (isActive) {
        const bounce = Math.sin(this.time.now * 0.004) * 3;
        worm.turnIndicator.fillStyle(0xffffff, 1);
        worm.turnIndicator.fillTriangle(
          wx, wy - WORM_RADIUS - 36 + bounce,
          wx - 6, wy - WORM_RADIUS - 46 + bounce,
          wx + 6, wy - WORM_RADIUS - 46 + bounce
        );

        // Aim indicator
        if (this._isMyTurn() && this.turnActive) {
          this._drawAimIndicator(worm);
        } else {
          worm.aimIndicator.clear();
        }
      } else {
        worm.aimIndicator.clear();
      }
    }
  }

  _drawAimIndicator(worm) {
    worm.aimIndicator.clear();
    worm.aimIndicator.lineStyle(2, 0xffff00, 0.8);

    const len = 60;
    const dots = 8;
    for (let i = 0; i < dots; i++) {
      const t = (i + 0.5) / dots;
      const ex = worm.x + Math.cos(this.aimAngle) * len * t;
      const ey = worm.y + Math.sin(this.aimAngle) * len * t;
      const size = 1.5 + t;
      worm.aimIndicator.fillStyle(0xffff00, 0.8 - t * 0.5);
      worm.aimIndicator.fillCircle(ex, ey, size);
    }

    // Arrow tip
    const tipX = worm.x + Math.cos(this.aimAngle) * len;
    const tipY = worm.y + Math.sin(this.aimAngle) * len;
    const perpAngle = this.aimAngle + Math.PI / 2;
    worm.aimIndicator.fillStyle(0xffff00, 0.9);
    worm.aimIndicator.fillTriangle(
      tipX, tipY,
      tipX - Math.cos(this.aimAngle) * 10 + Math.cos(perpAngle) * 5,
      tipY - Math.sin(this.aimAngle) * 10 + Math.sin(perpAngle) * 5,
      tipX - Math.cos(this.aimAngle) * 10 - Math.cos(perpAngle) * 5,
      tipY - Math.sin(this.aimAngle) * 10 - Math.sin(perpAngle) * 5
    );
  }

  _hideWormUI(worm) {
    worm.healthBarBg.clear();
    worm.healthBarFill.clear();
    worm.turnIndicator.clear();
    worm.aimIndicator.clear();
    worm.healthLabel.setText('');
    worm.nameLabel.setText('');
  }

  _updateTimerBar(time) {
    if (!this.turnActive) return;

    const elapsed = time - this.turnStartTime;
    const remaining = Math.max(0, TURN_DURATION - elapsed);
    const pct = remaining / TURN_DURATION;

    this.events.emit('timerUpdate', { remaining, pct });

    // Auto end turn when time runs out
    if (remaining <= 0 && this._isMyTurn()) {
      if (!this.fired) {
        this._endTurn();
      }
    } else if (remaining <= 0 && this.isSinglePlayer && !this._isMyTurn()) {
      if (!this.fired && !this.aiThinking) {
        this._endTurn();
      }
    }
  }

  _cleanupParticles() {
    // Particles self-manage via tweens; no-op here
  }

  // ─────────────────────────────────────────────
  // Networking
  // ─────────────────────────────────────────────

  _setupNetworking() {
    if (!this.wsClient) return;

    this.wsClient.on('remote_action', (msg) => {
      this._applyRemoteAction(msg.playerId, msg.data);
    });

    this.wsClient.on('disconnect', () => {
      this.events.emit('networkStatus', { connected: false });
    });

    // Ping keepalive
    this._pingTimer = this.time.addEvent({
      delay: 15000,
      loop: true,
      callback: () => this.wsClient?.send({ type: 'ping' }),
    });
  }

  _sendAction(data) {
    if (!this.wsClient || !this.gameData.roomId) return;
    this.wsClient.send({
      type: 'action',
      roomId: this.gameData.roomId,
      data,
    });
  }

  _applyRemoteAction(playerId, data) {
    const worm = this._getActiveWorm();
    if (!worm) return;

    switch (data.type) {
      case 'MOVE':
        worm.vx = data.dir === 'right' ? MOVE_SPEED : -MOVE_SPEED;
        worm.facing = data.dir === 'right' ? 1 : -1;
        break;

      case 'JUMP':
        if (worm.grounded) {
          worm.vy = JUMP_FORCE;
          worm.grounded = false;
        }
        break;

      case 'AIM':
        this.aimAngle = data.angle;
        break;

      case 'FIRE': {
        const weapon = WEAPONS[data.weapon] || WEAPONS.bazooka;
        const vx = Math.cos(data.angle) * weapon.speed;
        const vy = Math.sin(data.angle) * weapon.speed;
        this.aimAngle = data.angle;
        this._createProjectile(data.x, data.y, vx, vy, weapon, this.currentTeamIndex);
        this.fired = true;
        break;
      }

      case 'PLACE_MINE':
        this._placeMine(data.x, data.y);
        this.fired = true;
        break;

      case 'END_TURN':
        this._endTurn();
        break;
    }
  }

  // ─────────────────────────────────────────────
  // Event Bridge to UIScene
  // ─────────────────────────────────────────────

  _setupEventBridge() {
    // UIScene listens to GameScene events via scene.events
    // Events: turnStart, timerUpdate, wormDied, gameOver, weaponChanged, networkStatus
  }

  // ─────────────────────────────────────────────
  // Cleanup
  // ─────────────────────────────────────────────

  shutdown() {
    if (this._pingTimer) this._pingTimer.remove();
    if (this.wsClient) {
      this.wsClient.disconnect();
    }
  }
}
