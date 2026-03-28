/**
 * BootScene - Loads assets and creates programmatic textures.
 * All textures are generated via code (no external image files needed).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // Nothing to load from network - all textures are procedural
  }

  create() {
    this._createWormTextures();
    this._createWeaponTextures();
    this._createUITextures();
    this._createParticleTextures();
    this._generateIcons();

    // Hide the HTML loading overlay
    if (window.hideLoadingOverlay) {
      window.hideLoadingOverlay();
    }

    this.scene.start('MenuScene');
  }

  /**
   * Create worm textures as colored circles with outlines.
   */
  _createWormTextures() {
    const teams = [
      { key: 'worm-red', fill: 0xff4444, outline: 0xcc0000 },
      { key: 'worm-blue', fill: 0x4488ff, outline: 0x0044cc },
      { key: 'worm-green', fill: 0x44cc44, outline: 0x008800 },
      { key: 'worm-yellow', fill: 0xffcc00, outline: 0xcc8800 },
    ];

    for (const team of teams) {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });

      // Shadow
      gfx.fillStyle(0x000000, 0.3);
      gfx.fillCircle(12, 12, 10);

      // Body outline
      gfx.fillStyle(team.outline, 1);
      gfx.fillCircle(10, 10, 10);

      // Body fill
      gfx.fillStyle(team.fill, 1);
      gfx.fillCircle(10, 10, 8);

      // Eyes (white)
      gfx.fillStyle(0xffffff, 1);
      gfx.fillCircle(13, 8, 3);
      gfx.fillCircle(7, 8, 2);

      // Pupils
      gfx.fillStyle(0x000000, 1);
      gfx.fillCircle(14, 8, 1.5);
      gfx.fillCircle(7, 8, 1);

      gfx.generateTexture(team.key, 22, 22);
      gfx.destroy();
    }
  }

  /**
   * Create weapon and projectile textures.
   */
  _createWeaponTextures() {
    // Bazooka projectile - elongated rocket shape
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x888888, 1);
      gfx.fillRect(0, 2, 12, 4);
      gfx.fillStyle(0xff6600, 1);
      gfx.fillTriangle(12, 0, 12, 8, 16, 4);
      gfx.fillStyle(0xffaa00, 1);
      gfx.fillRect(0, 3, 3, 2);
      gfx.generateTexture('projectile-bazooka', 16, 8);
      gfx.destroy();
    }

    // Grenade - round with pin
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x446633, 1);
      gfx.fillCircle(7, 8, 6);
      gfx.fillStyle(0x222222, 1);
      gfx.fillRect(6, 1, 3, 3);
      gfx.fillStyle(0xcccccc, 1);
      gfx.fillCircle(7, 2, 1);
      gfx.generateTexture('projectile-grenade', 14, 14);
      gfx.destroy();
    }

    // Mine - flat disc shape
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x333333, 1);
      gfx.fillCircle(8, 6, 7);
      gfx.fillStyle(0xff0000, 1);
      gfx.fillCircle(8, 6, 3);
      gfx.fillStyle(0xffff00, 1);
      gfx.fillCircle(8, 6, 1.5);
      gfx.generateTexture('mine', 16, 12);
      gfx.destroy();
    }

    // Bazooka weapon icon
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x888888, 1);
      gfx.fillRect(2, 6, 28, 6);
      gfx.fillRect(0, 4, 6, 10);
      gfx.fillStyle(0x555555, 1);
      gfx.fillRect(10, 10, 8, 4);
      gfx.generateTexture('weapon-bazooka', 32, 18);
      gfx.destroy();
    }

    // Grenade weapon icon
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x446633, 1);
      gfx.fillCircle(12, 14, 10);
      gfx.fillStyle(0x222222, 1);
      gfx.fillRect(10, 3, 5, 6);
      gfx.generateTexture('weapon-grenade', 24, 24);
      gfx.destroy();
    }

    // Mine weapon icon
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x333333, 1);
      gfx.fillEllipse(12, 12, 20, 14);
      gfx.fillStyle(0xff0000, 1);
      gfx.fillCircle(12, 12, 4);
      gfx.generateTexture('weapon-mine', 24, 24);
      gfx.destroy();
    }
  }

  /**
   * Create UI element textures.
   */
  _createUITextures() {
    // Single white pixel (utility texture)
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0xffffff, 1);
      gfx.fillRect(0, 0, 1, 1);
      gfx.generateTexture('pixel', 1, 1);
      gfx.destroy();
    }

    // Aim arrow/cursor
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0xffff00, 1);
      gfx.fillTriangle(0, 4, 20, 0, 20, 8);
      gfx.fillStyle(0xffff00, 0.6);
      gfx.fillRect(0, 3, 18, 2);
      gfx.generateTexture('aim-arrow', 20, 8);
      gfx.destroy();
    }

    // Turn indicator arrow (pointing down)
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0xffffff, 1);
      gfx.fillTriangle(8, 16, 0, 0, 16, 0);
      gfx.generateTexture('turn-indicator', 16, 16);
      gfx.destroy();
    }

    // Wind arrow
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x88ddff, 1);
      gfx.fillTriangle(20, 6, 8, 0, 8, 12);
      gfx.fillRect(0, 4, 10, 4);
      gfx.generateTexture('wind-arrow', 20, 12);
      gfx.destroy();
    }
  }

  /**
   * Create particle and effect textures.
   */
  _createParticleTextures() {
    // Explosion center
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      const cx = 32, cy = 32, r = 30;
      // Outer glow
      gfx.fillStyle(0xff6600, 0.3);
      gfx.fillCircle(cx, cy, r);
      // Mid
      gfx.fillStyle(0xff8800, 0.7);
      gfx.fillCircle(cx, cy, r * 0.7);
      // Core
      gfx.fillStyle(0xffdd00, 1);
      gfx.fillCircle(cx, cy, r * 0.4);
      // Bright center
      gfx.fillStyle(0xffffff, 0.9);
      gfx.fillCircle(cx, cy, r * 0.15);
      gfx.generateTexture('explosion', 64, 64);
      gfx.destroy();
    }

    // Smoke particle
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x888888, 0.5);
      gfx.fillCircle(6, 6, 6);
      gfx.generateTexture('smoke', 12, 12);
      gfx.destroy();
    }

    // Dirt particle
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0x8B5E3C, 1);
      gfx.fillRect(0, 0, 4, 4);
      gfx.generateTexture('dirt-particle', 4, 4);
      gfx.destroy();
    }

    // Projectile trail dot
    {
      const gfx = this.make.graphics({ x: 0, y: 0, add: false });
      gfx.fillStyle(0xffaa00, 0.8);
      gfx.fillCircle(3, 3, 3);
      gfx.generateTexture('trail-dot', 6, 6);
      gfx.destroy();
    }
  }

  /**
   * Generate icon PNGs programmatically and save them as data URLs for the PWA.
   * Since we can't write files from JS, we create canvas-based icons.
   */
  _generateIcons() {
    // Icons are referenced in manifest but generated as data URIs
    // The actual icon files should be created separately or use placeholders
    // For now, create a simple canvas-based icon texture
    const gfx = this.make.graphics({ x: 0, y: 0, add: false });
    gfx.fillStyle(0x1a1a2e, 1);
    gfx.fillRect(0, 0, 192, 192);
    gfx.fillStyle(0xe8c86d, 1);
    gfx.fillCircle(96, 90, 50);
    gfx.fillStyle(0xff4444, 1);
    gfx.fillCircle(80, 82, 15);
    gfx.fillStyle(0x4488ff, 1);
    gfx.fillCircle(112, 82, 15);
    gfx.generateTexture('app-icon', 192, 192);
    gfx.destroy();
  }
}
