import { BootScene } from './scenes/BootScene.js';
import { MenuScene } from './scenes/MenuScene.js';
import { GameScene } from './scenes/GameScene.js';
import { UIScene } from './scenes/UIScene.js';

const config = {
  type: Phaser.CANVAS,
  width: 800,
  height: 500,
  backgroundColor: '#1a1a2e',
  parent: 'game-container',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 500,
  },
  scene: [BootScene, MenuScene, GameScene, UIScene],
  render: {
    antialias: false,
    pixelArt: false,
    roundPixels: true,
  },
  audio: {
    disableWebAudio: true,
  },
};

const game = new Phaser.Game(config);

export default game;
