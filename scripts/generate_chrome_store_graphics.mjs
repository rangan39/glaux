#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const rootDir = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(rootDir, "chrome-extension", "store-assets");
await mkdir(outputDir, { recursive: true });

await renderGraphic(440, 280, path.join(outputDir, "promo-small-440x280.png"), {
  iconSize: 96,
  iconX: 38,
  iconY: 40,
  titleX: 154,
  titleY: 82,
  titleSize: 38,
  subtitleX: 154,
  subtitleY: 111,
  subtitleSize: 15,
  messageX: 40,
  messageY: 190,
  messageSize: 23,
  detailX: 40,
  detailY: 222,
  detailSize: 13
});

await renderGraphic(1400, 560, path.join(outputDir, "marquee-1400x560.png"), {
  iconSize: 184,
  iconX: 126,
  iconY: 112,
  titleX: 360,
  titleY: 188,
  titleSize: 78,
  subtitleX: 365,
  subtitleY: 234,
  subtitleSize: 24,
  messageX: 365,
  messageY: 334,
  messageSize: 42,
  detailX: 365,
  detailY: 383,
  detailSize: 21
});

async function renderGraphic(width, height, output, layout) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <radialGradient id="coralGlow" cx="0" cy="0" r="1" gradientTransform="translate(${width * 0.17} ${height * 0.05}) rotate(42) scale(${width * 0.52} ${height * 0.82})" gradientUnits="userSpaceOnUse">
          <stop stop-color="#ff4d2e" stop-opacity=".32"/>
          <stop offset="1" stop-color="#ff4d2e" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="blueGlow" cx="0" cy="0" r="1" gradientTransform="translate(${width * 0.9} ${height * 0.15}) rotate(135) scale(${width * 0.54} ${height * 0.9})" gradientUnits="userSpaceOnUse">
          <stop stop-color="#4969ae" stop-opacity=".2"/>
          <stop offset="1" stop-color="#4969ae" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="brand" x1="10" y1="5" x2="118" y2="123" gradientUnits="userSpaceOnUse">
          <stop stop-color="#ff8068"/>
          <stop offset=".52" stop-color="#ff4d2e"/>
          <stop offset="1" stop-color="#9d2518"/>
        </linearGradient>
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000" flood-opacity=".42"/>
        </filter>
        <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse">
          <path d="M42 0H0V42" fill="none" stroke="#fff" stroke-opacity=".035"/>
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="#090a0d"/>
      <rect width="${width}" height="${height}" fill="url(#coralGlow)"/>
      <rect width="${width}" height="${height}" fill="url(#blueGlow)"/>
      <rect width="${width}" height="${height}" fill="url(#grid)"/>
      <g transform="translate(${layout.iconX} ${layout.iconY}) scale(${layout.iconSize / 128})" filter="url(#shadow)">
        <rect width="128" height="128" rx="28" fill="#090a0d" stroke="#fff" stroke-opacity=".16"/>
        <rect x="6" y="6" width="116" height="116" rx="24" fill="url(#brand)"/>
        <path d="M91 28H39L66 63 38 100h55V85H67l20-23-19-20h23V28Z" fill="#210b07"/>
      </g>
      <text x="${layout.titleX}" y="${layout.titleY}" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="${layout.titleSize}" font-weight="700" letter-spacing="${layout.titleSize * 0.08}">GLAUX</text>
      <text x="${layout.subtitleX}" y="${layout.subtitleY}" fill="#ff9c87" font-family="Arial, Helvetica, sans-serif" font-size="${layout.subtitleSize}" font-weight="700" letter-spacing="${layout.subtitleSize * 0.13}">PRIVATE LOCAL AI</text>
      <text x="${layout.messageX}" y="${layout.messageY}" fill="#f4f0e9" font-family="Arial, Helvetica, sans-serif" font-size="${layout.messageSize}" font-weight="600">Multilingual AI. On your device.</text>
      <text x="${layout.detailX}" y="${layout.detailY}" fill="#f4f0e9" fill-opacity=".62" font-family="Arial, Helvetica, sans-serif" font-size="${layout.detailSize}">No account · No cloud inference · WebGPU</text>
    </svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toFile(output);
  const metadata = await sharp(output).metadata();
  assert.deepEqual([metadata.width, metadata.height, metadata.format], [width, height, "png"]);
  console.log(`✓ ${path.relative(rootDir, output)} (${width}×${height})`);
}
