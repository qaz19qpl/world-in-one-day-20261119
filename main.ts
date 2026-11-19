// World in One Day — Thursday 19 November 2026.
// Draws the day's world news as a 1024x1024 newspaper poster and writes
// it to $MAKEFUN_OUTPUT_DIR/entry.png (default /output/entry.png).
// Pure Node standard library: the raster is built pixel by pixel in a
// buffer and encoded to PNG by hand (zlib deflate + CRC32).
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;
const buf = Buffer.alloc(W * H * 3);

// ---- palette (newsprint) ----
const PAPER: RGB = [246, 241, 231];
const INK: RGB = [20, 24, 31];
const WHITE: RGB = [255, 255, 255];
const NAVY: RGB = [22, 35, 61];
const GOLD: RGB = [200, 162, 75];
const RED: RGB = [179, 38, 30];
const TEAL: RGB = [14, 110, 110];
const STEEL: RGB = [58, 92, 130];
const OCHRE: RGB = [166, 110, 22];
const STORM: RGB = [32, 84, 122];
const LIGHTGREY: RGB = [226, 220, 208];

type RGB = [number, number, number];

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

function fill(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(W, Math.ceil(x + w));
  const y1 = Math.min(H, Math.ceil(y + h));
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 3;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
    }
  }
}

function frame(x: number, y: number, w: number, h: number, c: RGB, t: number): void {
  fill(x, y, w, t, c);
  fill(x, y + h - t, w, t, c);
  fill(x, y, t, h, c);
  fill(x + w - t, y, t, h, c);
}

function hline(x: number, y: number, w: number, c: RGB, t = 1): void {
  fill(x, y, w, t, c);
}

function vline(x: number, y: number, h: number, c: RGB, t = 1): void {
  fill(x, y, t, h, c);
}

function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  let ax = Math.round(x0);
  let ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const dx = Math.abs(bx - ax);
  const dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1;
  const sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(ax, ay, c);
    if (ax === bx && ay === by) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ax += sx;
    }
    if (e2 <= dx) {
      err += dx;
      ay += sy;
    }
  }
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let yy = -r; yy <= r; yy++) {
    const half = Math.floor(Math.sqrt(r * r - yy * yy));
    for (let xx = -half; xx <= half; xx++) setPx(cx + xx, cy + yy, c);
  }
}

function ring(cx: number, cy: number, r: number, c: RGB, t = 2): void {
  for (let a = 0; a < 360; a += 1) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) {
      setPx(Math.round(cx + (r - k) * Math.cos(rad)), Math.round(cy + (r - k) * Math.sin(rad)), c);
    }
  }
}

function tri(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: RGB): void {
  // Filled triangle by scanline interpolation.
  const pts = [
    [x0, y0],
    [x1, y1],
    [x2, y2],
  ].sort((a, b) => a[1] - b[1]);
  const [ax, ay] = pts[0];
  const [bx, by] = pts[1];
  const [cx, cy] = pts[2];
  for (let y = ay; y <= cy; y++) {
    const t1 = cy === ay ? 0 : (y - ay) / (cy - ay);
    const xa = ax + (cx - ax) * t1;
    let xb: number;
    if (y < by) {
      const t2 = by === ay ? 0 : (y - ay) / (by - ay);
      xb = ax + (bx - ax) * t2;
    } else {
      const t2 = cy === by ? 0 : (y - by) / (cy - by);
      xb = bx + (cx - bx) * t2;
    }
    const s = Math.min(xa, xb);
    const e = Math.max(xa, xb);
    for (let x = Math.ceil(s); x <= Math.floor(e); x++) setPx(x, y, c);
  }
}

// ---- 5x7 pixel font (own hand-drawn glyphs, rows as 5-bit values) ----
const GLYPHS: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ";": [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  "-": [0, 0, 0, 0x0e, 0, 0, 0],
  "/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "%": [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  "+": [0, 0x04, 0x04, 0x0e, 0x04, 0x04, 0],
  "=": [0, 0, 0x1f, 0, 0x1f, 0, 0],
  '"': [0x0a, 0x0a, 0, 0, 0, 0, 0],
  "|": [0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
};

function charWidth(scale: number): number {
  return 6 * scale;
}

function textWidth(text: string, scale: number): number {
  return text.length * charWidth(scale) - scale;
}

function drawChar(x: number, y: number, ch: string, scale: number, c: RGB): void {
  const g = GLYPHS[ch] ?? GLYPHS["?"];
  for (let r = 0; r < 7; r++) {
    const row = g[r];
    for (let col = 0; col < 5; col++) {
      if (row & (1 << (4 - col))) {
        fill(x + col * scale, y + r * scale, scale, scale, c);
      }
    }
  }
}

function drawText(x: number, y: number, text: string, scale: number, c: RGB): number {
  const t = text.toUpperCase();
  let cx = x;
  for (const ch of t) {
    drawChar(cx, y, ch, scale, c);
    cx += charWidth(scale);
  }
  return cx - x - scale;
}

function drawTextCentered(cx: number, y: number, text: string, scale: number, c: RGB): void {
  drawText(cx - Math.floor(textWidth(text, scale) / 2), y, text, scale, c);
}

function wrapText(text: string, scale: number, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textWidth(test, scale) <= maxW || !cur) {
      cur = test;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawWrapped(x: number, y: number, text: string, scale: number, c: RGB, maxW: number, lh: number): number {
  const lines = wrapText(text, scale, maxW);
  let cy = y;
  for (const ln of lines) {
    drawText(x, cy, ln, scale, c);
    cy += lh;
  }
  return cy;
}

// ---- pictograms: small flat scenes drawn with the primitives above ----
function artShenzhen(ax: number, ay: number, aw: number, ah: number): void {
  // Three flags on poles above a round table.
  const poleY = ay + 18;
  const flagW = Math.floor((aw - 48) / 3);
  const flagH = 74;
  const cols: RGB[][] = [
    [[178, 34, 34], [255, 255, 255], [178, 34, 34], [255, 255, 255], [178, 34, 34], [255, 255, 255], [178, 34, 34]],
    [[222, 41, 16], [222, 41, 16], [222, 41, 16], [222, 41, 16], [222, 41, 16], [222, 41, 16], [222, 41, 16]],
    [[255, 255, 255], [0, 57, 166], [206, 17, 38], [206, 17, 38], [206, 17, 38], [206, 17, 38], [206, 17, 38]],
  ];
  for (let f = 0; f < 3; f++) {
    const fx = ax + 12 + f * (flagW + 12);
    vline(fx, poleY, flagH + 46, INK, 3);
    if (f === 0) {
      // US: red/white stripes + blue canton with dots.
      for (let s = 0; s < 7; s++) fill(fx + 3, poleY + s * 10, flagW, 10, cols[0][s]);
      fill(fx + 3, poleY, Math.floor(flagW * 0.45), 30, [30, 50, 110]);
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) disc(fx + 8 + c * 7, poleY + 6 + r * 9, 1, WHITE);
    } else if (f === 1) {
      fill(fx + 3, poleY, flagW, flagH, [222, 41, 16]);
      disc(fx + 13, poleY + 14, 5, GOLD);
      disc(fx + 30, poleY + 10, 2, GOLD);
      disc(fx + 34, poleY + 20, 2, GOLD);
      disc(fx + 30, poleY + 28, 2, GOLD);
    } else {
      fill(fx + 3, poleY, flagW, 24, WHITE);
      fill(fx + 3, poleY + 24, flagW, 25, [0, 57, 166]);
      fill(fx + 3, poleY + 49, flagW, 25, [206, 17, 38]);
    }
    frame(fx + 3, poleY, flagW, flagH, INK, 2);
  }
  // Round table.
  const ty = poleY + flagH + 52;
  fill(ax + 14, ty, aw - 28, 10, [120, 72, 32]);
  fill(ax + 22, ty + 10, aw - 44, 6, [90, 54, 24]);
  disc(ax + Math.floor(aw / 2), ty + 26, 4, INK);
}

function artCourt(ax: number, ay: number, aw: number, ah: number): void {
  // Scales of justice.
  const cx = ax + Math.floor(aw / 2);
  const top = ay + 16;
  vline(cx, top, 108, INK, 4);
  hline(cx - 52, top + 8, 104, INK, 4);
  disc(cx, top + 2, 6, GOLD);
  for (const s of [-1, 1]) {
    const px = cx + s * 52;
    line(px, top + 10, px - 16, top + 56, INK);
    line(px, top + 10, px + 16, top + 56, INK);
    line(px - 16, top + 56, px + 16, top + 56, INK);
    tri(px - 17, top + 56, px + 17, top + 56, px, top + 78, GOLD);
  }
  fill(cx - 34, top + 108, 68, 10, INK);
  fill(cx - 24, top + 118, 48, 8, INK);
}

function artIpo(ax: number, ay: number, aw: number, ah: number): void {
  // Rising bars with an arrow.
  const base = ay + ah - 26;
  const bars = [34, 58, 82, 108];
  const bw = 22;
  const gap = 10;
  const x0 = ax + Math.floor((aw - (bars.length * bw + (bars.length - 1) * gap)) / 2);
  const cols: RGB[] = [TEAL, TEAL, TEAL, GOLD];
  bars.forEach((h, i) => {
    fill(x0 + i * (bw + gap), base - h, bw, h, cols[i]);
    frame(x0 + i * (bw + gap), base - h, bw, h, INK, 2);
  });
  hline(ax + 8, base, aw - 16, INK, 3);
  line(ax + 14, base - 112, x0 + 3 * (bw + gap) + bw - 4, base - 118, RED);
  tri(x0 + 3 * (bw + gap) + bw - 4, base - 126, x0 + 3 * (bw + gap) + bw - 4, base - 110, x0 + 3 * (bw + gap) + bw + 10, base - 118, RED);
  disc(ax + 18, base - 108, 4, RED);
}

function artBridge(ax: number, ay: number, aw: number, ah: number): void {
  // Bridge deck, arch, towers, water, blast star.
  const deckY = ay + 78;
  hline(ax + 6, deckY, aw - 12, INK, 5);
  for (const tx of [ax + 30, ax + aw - 46]) {
    fill(tx, ay + 30, 14, deckY - ay - 30, INK);
  }
  // Arch.
  for (let a = 0; a <= 180; a += 2) {
    const rad = (a * Math.PI) / 180;
    const px = ax + Math.floor(aw / 2) + Math.floor(Math.cos(rad) * (aw / 2 - 14));
    const py = deckY - Math.floor(Math.sin(rad) * 44);
    fill(px, py, 3, 3, INK);
  }
  // Blast star at centre of deck.
  const bx = ax + Math.floor(aw / 2);
  const by = deckY - 8;
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180;
    line(bx, by, bx + Math.round(26 * Math.cos(rad)), by + Math.round(26 * Math.sin(rad)), RED);
  }
  disc(bx, by, 9, RED);
  disc(bx, by, 4, GOLD);
  // Water.
  for (let r = 0; r < 3; r++) {
    const wy = deckY + 26 + r * 14;
    for (let x = ax + 10; x < ax + aw - 10; x += 18) {
      line(x, wy, x + 9, wy + 4, STEEL);
      line(x + 9, wy + 4, x + 18, wy, STEEL);
    }
  }
}

function artGaza(ax: number, ay: number, aw: number, ah: number): void {
  // Dashed yellow line and a tank crossing it.
  const lx = ax + Math.floor(aw * 0.42);
  for (let y = ay + 12; y < ay + ah - 12; y += 16) {
    fill(lx - 2, y, 5, 10, GOLD);
  }
  // Houses on the far side.
  fill(ax + 12, ay + 96, 26, 22, [150, 120, 90]);
  tri(ax + 10, ay + 96, ax + 40, ay + 96, ax + 25, ay + 82, RED);
  fill(ax + aw - 44, ay + 100, 26, 18, [150, 120, 90]);
  tri(ax + aw - 46, ay + 100, ax + aw - 16, ay + 100, ax + aw - 30, ay + 88, RED);
  // Tank.
  const tx = lx - 8;
  const ty = ay + 52;
  fill(tx, ty, 64, 22, [74, 94, 58]);
  fill(tx + 12, ty - 12, 34, 12, [74, 94, 58]);
  fill(tx + 44, ty - 8, 30, 5, INK);
  for (let i = 0; i < 4; i++) disc(tx + 10 + i * 15, ty + 26, 5, INK);
  disc(tx + 10, ty + 26, 2, WHITE);
  disc(tx + 25, ty + 26, 2, WHITE);
  disc(tx + 40, ty + 26, 2, WHITE);
  disc(tx + 55, ty + 26, 2, WHITE);
}

function artCyclone(ax: number, ay: number, aw: number, ah: number): void {
  // Spiral storm over the sea.
  const cx = ax + Math.floor(aw / 2);
  const cy = ay + Math.floor(ah / 2) - 8;
  ring(cx, cy, 52, STORM, 5);
  ring(cx, cy, 38, STORM, 5);
  ring(cx, cy, 24, TEAL, 5);
  disc(cx, cy, 10, GOLD);
  // Spiral arms.
  for (let a = 0; a < 300; a += 3) {
    const rad = (a * Math.PI) / 180;
    const r = 12 + a * 0.16;
    setPx(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), WHITE);
    setPx(Math.round(cx + r * Math.cos(rad)) + 1, Math.round(cy + r * Math.sin(rad)), WHITE);
  }
  // Rain streaks.
  for (let i = 0; i < 8; i++) {
    const rx = ax + 14 + i * Math.floor((aw - 28) / 8);
    line(rx, ay + ah - 26, rx - 6, ay + ah - 12, STEEL);
    line(rx + 4, ay + ah - 20, rx - 2, ay + ah - 8, STEEL);
  }
  // Coast line at the bottom.
  hline(ax + 6, ay + ah - 6, aw - 12, INK, 3);
}

// ---- one news panel ----
interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
  place: string;
  kicker: string;
  color: RGB;
  headline: string;
  body: string;
  art: (ax: number, ay: number, aw: number, ah: number) => void;
  artW: number;
  headScale: number;
}

function drawPanel(p: Panel): void {
  fill(p.x, p.y, p.w, p.h, WHITE);
  frame(p.x, p.y, p.w, p.h, INK, 2);
  // Kicker strip.
  fill(p.x + 2, p.y + 2, p.w - 4, 32, p.color);
  drawText(p.x + 12, p.y + 10, p.place + "  |  " + p.kicker, 2, WHITE);
  // Art on the left.
  const artX = p.x + 6;
  const artY = p.y + 40;
  const artH = p.h - 48;
  p.art(artX, artY, p.artW, artH);
  vline(p.x + p.artW + 12, p.y + 42, p.h - 52, LIGHTGREY, 2);
  // Text on the right.
  const tx = p.x + p.artW + 24;
  const tw = p.w - p.artW - 36;
  let cy = p.y + 46;
  cy = drawWrapped(tx, cy, p.headline, p.headScale, INK, tw, p.headScale * 7 + 7);
  cy += 6;
  hline(tx, cy, Math.min(64, tw), p.color, 3);
  cy += 12;
  drawWrapped(tx, cy, p.body, 2, [52, 58, 70], tw, 20);
}

// ---- page layout ----
function drawPage(): void {
  fill(0, 0, W, H, PAPER);
  frame(0, 0, W, H, INK, 8);

  // Masthead.
  fill(8, 8, W - 16, 112, NAVY);
  drawTextCentered(W / 2, 22, "THE WORLD IN ONE DAY", 4, WHITE);
  hline(120, 62, W - 240, GOLD, 2);
  drawTextCentered(W / 2, 74, "THURSDAY 19 NOVEMBER 2026", 3, GOLD);
  drawTextCentered(W / 2, 100, "SIX STORIES FROM AROUND THE GLOBE", 2, [200, 210, 225]);

  // Row 1: two lead stories.
  drawPanel({
    x: 8, y: 128, w: 500, h: 300,
    place: "SHENZHEN", kicker: "DIPLOMACY", color: NAVY,
    headline: "TRUMP, XI AND PUTIN MEET",
    body: "First three-way summit at APEC ends with a four-point Declaration Towards Peace on nuclear risk and energy.",
    art: artShenzhen, artW: 168, headScale: 3,
  });
  drawPanel({
    x: 516, y: 128, w: 500, h: 300,
    place: "THE HAGUE", kicker: "WORLD COURT", color: RED,
    headline: "MYANMAR GUILTY OF GENOCIDE",
    body: "UN court rules 9-6 that Myanmar committed genocide against the Rohingya in 2017. A first: a state held responsible.",
    art: artCourt, artW: 150, headScale: 3,
  });

  // Row 2: three stories.
  drawPanel({
    x: 8, y: 436, w: 330, h: 302,
    place: "NEW YORK", kicker: "MARKETS", color: TEAL,
    headline: "ANTHROPIC IPO: $81.3BN",
    body: "Claude maker prices at $83 a share, the largest IPO on record. Nasdaq debut as ANT.",
    art: artIpo, artW: 108, headScale: 3,
  });
  drawPanel({
    x: 347, y: 436, w: 330, h: 302,
    place: "UKRAINE", kicker: "WAR", color: STEEL,
    headline: "KERCH BRIDGE HIT AGAIN",
    body: "Ukrainian missiles hit the rail section, the third strike in four days. Trains halted.",
    art: artBridge, artW: 108, headScale: 3,
  });
  drawPanel({
    x: 686, y: 436, w: 330, h: 302,
    place: "GAZA", kicker: "MIDDLE EAST", color: OCHRE,
    headline: "ISRAEL ENDS GAZA RAID",
    body: "Tanks crossed the Yellow Line near Nuseirat to clear a tunnel. Raid ends Thursday.",
    art: artGaza, artW: 108, headScale: 3,
  });

  // Row 3: weather, full width.
  drawPanel({
    x: 8, y: 746, w: 1008, h: 230,
    place: "INDIA", kicker: "WEATHER", color: STORM,
    headline: "CYCLONE AKVAN NEARS EAST COAST",
    body: "Landfall due Friday between Narsapur and Puri, winds 90-100 km/h, gusting to 110. Red alert in force; evacuations under way along the Andhra Pradesh and Odisha coasts.",
    art: artCyclone, artW: 210, headScale: 4,
  });

  // Footer: sources.
  drawTextCentered(W / 2, 992, "SOURCES: REUTERS, AP, AFP, IMD, SEC FILINGS", 2, [90, 94, 104]);
}

// ---- PNG encoder (hand-rolled, deterministic) ----
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    buf.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const iend = Buffer.alloc(0);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", iend),
  ]);
}

function main(): void {
  drawPage();
  const png = encodePNG();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
}

main();
