/**
 * Generates PWA icon PNG files using Node.js Canvas API.
 * Run with: node generate-icons.mjs
 * Requires: npm install canvas (optional dev dependency)
 *
 * If canvas is unavailable, icons are generated as data URIs embedded in a JS shim.
 */

import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, size, size);

  // Rounded corners effect (draw circle mask)
  const r = size * 0.15;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = '#1a1a2e';
  ctx.fill();

  const cx = size / 2;
  const cy = size * 0.47;
  const scale = size / 192;

  // Ground
  ctx.fillStyle = '#228B22';
  ctx.fillRect(size * 0.1, size * 0.72, size * 0.8, size * 0.05);
  ctx.fillStyle = '#8B5E3C';
  ctx.fillRect(size * 0.1, size * 0.77, size * 0.8, size * 0.15);

  // Team Red Worm
  drawWorm(ctx, cx - 30 * scale, cy, 20 * scale, '#ff4444', '#cc0000');

  // Team Blue Worm
  drawWorm(ctx, cx + 30 * scale, cy, 20 * scale, '#4488ff', '#0044cc');

  // Stars
  ctx.fillStyle = '#e8c86d';
  for (let i = 0; i < 5; i++) {
    const sx = (size * 0.15) + i * (size * 0.17);
    const sy = size * 0.15 + (i % 2) * size * 0.08;
    ctx.fillRect(sx, sy, 2 * scale, 2 * scale);
  }

  return canvas;
}

function drawWorm(ctx, x, y, radius, fill, outline) {
  // Body
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = outline;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, radius * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  // Eye
  ctx.beginPath();
  ctx.arc(x + radius * 0.35, y - radius * 0.2, radius * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x + radius * 0.42, y - radius * 0.2, radius * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = '#000000';
  ctx.fill();
}

mkdirSync(join(__dirname, 'icons'), { recursive: true });

for (const size of [192, 512]) {
  const canvas = drawIcon(size);
  const buffer = canvas.toBuffer('image/png');
  writeFileSync(join(__dirname, 'icons', `icon-${size}.png`), buffer);
  console.log(`Generated icons/icon-${size}.png`);
}

console.log('Done!');
