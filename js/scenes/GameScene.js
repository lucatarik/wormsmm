import { generateHeightmap, buildTerrainPixels, findSurfaceY } from '../utils/terrain-gen.js';
import { mulberry32 } from '../utils/rng.js';

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 500;
const GRAVITY = 0.32;         // px/frame (legacy, used for networking compat)
const WORM_RADIUS = 10;
const PTM      = 30;          // pixels → metres
const INV_PTM  = 1 / PTM;
const PHYS_FPS = 60;          // reference fps for px/frame ↔ m/s conversions
// Planck gravity (m/s²) = GRAVITY px/frame² → m/s² = GRAVITY * PHYS_FPS² * INV_PTM
const PLANCK_G = GRAVITY * PHYS_FPS * PHYS_FPS * INV_PTM; // ≈ 38.4 m/s²
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
  cluster: {
    name: 'Cluster',
    key: 'cluster',
    speed: 11,
    gravity: 0.18,
    windFactor: 0.5,
    explodeRadius: 30,
    damage: 20,
    fuse: 2500,
    projectileKey: 'projectile-grenade',
    ammo: 2,
    isCluster: true,
  },
  shotgun: {
    name: 'Shotgun',
    key: 'shotgun',
    speed: 15,
    gravity: 0.3,
    windFactor: 0.1,
    explodeRadius: 25,
    damage: 15,
    fuse: null,
    projectileKey: 'projectile-bazooka',
    ammo: 2,
    pellets: 6,
    spread: 0.25,
  },
  airstrike: {
    name: 'Air Strike',
    key: 'airstrike',
    speed: 0,
    gravity: 0,
    windFactor: 0,
    explodeRadius: 55,
    damage: 45,
    fuse: null,
    projectileKey: 'projectile-bazooka',
    ammo: 1,
    isAirstrike: true,
  },
  dynamite: {
    name: 'Dynamite',
    key: 'dynamite',
    placed: true,
    explodeRadius: 70,
    damage: 60,
    armTime: 5000,
    triggerRadius: 0,
    projectileKey: 'mine',
    ammo: 1,
    fuse: 5000,
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
  hook: {
    name: 'Hook',
    key: 'hook',
    isHook: true,
    ammo: Infinity,
  },
  bat: {
    name: 'Baseball Bat',
    key: 'bat',
    isMelee: true,
    range: 48,       // px
    damage: 30,
    knockback: 16,   // px/frame — strong horizontal launch
    ammo: Infinity,
  },
};

const WEAPON_ORDER = ['bazooka', 'grenade', 'cluster', 'shotgun', 'airstrike', 'dynamite', 'mine', 'bat'];

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
    this._buildTerrainBody();
    this._spawnWorms();
    this._setupCamera();
    this._setupInput();
    this._setupWeapons();
    this._setupTurnManager();
    this._setupNetworking();
    this._setupEventBridge();

    // Hook state
    this._hook = { active: false, x: 0, y: 0, vx: 0, vy: 0, attached: false, sprite: null, ropeGfx: null };

    // Start first turn
    this._startTurn();

    // Ensure the canvas has keyboard focus (DOM inputs from MenuScene steal it)
    const canvas = this.game.canvas;
    canvas.setAttribute('tabindex', '1');
    canvas.style.outline = 'none';
    canvas.focus();
    // Re-focus whenever the player clicks the canvas
    this.input.on('pointerdown', () => canvas.focus());
  }

  // ─────────────────────────────────────────────
  // World Setup
  // ─────────────────────────────────────────────

  _setupWorld() {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    // Planck physics world — no global gravity (applied manually per body)
    this.physWorld = planck.World(planck.Vec2(0, 0));
    this._terrainBody = null;

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

    // Create a regular HTMLCanvasElement (OffscreenCanvas not supported by Phaser textures.addCanvas)
    this.terrainCanvas = document.createElement('canvas');
    this.terrainCanvas.width  = WORLD_WIDTH;
    this.terrainCanvas.height = WORLD_HEIGHT;
    this.terrainCtx = this.terrainCanvas.getContext('2d');

    this._drawTerrainToCanvas();

    // Register as Phaser CanvasTexture and keep reference for refresh
    this._terrainTexture = this.textures.addCanvas('terrain', this.terrainCanvas);

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

    // Refresh Phaser CanvasTexture
    if (this._terrainTexture) {
      this._terrainTexture.refresh();
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
    // Rebuild Planck terrain body after destruction
    if (this.physWorld) this._buildTerrainBody();
  }

  /**
   * Build (or rebuild) a static Planck body matching the current heightmap.
   * Called once on create and again after every explosion that digs terrain.
   */
  _buildTerrainBody() {
    if (this._terrainBody) {
      this.physWorld.destroyBody(this._terrainBody);
      this._terrainBody = null;
    }

    const body = this.physWorld.createBody({ type: 'static' });

    // Sample heightmap every 6 px → ≈400 vertices (well within Planck limits)
    const STEP = 6;
    const verts = [];
    for (let x = 0; x <= WORLD_WIDTH; x += STEP) {
      const xi = Math.min(x, WORLD_WIDTH - 1);
      verts.push(planck.Vec2(xi * INV_PTM, this.heightmap[xi] * INV_PTM));
    }

    // Open chain for the terrain surface
    body.createFixture({ shape: planck.Chain(verts, false), friction: 0.5 });

    // Solid floor
    body.createFixture({
      shape: planck.Edge(
        planck.Vec2(0, WORLD_HEIGHT * INV_PTM),
        planck.Vec2(WORLD_WIDTH * INV_PTM, WORLD_HEIGHT * INV_PTM),
      ), friction: 0.5,
    });

    // Side walls
    body.createFixture({
      shape: planck.Edge(planck.Vec2(0, 0), planck.Vec2(0, WORLD_HEIGHT * INV_PTM)),
    });
    body.createFixture({
      shape: planck.Edge(
        planck.Vec2(WORLD_WIDTH * INV_PTM, 0),
        planck.Vec2(WORLD_WIDTH * INV_PTM, WORLD_HEIGHT * INV_PTM),
      ),
    });

    this._terrainBody = body;
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
        ammo: { bazooka: Infinity, grenade: 3, cluster: 2, shotgun: 2, airstrike: 1, dynamite: 1, mine: 2 },
      };

      for (let wi = 0; wi < teamData.worms.length; wi++) {
        const wormData = teamData.worms[wi];
        wormIndex++;
        const spawnX = spacing * wormIndex;
        const spawnY = this._findSpawnY(spawnX);

        const textureKey = ti === 0 ? 'worm-red' : 'worm-blue';
        const sprite = this.add.image(spawnX, spawnY, textureKey).setDepth(10);

        // Planck rigid body for this worm
        const wormBody = this.physWorld.createBody({
          type: 'dynamic',
          position: planck.Vec2(spawnX * INV_PTM, spawnY * INV_PTM),
          fixedRotation: true,
          linearDamping: 0.1,
        });
        wormBody.createFixture({
          shape: planck.Circle(WORM_RADIUS * INV_PTM),
          density: 1,
          friction: 0.5,
          restitution: 0.05,
        });

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
          body: wormBody,     // Planck body reference
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

  _updateCameraEdgeScroll() {
    if (this.cameraPanning) return;

    const cam    = this.cameras.main;
    const W      = cam.width;
    const H      = cam.height;
    const MARGIN = 80;   // px from edge to start scrolling
    const SPEED  = 7;

    // Worm auto-follow when it's near the edge
    const worm = this._getActiveWorm();
    if (worm?.alive && this.cameraFollowing) {
      const sx = (worm.x - cam.scrollX) * cam.zoom;
      const sy = (worm.y - cam.scrollY) * cam.zoom;
      if (sx < 160) cam.scrollX -= SPEED;
      else if (sx > W - 160) cam.scrollX += SPEED;
      if (sy < 120) cam.scrollY -= SPEED;
      else if (sy > H - 120) cam.scrollY += SPEED;
    }

    // Mouse cursor edge-scroll (always active)
    const ptr = this.input.activePointer;
    if (ptr) {
      if (ptr.x < MARGIN)     cam.scrollX -= SPEED;
      else if (ptr.x > W - MARGIN) cam.scrollX += SPEED;
    }

    // Clamp to world bounds
    cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, WORLD_WIDTH  - W / cam.zoom);
    cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, WORLD_HEIGHT - H / cam.zoom);
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
      w4: Phaser.Input.Keyboard.KeyCodes.FOUR,
      w5: Phaser.Input.Keyboard.KeyCodes.FIVE,
      w6: Phaser.Input.Keyboard.KeyCodes.SIX,
      w7: Phaser.Input.Keyboard.KeyCodes.SEVEN,
      camLeft: Phaser.Input.Keyboard.KeyCodes.A,
      camRight: Phaser.Input.Keyboard.KeyCodes.D,
      hookKey: Phaser.Input.Keyboard.KeyCodes.G,
    });

    // Fire on spacebar
    this.input.keyboard.on('keydown-SPACE', () => {
      if (!this._isMyTurn() || !this.turnActive || this.fired) return;
      const weapon = this.currentWeapon;
      if (weapon && weapon.isHook) {
        this._fireHook();
      } else {
        this._fire();
      }
    });

    // Weapon selection keys 1-7
    this.input.keyboard.on('keydown-ONE',   () => { if (this._isMyTurn()) this._selectWeapon(0); });
    this.input.keyboard.on('keydown-TWO',   () => { if (this._isMyTurn()) this._selectWeapon(1); });
    this.input.keyboard.on('keydown-THREE', () => { if (this._isMyTurn()) this._selectWeapon(2); });
    this.input.keyboard.on('keydown-FOUR',  () => { if (this._isMyTurn()) this._selectWeapon(3); });
    this.input.keyboard.on('keydown-FIVE',  () => { if (this._isMyTurn()) this._selectWeapon(4); });
    this.input.keyboard.on('keydown-SIX',   () => { if (this._isMyTurn()) this._selectWeapon(5); });
    this.input.keyboard.on('keydown-SEVEN', () => { if (this._isMyTurn()) this._selectWeapon(6); });
    this.input.keyboard.on('keydown-EIGHT', () => { if (this._isMyTurn()) this._selectWeapon(7); });

    // G key for hook
    this.input.keyboard.on('keydown-G', () => {
      if (this._isMyTurn() && this.turnActive) {
        this._fireHook();
      }
    });

    // Cycle weapons with Q/E
    this.input.keyboard.on('keydown-Q', () => {
      if (this._isMyTurn()) {
        this._selectWeapon((this.currentWeaponIndex - 1 + WEAPON_ORDER.length) % WEAPON_ORDER.length);
      }
    });
    this.input.keyboard.on('keydown-E', () => {
      if (this._isMyTurn()) {
        this._selectWeapon((this.currentWeaponIndex + 1) % WEAPON_ORDER.length);
      }
    });

    // Mouse/pointer for aiming — updates local aimAngle only; SYNC in update() handles network
    this.input.on('pointermove', (pointer) => {
      if (this._isMyTurn() && this.turnActive) {
        const worm = this._getActiveWorm();
        if (worm) {
          const wx = pointer.worldX - worm.x;
          const wy = pointer.worldY - worm.y;
          this.aimAngle = Math.atan2(wy, wx);
          if (wx !== 0) worm.facing = wx > 0 ? 1 : -1;
        }
      }
    });

    // Disable right-click context menu on canvas
    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.input.on('pointerdown', (pointer) => {
      // Left click → fire
      if (pointer.button === 0) {
        if (this._isMyTurn() && this.turnActive && !this.fired) {
          const weapon = this.currentWeapon;
          if (weapon?.isHook) this._fireHook(); else this._fire();
        }
      }
      // Middle click → hook
      if (pointer.button === 1) {
        if (this._isMyTurn() && this.turnActive) {
          this._fireHook();
        } else {
          // pan fallback when not in turn
          this.cameraPanning = true;
          this.panStartX = pointer.x + this.cameras.main.scrollX;
          this.panStartY = pointer.y + this.cameras.main.scrollY;
          this.cameraFollowing = false;
        }
      }
      // Right click → jump
      if (pointer.button === 2) {
        if (this._isMyTurn() && this.turnActive && !this.fired) {
          const worm = this._getActiveWorm();
          if (worm?.alive && worm.grounded) {
            const jumpVel = JUMP_FORCE * INV_PTM * PHYS_FPS;
            const cv = worm.body.getLinearVelocity();
            worm.body.setLinearVelocity(planck.Vec2(cv.x, jumpVel));
            worm.vy = JUMP_FORCE;
            worm.grounded = false;
            this._sendAction({ type: 'JUMP', x: worm.x, y: worm.y });
          }
        }
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (this.cameraPanning) {
        this.cameras.main.scrollX = this.panStartX - pointer.x;
        this.cameras.main.scrollY = this.panStartY - pointer.y;
      }
    });

    this.input.on('pointerup', (pointer) => {
      if (pointer.button === 1) this.cameraPanning = false;
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
      // Apply jump via Planck impulse
      const jumpVel = JUMP_FORCE * INV_PTM * PHYS_FPS;
      const v = worm.body.getLinearVelocity();
      worm.body.setLinearVelocity(planck.Vec2(v.x, jumpVel));
      worm.vy = JUMP_FORCE;
      worm.grounded = false;
      jumped = true;
    }

    // Aim control with W/S — continuous while held
    if (this.wasd.up.isDown) {
      this.aimAngle -= 0.03;
    }
    if (this.wasd.down.isDown) {
      this.aimAngle += 0.03;
    }

    // Camera pan during opponent turn
    if (!this._isMyTurn() || !this.cameraFollowing) {
      const camSpeed = 4;
      if (this.wasd.camLeft.isDown) this.cameras.main.scrollX -= camSpeed;
      if (this.wasd.camRight.isDown) this.cameras.main.scrollX += camSpeed;
    }

    if (moved) {
      this._sendAction({ type: 'MOVE', dir: worm.vx > 0 ? 'right' : 'left', x: worm.x, y: worm.y });
    } else if (this._prevMoved) {
      // Key released → tell opponent to stop
      this._sendAction({ type: 'STOP', x: worm.x, y: worm.y });
    }
    this._prevMoved = moved;

    if (jumped) this._sendAction({ type: 'JUMP', x: worm.x, y: worm.y });

    // Throttled position+aim sync so the opponent always has fresh state (max 1 per 120 ms)
    const now = this.time.now;
    if (!this._lastSyncSent || now - this._lastSyncSent >= 120) {
      this._lastSyncSent = now;
      this._sendAction({ type: 'SYNC', x: worm.x, y: worm.y, vx: worm.vx, vy: worm.vy,
        facing: worm.facing, aim: this.aimAngle });
    }
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
    if (!weapon || weapon.isHook) return;

    if (weapon.isMelee) {
      if (ammo !== Infinity) this.weaponAmmo[weapon.key]--;
      this.fired = true;
      this._swingBat(worm, weapon);
      return;
    }

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

    if (weapon.isAirstrike) {
      // Mark target X position and spawn bombs from above
      const targetX = worm.x + Math.cos(this.aimAngle) * 200;
      this._sendAction({
        type: 'FIRE',
        weapon: weapon.key,
        angle: this.aimAngle,
        x: worm.x,
        y: worm.y,
        wind: this.wind,
      });
      this._doAirstrike(targetX, weapon, worm.teamIndex);
    } else if (weapon.placed) {
      this._placeMine(worm.x, worm.y, weapon);
      this._sendAction({ type: 'PLACE_MINE', x: worm.x, y: worm.y, weaponKey: weapon.key });
      this.time.delayedCall(4000, () => { if (this.turnActive && this.fired) this._endTurn(); });
    } else if (weapon.pellets) {
      // Shotgun: generate angles once, send them so both clients use identical spread
      const pelletAngles = [];
      for (let p = 0; p < weapon.pellets; p++) {
        pelletAngles.push(this.aimAngle + (Math.random() - 0.5) * weapon.spread);
      }
      for (const angle of pelletAngles) {
        const vx = Math.cos(angle) * weapon.speed;
        const vy = Math.sin(angle) * weapon.speed;
        this._createProjectile(worm.x, worm.y, vx, vy, weapon, worm.teamIndex);
      }
      this._sendAction({
        type: 'FIRE',
        weapon: weapon.key,
        angle: this.aimAngle,
        x: worm.x,
        y: worm.y,
        wind: this.wind,
        pelletAngles,
      });
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
        wind: this.wind,
      });
    }
  }

  _doAirstrike(targetX, weapon, ownerTeamIndex) {
    const bombCount = 3;
    for (let i = 0; i < bombCount; i++) {
      const offsetX = (i - 1) * 40;
      this.time.delayedCall(1000 + i * 200, () => {
        if (this.gameOver) return;
        const bx = targetX + offsetX;
        const by = -30;
        this._createProjectile(bx, by, 0, 8, weapon, ownerTeamIndex);
      });
    }
  }

  _swingBat(worm, weapon) {
    const dir   = worm.facing;
    const hitX  = worm.x + dir * weapon.range;
    const hitY  = worm.y;

    // Visual arc effect
    const gfx = this.add.graphics().setDepth(60);
    for (let a = 0; a <= 8; a++) {
      const t   = a / 8;
      const ang = (dir > 0 ? -0.8 : Math.PI + 0.8) + t * (dir > 0 ? 1.6 : -1.6);
      const sx  = worm.x + Math.cos(ang) * weapon.range;
      const sy  = worm.y + Math.sin(ang) * weapon.range * 0.5;
      gfx.fillStyle(0xccaa44, 1 - t * 0.7);
      gfx.fillRect(sx - 3, sy - 3, 6, 6);
    }
    this.time.delayedCall(250, () => gfx.destroy());

    // Check for worms in range
    let hit = false;
    for (const target of this.allWorms) {
      if (!target.alive) continue;
      if (target.teamIndex === worm.teamIndex) continue;
      const dist = Math.hypot(hitX - target.x, hitY - target.y);
      if (dist < weapon.range * 1.3) {
        // Strong horizontal knockback
        const kbMs = weapon.knockback * INV_PTM * PHYS_FPS;
        const kbUp = 6 * INV_PTM * PHYS_FPS;
        target.body.setLinearVelocity(planck.Vec2(dir * kbMs, -kbUp));
        target.vx = dir * weapon.knockback;
        target.vy = -6;
        this._applyDamageToWorm(target, weapon.damage, true);
        hit = true;
      }
    }

    // "Whoosh" / "CRACK" text
    const label = hit ? 'CRACK!' : 'Whoosh';
    const color = hit ? '#ffee44' : '#88aacc';
    const fx = this.add.text(hitX, worm.y - 20, label, {
      fontFamily: 'Arial Black', fontSize: '16px', color,
      stroke: '#000', strokeThickness: 3,
    }).setDepth(65).setOrigin(0.5);
    this.tweens.add({ targets: fx, y: fx.y - 40, alpha: 0, duration: 800, onComplete: () => fx.destroy() });

    this._sendAction({ type: 'BAT_SWING', x: worm.x, y: worm.y, facing: dir });

    // End turn after 4 s
    this.time.delayedCall(4000, () => { if (this.turnActive && this.fired) this._endTurn(); });
  }

  _createProjectile(x, y, vx, vy, weapon, ownerTeamIndex) {
    const sprite = this.add.image(x, y, weapon.projectileKey).setDepth(15);

    // Planck dynamic body for projectile
    const projBody = this.physWorld.createBody({
      type: 'dynamic',
      position: planck.Vec2(x * INV_PTM, y * INV_PTM),
      bullet: true,                 // CCD — prevents tunnelling at high speed
      gravityScale: 0,              // manual gravity applied per step
    });
    projBody.createFixture({
      shape: planck.Circle(4 * INV_PTM),
      density: 0.2,
      restitution: 0.3,
      friction: 0.2,
      isSensor: true,               // sensor — collision detection only, no physics response
    });
    // Set initial velocity (px/frame → m/s)
    projBody.setLinearVelocity(planck.Vec2(vx * INV_PTM * PHYS_FPS, vy * INV_PTM * PHYS_FPS));

    const proj = {
      x, y, vx, vy,
      weapon,
      ownerTeamIndex,
      sprite,
      alive: true,
      fuseTimer: weapon.fuse ? this.time.now + weapon.fuse : null,
      trail: [],
      body: projBody,
    };

    this.projectiles.push(proj);
    this.trackedProjectile = proj;
    return proj;
  }

  _placeMine(x, y, weaponOverride) {
    const weapon = weaponOverride || WEAPONS.mine;
    const surfaceY = this._findGroundBelow(x, y);
    const sprite = this.add.image(x, surfaceY - 4, weapon.projectileKey || 'mine').setDepth(12);

    const mine = {
      x,
      y: surfaceY - 4,
      sprite,
      weapon,
      armed: false,
      alive: true,
      armTimer: this.time.now + (weapon.armTime || WEAPONS.mine.armTime),
      fuseTimer: weapon.fuse ? this.time.now + weapon.fuse : null,
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
  // Grappling Hook
  // ─────────────────────────────────────────────

  _fireHook() {
    const worm = this._getActiveWorm();
    if (!worm) return;

    if (this._hook.active && this._hook.attached) {
      // Release hook
      this._releaseHook();
      return;
    }

    if (this._hook.active) return;

    const speed = 18;
    this._hook.active = true;
    this._hook.attached = false;
    this._hook.x = worm.x;
    this._hook.y = worm.y;
    this._hook.vx = Math.cos(this.aimAngle) * speed;
    this._hook.vy = Math.sin(this.aimAngle) * speed;
    this._hook.sprite = this.add.circle(worm.x, worm.y, 4, 0xcccccc).setDepth(20);
    this._hook.ropeGfx = this.add.graphics().setDepth(19);

    // Send action
    this._sendAction({ type: 'HOOK_FIRE', angle: this.aimAngle, x: worm.x, y: worm.y });
  }

  _releaseHook() {
    if (this._hook.sprite) { this._hook.sprite.destroy(); this._hook.sprite = null; }
    if (this._hook.ropeGfx) { this._hook.ropeGfx.destroy(); this._hook.ropeGfx = null; }
    this._hook.active = false;
    this._hook.attached = false;
    this._sendAction({ type: 'HOOK_RELEASE' });
  }

  _updateHook() {
    if (!this._hook.active) return;
    const worm = this._getActiveWorm();
    if (!worm) return;

    if (!this._hook.attached) {
      // Move hook
      this._hook.vy += 0.3;
      this._hook.x += this._hook.vx;
      this._hook.y += this._hook.vy;

      if (this._hook.sprite) this._hook.sprite.setPosition(this._hook.x, this._hook.y);

      // Check terrain attachment
      if (this.isSolid(this._hook.x, this._hook.y) || this._hook.y > WORLD_HEIGHT) {
        this._hook.attached = true;
        this._hook.vx = 0;
        this._hook.vy = 0;
      }

      // Out of bounds
      if (this._hook.x < 0 || this._hook.x > WORLD_WIDTH || this._hook.y < -200) {
        this._releaseHook();
        return;
      }
    }

    if (this._hook.attached) {
      // Swing physics: pull worm toward hook point
      const dx = this._hook.x - worm.x;
      const dy = this._hook.y - worm.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 10) {
        const ropeLength = Math.min(dist, 120); // max rope length
        if (dist > ropeLength) {
          const pull = (dist - ropeLength) / dist;
          worm.vx += dx * pull * 0.15;
          worm.vy += dy * pull * 0.15;
        }
        // Damping
        worm.vx *= 0.98;
        worm.vy *= 0.98;
      }

      // Draw rope
      if (this._hook.ropeGfx) {
        this._hook.ropeGfx.clear();
        this._hook.ropeGfx.lineStyle(1.5, 0xaaaaaa, 0.9);
        this._hook.ropeGfx.lineBetween(worm.x, worm.y, this._hook.x, this._hook.y);
      }
    }
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
    // Must be deterministic so both clients get identical wind each turn.
    // Mix seed + turnCount into mulberry32 so it's reproducible.
    const rng = mulberry32((this.seed ^ (this.turnCount * 2654435761)) >>> 0);
    return (rng() - 0.5) * 10;
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

    // Release hook at turn start
    this._releaseHook();

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

    // Notify opponent (only if it's our turn)
    if (this.wsClient && this.gameData.roomId && this._isMyTurn()) {
      this._sendAction({ type: 'END_TURN' });
    }

    this.turnActive = false;
    this.fired = false;
    this.trackedProjectile = null;

    // Release hook on turn end
    this._releaseHook();

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
    this._updateCameraEdgeScroll();
    this._updateHook();

    // Step Planck physics (capped to avoid spiral of death)
    this.physWorld.step(Math.min(delta / 1000, 1 / 30));

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

      const body = worm.body;
      const vel  = body.getLinearVelocity();

      // ── Apply gravity force ──
      body.applyForce(
        planck.Vec2(0, PLANCK_G * body.getMass()),
        body.getWorldCenter(), true,
      );

      // ── Apply horizontal velocity from worm.vx (px/frame → m/s) ──
      body.setLinearVelocity(planck.Vec2(worm.vx * INV_PTM * PHYS_FPS, vel.y));

      // ── Read back position (Planck step already ran in update()) ──
      const pos  = body.getPosition();
      const vel2 = body.getLinearVelocity();
      const newX = pos.x * PTM;
      const newY = pos.y * PTM;

      // ── Terrain collision (pixel-precise, overrides Planck for terrain) ──
      const feetY = newY + WORM_RADIUS;
      if (this.isSolid(newX, feetY)) {
        let surfaceY = Math.floor(feetY);
        while (surfaceY > 0 && this.isSolid(newX, surfaceY - 1)) surfaceY--;
        worm.y = surfaceY - WORM_RADIUS;

        if (vel2.y > 0) {
          const prevVyPx = vel2.y * PTM / PHYS_FPS;
          if (prevVyPx > 8) {
            const fallDamage = Math.floor((prevVyPx - 8) * 3);
            if (fallDamage > 0) this._applyDamageToWorm(worm, fallDamage, false);
          }
          body.setLinearVelocity(planck.Vec2(vel2.x * 0.75, 0));
        }
        worm.grounded = true;
      } else {
        worm.y = newY;
        worm.grounded = false;
      }

      // ── Side terrain collision ──
      if (this.isSolid(newX + worm.facing * WORM_RADIUS, worm.y)) {
        worm.vx = 0;
        body.setLinearVelocity(planck.Vec2(0, body.getLinearVelocity().y));
        if (!this.isSolid(newX + worm.facing * WORM_RADIUS, worm.y - 8)) {
          worm.y -= 3;
        }
      }

      // ── World bounds ──
      worm.x = Phaser.Math.Clamp(newX, WORM_RADIUS, WORLD_WIDTH - WORM_RADIUS);
      if (worm.x !== newX) {
        body.setLinearVelocity(planck.Vec2(0, body.getLinearVelocity().y));
      }

      // Sync corrected position back to Planck body
      body.setTransform(planck.Vec2(worm.x * INV_PTM, worm.y * INV_PTM), 0);

      // Read back vy for network sync
      worm.vy = body.getLinearVelocity().y * PTM / PHYS_FPS;

      // ── Fell off bottom ──
      if (worm.y > WORLD_HEIGHT + 50) this._killWorm(worm, true);

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

      const body = proj.body;

      // ── Apply per-weapon gravity + wind as forces (Planck world stepped below) ──
      const weapGravMs2 = proj.weapon.gravity * PHYS_FPS * PHYS_FPS * INV_PTM;
      const windMs2     = this.wind * proj.weapon.windFactor * 0.01 * PHYS_FPS * PHYS_FPS * INV_PTM;
      body.applyForce(
        planck.Vec2(windMs2 * body.getMass(), weapGravMs2 * body.getMass()),
        body.getWorldCenter(), true,
      );

      // ── Read position from Planck body ──
      const pos  = body.getPosition();
      const vel2 = body.getLinearVelocity();
      proj.x  = pos.x * PTM;
      proj.y  = pos.y * PTM;
      proj.vx = vel2.x * PTM / PHYS_FPS;
      proj.vy = vel2.y * PTM / PHYS_FPS;

      proj.trail.push({ x: proj.x, y: proj.y });
      if (proj.trail.length > 12) proj.trail.shift();

      proj.sprite.setRotation(Math.atan2(proj.vy, proj.vx));
      proj.sprite.setPosition(proj.x, proj.y);
      this._drawProjectileTrail(proj);

      // ── Fuse ──
      if (proj.weapon.fuse && this.time.now >= proj.fuseTimer) {
        this._explode(proj.x, proj.y, proj.weapon, proj.ownerTeamIndex);
        this._destroyProjectile(proj, i);
        continue;
      }

      // ── Terrain collision (pixel-precise) ──
      if (this.isSolid(proj.x, proj.y) || proj.y >= WORLD_HEIGHT) {
        this._explode(proj.x, proj.y, proj.weapon, proj.ownerTeamIndex);
        this._destroyProjectile(proj, i);
        continue;
      }

      // ── Worm collision ──
      let hit = false;
      for (const worm of this.allWorms) {
        if (!worm.alive) continue;
        if (worm.teamIndex === proj.ownerTeamIndex && !proj.weapon.fuse) continue;
        if (Math.hypot(proj.x - worm.x, proj.y - worm.y) < WORM_RADIUS + 6) {
          this._explode(proj.x, proj.y, proj.weapon, proj.ownerTeamIndex);
          this._destroyProjectile(proj, i);
          hit = true;
          break;
        }
      }
      if (hit) continue;

      // ── Out of bounds ──
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
    if (proj.trailGraphics) proj.trailGraphics.destroy();
    if (proj.body) {
      try { this.physWorld.destroyBody(proj.body); } catch {}
      proj.body = null;
    }
    if (this.trackedProjectile === proj) {
      this.trackedProjectile = null;
      this.cameraFollowing = true;
    }

    // End turn 4 s after all projectiles have settled
    this.time.delayedCall(4000, () => {
      if (this.turnActive && this.fired && !this.projectiles.some(p => p.alive)) {
        this._endTurn();
      }
    });
  }

  _updateMines(time) {
    for (const mine of this.mines) {
      if (!mine.alive) continue;

      if (!mine.armed && time >= mine.armTimer) {
        mine.armed = true;
      }

      // Fuse-based detonation (dynamite)
      if (mine.fuseTimer && time >= mine.fuseTimer) {
        const w = mine.weapon || WEAPONS.mine;
        this._explode(mine.x, mine.y, w, mine.ownerTeamIndex);
        mine.alive = false;
        mine.sprite.destroy();
        if (mine.indicator) mine.indicator.destroy();
        continue;
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

      // Trigger check (only for mines with triggerRadius > 0)
      const w = mine.weapon || WEAPONS.mine;
      if (!w.triggerRadius) continue;

      for (const worm of this.allWorms) {
        if (!worm.alive) continue;
        const dist = Math.hypot(worm.x - mine.x, worm.y - mine.y);
        if (dist < w.triggerRadius) {
          this._explode(mine.x, mine.y, w, mine.ownerTeamIndex);
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
          const angle  = Math.atan2(worm.y - cy, worm.x - cx);
          const kbPx   = falloff * 8;
          // Knockback via Planck impulse
          const kbX = Math.cos(angle) * kbPx * INV_PTM * PHYS_FPS;
          const kbY = (Math.sin(angle) * kbPx - 3) * INV_PTM * PHYS_FPS;
          worm.body.applyLinearImpulse(
            planck.Vec2(kbX * worm.body.getMass(), kbY * worm.body.getMass()),
            worm.body.getWorldCenter(), true,
          );
          // Keep worm.vx/vy in sync for network
          const v = worm.body.getLinearVelocity();
          worm.vx = v.x * PTM / PHYS_FPS;
          worm.vy = v.y * PTM / PHYS_FPS;
          this._applyDamageToWorm(worm, dmg, true);
        }
      }
    }

    // Cluster sub-projectiles
    if (weapon.isCluster) {
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 * i / 5) - Math.PI / 2;
        const miniWeapon = { ...WEAPONS.grenade, explodeRadius: 25, damage: 15, fuse: 1500, speed: 5 };
        const vx2 = Math.cos(angle) * 4;
        const vy2 = Math.sin(angle) * 4 - 2;
        this._createProjectile(cx, cy, vx2, vy2, miniWeapon, ownerTeamIndex);
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
    // Remove from physics world
    if (worm.body) {
      try { this.physWorld.destroyBody(worm.body); } catch {}
      worm.body = null;
    }

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
    if (remaining <= 0) {
      // Only the active player ends the turn (sends END_TURN to opponent)
      if (this._isMyTurn() && !this.fired) {
        this._endTurn();
      } else if (this.isSinglePlayer && !this._isMyTurn() && !this.fired && !this.aiThinking) {
        this._endTurn();
      }
      // In multiplayer, passive player waits for END_TURN message - do NOT call _endTurn()
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
    // Throttle high-frequency messages so they don't flood the data channel.
    // AIM/MOVE/SYNC: max 1 per 100 ms.
    const HF = { AIM: 1, MOVE: 1, SYNC: 1 };
    if (HF[data.type]) {
      const now = Date.now();
      if (!this._hfSent) this._hfSent = {};
      if ((now - (this._hfSent[data.type] || 0)) < 100) return;
      this._hfSent[data.type] = now;
    }
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
        if (data.x !== undefined) {
          worm.x = data.x; worm.y = data.y;
          worm.body.setTransform(planck.Vec2(data.x * INV_PTM, data.y * INV_PTM), 0);
        }
        break;

      case 'JUMP':
        if (data.x !== undefined) {
          worm.x = data.x; worm.y = data.y;
          worm.body.setTransform(planck.Vec2(data.x * INV_PTM, data.y * INV_PTM), 0);
        }
        {
          const jumpVel = JUMP_FORCE * INV_PTM * PHYS_FPS;
          const cv = worm.body.getLinearVelocity();
          worm.body.setLinearVelocity(planck.Vec2(cv.x, jumpVel));
        }
        worm.vy = JUMP_FORCE;
        worm.grounded = false;
        break;

      case 'AIM':
        this.aimAngle = data.angle;
        break;

      case 'FIRE': {
        const weapon = WEAPONS[data.weapon] || WEAPONS.bazooka;
        this.aimAngle = data.angle;
        // Apply authoritative wind from sender so trajectories are identical
        if (data.wind !== undefined) this.wind = data.wind;

        if (weapon.isAirstrike) {
          const targetX = data.x + Math.cos(data.angle) * 200;
          this._doAirstrike(targetX, weapon, this.currentTeamIndex);
        } else if (weapon.pellets) {
          // Use authoritative angles from sender for deterministic pellets
          const angles = data.pelletAngles || Array.from({ length: weapon.pellets },
            () => data.angle + (Math.random() - 0.5) * weapon.spread);
          for (const angle of angles) {
            const vx = Math.cos(angle) * weapon.speed;
            const vy = Math.sin(angle) * weapon.speed;
            this._createProjectile(data.x, data.y, vx, vy, weapon, this.currentTeamIndex);
          }
        } else {
          const vx = Math.cos(data.angle) * weapon.speed;
          const vy = Math.sin(data.angle) * weapon.speed;
          this._createProjectile(data.x, data.y, vx, vy, weapon, this.currentTeamIndex);
        }
        this.fired = true;
        break;
      }

      case 'PLACE_MINE': {
        const weaponKey = data.weaponKey || 'mine';
        this._placeMine(data.x, data.y, WEAPONS[weaponKey]);
        this.fired = true;
        break;
      }

      case 'END_TURN':
        this._endTurn();
        break;

      case 'SYNC':
        worm.x = data.x; worm.y = data.y;
        worm.vx = data.vx ?? 0;
        worm.vy = data.vy ?? worm.vy;
        worm.facing = data.facing ?? worm.facing;
        if (data.aim !== undefined) this.aimAngle = data.aim;
        worm.body.setTransform(planck.Vec2(data.x * INV_PTM, data.y * INV_PTM), 0);
        worm.body.setLinearVelocity(planck.Vec2(worm.vx * INV_PTM * PHYS_FPS, worm.vy * INV_PTM * PHYS_FPS));
        break;

      case 'STOP':
        worm.vx = 0;
        if (data.x !== undefined) {
          worm.x = data.x; worm.y = data.y;
          worm.body.setTransform(planck.Vec2(data.x * INV_PTM, data.y * INV_PTM), 0);
        }
        worm.body.setLinearVelocity(planck.Vec2(0, worm.body.getLinearVelocity().y));
        break;

      case 'HOOK_FIRE': {
        const speed = 18;
        this._hook.active = true;
        this._hook.attached = false;
        this._hook.x = data.x;
        this._hook.y = data.y;
        this._hook.vx = Math.cos(data.angle) * speed;
        this._hook.vy = Math.sin(data.angle) * speed;
        if (!this._hook.sprite) this._hook.sprite = this.add.circle(data.x, data.y, 4, 0xcccccc).setDepth(20);
        if (!this._hook.ropeGfx) this._hook.ropeGfx = this.add.graphics().setDepth(19);
        break;
      }

      case 'HOOK_RELEASE':
        this._releaseHook();
        break;

      case 'BAT_SWING': {
        const sw   = WEAPONS.bat;
        const dir  = data.facing;
        const hitX = data.x + dir * sw.range;
        for (const target of this.allWorms) {
          if (!target.alive || target.teamIndex === this.currentTeamIndex) continue;
          const dist = Math.hypot(hitX - target.x, data.y - target.y);
          if (dist < sw.range * 1.3) {
            const kbMs = sw.knockback * INV_PTM * PHYS_FPS;
            const kbUp = 6 * INV_PTM * PHYS_FPS;
            target.body.setLinearVelocity(planck.Vec2(dir * kbMs, -kbUp));
            target.vx = dir * sw.knockback;
            target.vy = -6;
            this._applyDamageToWorm(target, sw.damage, true);
          }
        }
        this.fired = true;
        break;
      }
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
    if (this.wsClient) this.wsClient.disconnect();
    // Remove terrain texture so it can be re-created on restart
    if (this.textures.exists('terrain')) {
      this.textures.remove('terrain');
    }
  }
}
