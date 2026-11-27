import {
  mulberry32,
  createSimplex2D,
  fbm2D,
  BAYER_8X8,
  hexToRgb,
  rgbaStr,
  SWATCH_BY_ID,
  EFFECT_BY_ID
} from './math.js';
import { computeRibbonGeometry } from './geometry.js';

function fmt(n) {
  return Number(n).toFixed(2);
}

function getSwatchHex(swatchId) {
  return (SWATCH_BY_ID[swatchId] || SWATCH_BY_ID.navy).hex;
}

/**
 * Generates deterministic ridge-crest-biased stipple points for 'organic-stipple'.
 */
function computeStippleDots(layer, geom, { width, height, seed }) {
  const { minX, minY, maxX, maxY } = geom.bounds;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const density = Math.max(0.35, Math.min(2.4, layer.density || 1.0));

  let step = Math.max(4.6, 9.2 / Math.sqrt(density));
  // Guard max dot budget for responsiveness and lean SVG paths
  const estCells = (bw * bh) / (step * step);
  if (estCells > 11000) {
    step = Math.sqrt((bw * bh) / 11000);
  }

  const rand = mulberry32(Math.round(seed * 31 + layer.seedShift * 101));
  const noise = createSimplex2D(Math.round(seed * 19 + layer.seedShift * 53));
  const dots = [];

  for (let gy = minY; gy <= maxY; gy += step) {
    for (let gx = minX; gx <= maxX; gx += step) {
      const px = gx + (rand() - 0.5) * step * 0.86;
      const py = gy + (rand() - 0.5) * step * 0.86;
      if (px < -4 || px > width + 4 || py < -4 || py > height + 4) continue;

      const yTop = geom.topYAt(px);
      const yBot = geom.botYAt(px);
      const thick = yBot - yTop;
      if (thick < 2 || py < yTop || py > yBot) continue;

      const t = (py - yTop) / thick; // 0 = top ridge crest, 1 = bottom trough
      const crest = Math.pow(Math.max(0, 1 - t), 1.38);
      const clus = 0.78 + 0.34 * noise(px * 0.011 + layer.seedShift, py * 0.011);

      const keepProb = Math.min(0.96, (0.11 + 0.87 * crest) * clus);
      if (rand() > keepProb) continue;

      const r =
        (0.95 + 1.25 * crest + 0.35 * rand()) *
        (0.84 + 0.16 * Math.min(1.6, density));
      dots.push({ x: px, y: py, r });
    }
  }

  return dots;
}

/**
 * Renders 'eroded-dither' or 'horizon-mist' pixel buffer tightly over geom.bounds.
 */
function renderPixelEffectBuffer(layer, geom, { width, height, seed, surface, maxResScale = 1 }) {
  const { minX, minY, maxX, maxY } = geom.bounds;
  const bwLogical = Math.max(1, maxX - minX);
  const bhLogical = Math.max(1, maxY - minY);

  // Cap internal pixel buffer size for crisp speed
  const targetMaxDim = 960;
  const rawScale = Math.min(maxResScale, 1.5);
  const clampScale = Math.min(rawScale, targetMaxDim / Math.max(bwLogical, bhLogical, 1));
  const pxScale = Math.max(0.5, clampScale);

  const w = Math.max(2, Math.round(bwLogical * pxScale));
  const h = Math.max(2, Math.round(bhLogical * pxScale));

  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  const imgData = octx.createImageData(w, h);
  const data = imgData.data;

  const hex = getSwatchHex(layer.swatch);
  const rgb = hexToRgb(hex);
  const isTealCompatible = layer.swatch !== 'teal' && layer.swatch !== 'champagne';
  const tealRgb = [26, 155, 166];

  const topArr = new Float32Array(w);
  const botArr = new Float32Array(w);
  for (let col = 0; col < w; col++) {
    const lx = minX + col / pxScale;
    topArr[col] = geom.topYAt(lx);
    botArr[col] = geom.botYAt(lx);
  }

  const rand = mulberry32(Math.round(seed * 47 + layer.seedShift * 89));
  const n1 = createSimplex2D(Math.round(seed * 23 + layer.seedShift * 61));
  const n2 = createSimplex2D(Math.round(seed * 37 + layer.seedShift * 113));

  if (layer.effect === 'horizon-mist') {
    const mistRgb = surface === 'dark' ? [107, 140, 188] : [167, 190, 219];
    const warmRgb = [246, 242, 228];
    for (let row = 0; row < h; row++) {
      const ly = minY + row / pxScale;
      const uy = ly / Math.max(height, 1);
      const by = (row >> 1) & 7;
      for (let col = 0; col < w; col++) {
        const lx = minX + col / pxScale;
        const ux = lx / Math.max(width, 1);
        const bx = (col >> 1) & 7;
        const pIdx = (row * w + col) * 4;

        const axial = Math.max(0, Math.min(1, ux * 0.55 + uy * 0.45));
        const cloud = 0.5 + 0.5 * fbm2D(n1, ux * 2.2 + layer.seedShift, uy * 2.2, 3);
        const dither = BAYER_8X8[by * 8 + bx];
        const mistMix = Math.min(1, axial * 0.65 + cloud * 0.35);

        let r = rgb[0] + (mistRgb[0] - rgb[0]) * mistMix;
        let g = rgb[1] + (mistRgb[1] - rgb[1]) * mistMix;
        let b = rgb[2] + (mistRgb[2] - rgb[2]) * mistMix;

        if (mistMix > 0.52 && dither < (mistMix - 0.52) * 0.7) {
          r = r + (warmRgb[0] - r) * 0.22;
          g = g + (warmRgb[1] - g) * 0.22;
          b = b + (warmRgb[2] - b) * 0.22;
        }

        const grain = (rand() - rand()) * 11;
        data[pIdx] = Math.max(0, Math.min(255, Math.round(r + grain)));
        data[pIdx + 1] = Math.max(0, Math.min(255, Math.round(g + grain)));
        data[pIdx + 2] = Math.max(0, Math.min(255, Math.round(b + grain)));
        data[pIdx + 3] = 255;
      }
    }
    octx.putImageData(imgData, 0, 0);
    return { canvas: off, x: minX, y: minY, w: bwLogical, h: bhLogical };
  }

  // 'eroded-dither': Structured dot-matrix + dry-brush fracture + 8x8 Bayer halftone
  const density = Math.max(0.4, Math.min(2.2, layer.density || 1.0));
  const pitch = Math.max(6.5, 10.5 / Math.sqrt(density));
  const cols = Math.ceil(bwLogical / pitch) + 2;
  const rows = Math.ceil(bhLogical / pitch) + 2;
  const cellKeep = new Float32Array(cols * rows);
  const cellJx = new Float32Array(cols * rows);
  const cellJy = new Float32Array(cols * rows);
  const cellTeal = new Uint8Array(cols * rows);

  for (let i = 0; i < cellKeep.length; i++) {
    cellKeep[i] = rand();
    cellJx[i] = (rand() - 0.5) * 1.4;
    cellJy[i] = (rand() - 0.5) * 1.4;
    cellTeal[i] = isTealCompatible && rand() < 0.07 ? 1 : 0;
  }

  for (let row = 0; row < h; row++) {
    const ly = minY + row / pxScale;
    const gy = Math.floor((ly - minY) / pitch);
    const cy = minY + gy * pitch + pitch * 0.5;
    const by = (row >> 1) & 7;

    for (let col = 0; col < w; col++) {
      const yTop = topArr[col];
      const yBot = botArr[col];
      const thick = yBot - yTop;
      const pIdx = (row * w + col) * 4;

      if (thick < 2 || ly < yTop - 2 || ly > yBot + 2) {
        data[pIdx + 3] = 0;
        continue;
      }

      const lx = minX + col / pxScale;
      const t = Math.max(0, Math.min(1, (ly - yTop) / thick));
      const crest = Math.pow(1 - t, 1.15);

      const gx = Math.floor((lx - minX) / pitch);
      const cx = minX + gx * pitch + pitch * 0.5;
      const cIdx = Math.max(0, Math.min(cellKeep.length - 1, gy * cols + gx));

      const macro = 0.5 + 0.5 * fbm2D(n1, lx * 0.008 + layer.seedShift, ly * 0.008, 3);
      const strength = Math.min(1, (0.32 + 0.68 * crest) * (0.45 + 0.65 * macro));

      // Structured dot-matrix ink glyph
      const dx = lx - (cx + cellJx[cIdx]);
      const dy = ly - (cy + cellJy[cIdx]);
      const dist = Math.hypot(dx, dy);
      let dotAlpha = 0;
      if (cellKeep[cIdx] < 0.35 + strength * 0.72) {
        const radius = (0.9 + strength * 1.85) * (0.85 + 0.15 * density);
        const edgeBreak = n2(lx * 0.21, ly * 0.21) * 0.75;
        if (dist + edgeBreak < radius) {
          dotAlpha = Math.min(1, (radius - dist - edgeBreak) * 1.35) * (0.55 + 0.45 * strength);
        }
      }

      // Dry-brush stipple + 8x8 Bayer ordered dither
      const bx = (col >> 1) & 7;
      const bayer = BAYER_8X8[by * 8 + bx];
      const dry = fbm2D(n2, lx * 0.055 + ly * 0.015, ly * 0.085 - lx * 0.012, 3);
      const ditherField = strength * 0.72 + dry * 0.44;
      const ditherOn = ditherField > 0.34 && bayer < (ditherField - 0.16) * 0.92 ? 1 : 0;
      const scrapeOn = dry > 0.25 && strength > 0.25 && rand() < strength * 0.78 ? 1 : 0;

      const alpha = Math.min(1, Math.max(dotAlpha, ditherOn * (0.30 + strength * 0.42), scrapeOn * 0.44));
      if (alpha <= 0.02) {
        data[pIdx + 3] = 0;
        continue;
      }

      const target = cellTeal[cIdx] && strength > 0.3 ? tealRgb : rgb;
      data[pIdx] = target[0];
      data[pIdx + 1] = target[1];
      data[pIdx + 2] = target[2];
      data[pIdx + 3] = Math.round(alpha * 255);
    }
  }

  octx.putImageData(imgData, 0, 0);
  return { canvas: off, x: minX, y: minY, w: bwLogical, h: bhLogical };
}

/**
 * Draws any of the 5 vector pattern tiles into a Canvas2D tile for createPattern().
 */
function createCanvasPattern(ctx, effect, hex, density, scale) {
  const s = Math.max(0.5, Math.min(2.2, density || 1.0));
  const strokeColor = rgbaStr(hex, 0.78);
  const strokeSoft = rgbaStr(hex, 0.48);

  const tile = document.createElement('canvas');
  let tw = 48;
  let th = 48;

  if (effect === 'seigaiha-wave') {
    tw = 48 / s;
    th = 24 / s;
  } else if (effect === 'water-ripples') {
    tw = 112 / s;
    th = 44 / s;
  } else if (effect === 'songket-diamond') {
    tw = 32 / s;
    th = 32 / s;
  } else if (effect === 'shippo-rings') {
    tw = 40 / s;
    th = 40 / s;
  } else if (effect === 'silk-contours') {
    tw = 120 / s;
    th = 32 / s;
  }

  const dpr = Math.max(1, scale);
  tile.width = Math.max(8, Math.round(tw * dpr));
  tile.height = Math.max(8, Math.round(th * dpr));
  const tctx = tile.getContext('2d');
  tctx.scale(tile.width / (effect === 'water-ripples' ? 112 : effect === 'silk-contours' ? 120 : effect === 'seigaiha-wave' ? 48 : effect === 'shippo-rings' ? 40 : 32), tile.height / (effect === 'water-ripples' ? 44 : effect === 'silk-contours' ? 32 : effect === 'seigaiha-wave' ? 24 : effect === 'shippo-rings' ? 40 : 32));
  tctx.strokeStyle = strokeColor;
  tctx.fillStyle = strokeColor;
  tctx.lineWidth = 1.05;

  if (effect === 'seigaiha-wave') {
    const centers = [[24, 24], [0, 12], [48, 12], [24, 0]];
    for (const [cx, cy] of centers) {
      for (const r of [22, 16, 10, 4]) {
        tctx.beginPath();
        tctx.arc(cx, cy, r, 0, Math.PI * 2);
        tctx.stroke();
      }
    }
  } else if (effect === 'shippo-rings') {
    const centers = [[20, 20], [0, 0], [40, 0], [0, 40], [40, 40]];
    for (const [cx, cy] of centers) {
      tctx.beginPath();
      tctx.arc(cx, cy, 19, 0, Math.PI * 2);
      tctx.stroke();
    }
    tctx.strokeStyle = strokeSoft;
    tctx.beginPath();
    tctx.arc(20, 20, 3.5, 0, Math.PI * 2);
    tctx.stroke();
  } else if (effect === 'water-ripples') {
    const curves = [
      [-8, 10, 18, 4, 44, 10, 70, 16, 96, 10, 124, 10],
      [-8, 24, 24, 30, 56, 24, 88, 18, 120, 24, 124, 24],
      [-8, 37, 30, 32, 62, 37, 94, 42, 120, 37, 124, 37]
    ];
    for (const c of curves) {
      tctx.beginPath();
      tctx.moveTo(c[0], c[1]);
      tctx.quadraticCurveTo(c[2], c[3], c[4], c[5]);
      tctx.quadraticCurveTo(c[6], c[7], c[8], c[9]);
      tctx.stroke();
    }
    for (const [ex, ey, rx, ry] of [[30, 14, 18, 4.5], [30, 14, 9, 2.1], [86, 30, 20, 5], [86, 30, 10, 2.2]]) {
      tctx.beginPath();
      tctx.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
      tctx.stroke();
    }
  } else if (effect === 'songket-diamond') {
    tctx.beginPath();
    tctx.moveTo(16, 0); tctx.lineTo(32, 16); tctx.lineTo(16, 32); tctx.lineTo(0, 16); tctx.closePath();
    tctx.stroke();
    tctx.strokeStyle = strokeSoft;
    tctx.beginPath();
    tctx.moveTo(16, 6); tctx.lineTo(26, 16); tctx.lineTo(16, 26); tctx.lineTo(6, 16); tctx.closePath();
    tctx.stroke();
    for (const [dx, dy] of [[16, 0], [32, 16], [16, 32], [0, 16]]) {
      tctx.beginPath();
      tctx.arc(dx, dy, 1.2, 0, Math.PI * 2);
      tctx.fill();
    }
  } else if (effect === 'silk-contours') {
    for (const y of [6, 14, 22, 30]) {
      tctx.beginPath();
      tctx.moveTo(0, y);
      tctx.bezierCurveTo(35, y - 5, 85, y + 5, 120, y);
      tctx.stroke();
    }
  }

  return ctx.createPattern(tile, 'repeat');
}

/**
 * Generates SVG <pattern> markup matching createCanvasPattern() 1:1.
 */
function buildSvgPatternDef(patId, effect, hex, density) {
  const s = Math.max(0.5, Math.min(2.2, density || 1.0));
  const strokeA = rgbaStr(hex, 0.78);
  const strokeB = rgbaStr(hex, 0.48);

  if (effect === 'seigaiha-wave') {
    const w = fmt(48 / s);
    const h = fmt(24 / s);
    return `<pattern id="${patId}" width="${w}" height="${h}" viewBox="0 0 48 24" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="${strokeA}" stroke-width="1.05">
        <circle cx="24" cy="24" r="22"/><circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="4"/>
        <circle cx="0" cy="12" r="22"/><circle cx="0" cy="12" r="16"/><circle cx="0" cy="12" r="10"/><circle cx="0" cy="12" r="4"/>
        <circle cx="48" cy="12" r="22"/><circle cx="48" cy="12" r="16"/><circle cx="48" cy="12" r="10"/><circle cx="48" cy="12" r="4"/>
        <circle cx="24" cy="0" r="22"/><circle cx="24" cy="0" r="16"/><circle cx="24" cy="0" r="10"/>
      </g>
    </pattern>`;
  }

  if (effect === 'shippo-rings') {
    const w = fmt(40 / s);
    return `<pattern id="${patId}" width="${w}" height="${w}" viewBox="0 0 40 40" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="${strokeA}" stroke-width="1">
        <circle cx="20" cy="20" r="19"/><circle cx="0" cy="0" r="19"/><circle cx="40" cy="0" r="19"/><circle cx="0" cy="40" r="19"/><circle cx="40" cy="40" r="19"/>
        <circle cx="20" cy="20" r="3.5" stroke="${strokeB}"/>
      </g>
    </pattern>`;
  }

  if (effect === 'water-ripples') {
    const w = fmt(112 / s);
    const h = fmt(44 / s);
    return `<pattern id="${patId}" width="${w}" height="${h}" viewBox="0 0 112 44" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="${strokeA}" stroke-width="1.05">
        <path d="M -8 10 Q 18 4 44 10 T 96 10 T 124 10"/>
        <path d="M -8 24 Q 24 30 56 24 T 112 24"/>
        <path d="M -8 37 Q 30 32 62 37 T 120 37"/>
        <ellipse cx="30" cy="14" rx="18" ry="4.5"/><ellipse cx="30" cy="14" rx="9" ry="2.1"/>
        <ellipse cx="86" cy="30" rx="20" ry="5"/><ellipse cx="86" cy="30" rx="10" ry="2.2"/>
      </g>
    </pattern>`;
  }

  if (effect === 'songket-diamond') {
    const w = fmt(32 / s);
    return `<pattern id="${patId}" width="${w}" height="${w}" viewBox="0 0 32 32" patternUnits="userSpaceOnUse">
      <g fill="none" stroke="${strokeA}" stroke-width="1">
        <path d="M 16 0 L 32 16 L 16 32 L 0 16 Z"/>
        <path d="M 16 6 L 26 16 L 16 26 L 6 16 Z" stroke="${strokeB}"/>
        <circle cx="16" cy="0" r="1.2" fill="${strokeA}" stroke="none"/>
        <circle cx="32" cy="16" r="1.2" fill="${strokeA}" stroke="none"/>
        <circle cx="16" cy="32" r="1.2" fill="${strokeA}" stroke="none"/>
        <circle cx="0" cy="16" r="1.2" fill="${strokeA}" stroke="none"/>
      </g>
    </pattern>`;
  }

  // 'silk-contours'
  const w = fmt(120 / s);
  const h = fmt(32 / s);
  return `<pattern id="${patId}" width="${w}" height="${h}" viewBox="0 0 120 32" patternUnits="userSpaceOnUse">
    <g fill="none" stroke="${strokeA}" stroke-width="1">
      <path d="M 0 6 C 35 1, 85 11, 120 6"/>
      <path d="M 0 14 C 35 9, 85 19, 120 14"/>
      <path d="M 0 22 C 35 17, 85 27, 120 22"/>
      <path d="M 0 30 C 35 25, 85 35, 120 30"/>
    </g>
  </pattern>`;
}

function drawBackground(ctx, width, height, surface) {
  if (surface === 'dark') {
    const g = ctx.createLinearGradient(0, 0, width * 0.18, height);
    g.addColorStop(0, '#0C162C');
    g.addColorStop(0.45, '#1D3766');
    g.addColorStop(1, '#3B5D93');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = '#F5F2EB';
    ctx.fillRect(0, 0, width, height);
    const rg = ctx.createRadialGradient(width * 0.22, height * 0.22, 10, width * 0.22, height * 0.22, Math.max(width, height) * 0.75);
    rg.addColorStop(0, 'rgba(246, 242, 228, 0.85)');
    rg.addColorStop(1, 'rgba(245, 242, 235, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, width, height);
  }
}

/**
 * Renders all visible layers onto a Canvas2D element at the given resolution scale.
 */
export function renderToCanvas(canvas, state, { scale = 1 } = {}) {
  const t0 = performance.now();
  const { width, height, surface, seed, fluidity, safeZone, layers } = state;

  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(scale, scale);

  drawBackground(ctx, width, height, surface);

  let totalDots = 0;
  let visibleCount = 0;

  for (const layer of layers) {
    if (!layer.visible) continue;
    visibleCount++;

    const geom = computeRibbonGeometry(layer, { width, height, seed, fluidity, safeZone });
    const clipPath = new Path2D(geom.pathD);
    const hex = getSwatchHex(layer.swatch);

    ctx.save();
    ctx.globalAlpha = Math.max(0.01, Math.min(1, layer.opacity));
    ctx.clip(clipPath);

    if (layer.fillWash > 0.004 && layer.effect !== 'horizon-mist') {
      ctx.fillStyle = rgbaStr(hex, layer.fillWash);
      ctx.fillRect(geom.bounds.minX - 2, geom.bounds.minY - 2, geom.bounds.maxX - geom.bounds.minX + 4, geom.bounds.maxY - geom.bounds.minY + 4);
    }

    if (layer.effect === 'organic-stipple') {
      const dots = computeStippleDots(layer, geom, { width, height, seed });
      totalDots += dots.length;
      ctx.fillStyle = hex;
      ctx.beginPath();
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        ctx.moveTo(d.x + d.r, d.y);
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      }
      ctx.fill();
    } else if (layer.effect === 'eroded-dither' || layer.effect === 'horizon-mist') {
      const buf = renderPixelEffectBuffer(layer, geom, {
        width,
        height,
        seed,
        surface,
        maxResScale: scale
      });
      ctx.drawImage(buf.canvas, buf.x, buf.y, buf.w, buf.h);
    } else {
      const pat = createCanvasPattern(ctx, layer.effect, hex, layer.density, scale);
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(geom.bounds.minX - 2, geom.bounds.minY - 2, geom.bounds.maxX - geom.bounds.minX + 4, geom.bounds.maxY - geom.bounds.minY + 4);
      }
    }

    ctx.restore();

    // Optional razor-sharp crest hairline outside clip
    if (layer.crestHairline && layer.crestHairline !== 'off') {
      const isCrisp = layer.crestHairline === 'crisp';
      ctx.save();
      ctx.globalAlpha = Math.max(0.05, Math.min(1, layer.opacity * (isCrisp ? 0.65 : 0.36)));
      ctx.strokeStyle = hex;
      ctx.lineWidth = isCrisp ? 1.35 : 0.85;
      ctx.stroke(new Path2D(geom.crestPathD));
      ctx.restore();
    }
  }

  ctx.restore();

  return {
    renderMs: Math.round((performance.now() - t0) * 10) / 10,
    totalDots,
    visibleCount
  };
}

/**
 * Generates a self-contained layered SVG matching the live canvas for Figma import/copy.
 * Never includes the live Type Preview overlay.
 */
export function buildLayeredSvg(state) {
  const { width, height, surface, seed, fluidity, safeZone, layers } = state;
  const defs = [];
  const groups = [];

  if (surface === 'dark') {
    defs.push(
      `<linearGradient id="sutero_bg_grad" x1="0" y1="0" x2="0.18" y2="1">` +
      `<stop offset="0%" stop-color="#0C162C"/>` +
      `<stop offset="45%" stop-color="#1D3766"/>` +
      `<stop offset="100%" stop-color="#3B5D93"/>` +
      `</linearGradient>`
    );
  }

  layers.forEach((layer, index) => {
    if (!layer.visible) return;
    const geom = computeRibbonGeometry(layer, { width, height, seed, fluidity, safeZone });
    const hex = getSwatchHex(layer.swatch);
    const clipId = `clip_layer_${index + 1}`;
    const safeName = (layer.name || EFFECT_BY_ID[layer.effect]?.name || layer.effect).replace(/["<>]/g, '');

    defs.push(`<clipPath id="${clipId}"><path d="${geom.pathD}"/></clipPath>`);

    const innerParts = [];
    if (layer.fillWash > 0.004 && layer.effect !== 'horizon-mist') {
      innerParts.push(
        `<rect x="${geom.bounds.minX}" y="${geom.bounds.minY}" width="${geom.bounds.maxX - geom.bounds.minX}" height="${geom.bounds.maxY - geom.bounds.minY}" fill="${hex}" fill-opacity="${fmt(layer.fillWash)}"/>`
      );
    }

    if (layer.effect === 'organic-stipple') {
      const dots = computeStippleDots(layer, geom, { width, height, seed });
      // Pack all dots into one compound vector path so Figma creates one clean editable object per layer
      const chunks = [];
      for (let i = 0; i < dots.length; i++) {
        const { x, y, r } = dots[i];
        const rx = Number(r).toFixed(2);
        const dr = Number(r * 2).toFixed(2);
        chunks.push(
          `M${Number(x - r).toFixed(1)} ${Number(y).toFixed(1)}a${rx} ${rx} 0 1 0 ${dr} 0a${rx} ${rx} 0 1 0 -${dr} 0`
        );
      }
      if (chunks.length) {
        innerParts.push(`<path d="${chunks.join('')}" fill="${hex}"/>`);
      }
    } else if (layer.effect === 'eroded-dither' || layer.effect === 'horizon-mist') {
      const buf = renderPixelEffectBuffer(layer, geom, {
        width,
        height,
        seed,
        surface,
        maxResScale: 1.5
      });
      const dataUrl = buf.canvas.toDataURL('image/png');
      innerParts.push(
        `<image x="${fmt(buf.x)}" y="${fmt(buf.y)}" width="${fmt(buf.w)}" height="${fmt(buf.h)}" preserveAspectRatio="none" href="${dataUrl}"/>`
      );
    } else {
      const patId = `pat_layer_${index + 1}`;
      defs.push(buildSvgPatternDef(patId, layer.effect, hex, layer.density));
      innerParts.push(
        `<rect x="${geom.bounds.minX}" y="${geom.bounds.minY}" width="${geom.bounds.maxX - geom.bounds.minX}" height="${geom.bounds.maxY - geom.bounds.minY}" fill="url(#${patId})"/>`
      );
    }

    let hairlineMarkup = '';
    if (layer.crestHairline && layer.crestHairline !== 'off') {
      const isCrisp = layer.crestHairline === 'crisp';
      hairlineMarkup = `\n    <path d="${geom.crestPathD}" fill="none" stroke="${hex}" stroke-opacity="${fmt(isCrisp ? 0.65 : 0.36)}" stroke-width="${isCrisp ? '1.35' : '0.85'}"/>`;
    }

    groups.push(
      `  <g id="layer-${String(index + 1).padStart(2, '0')}" data-name="${safeName}" opacity="${fmt(layer.opacity)}">\n` +
      `    <g clip-path="url(#${clipId})">\n      ${innerParts.join('\n      ')}\n    </g>${hairlineMarkup}\n` +
      `  </g>`
    );
  });

  const bgRect = surface === 'dark'
    ? `<rect id="background" width="${width}" height="${height}" fill="url(#sutero_bg_grad)"/>`
    : `<rect id="background" width="${width}" height="${height}" fill="#F5F2EB"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n  <defs>\n    ${defs.join('\n    ')}\n  </defs>\n  ${bgRect}\n${groups.join('\n')}\n</svg>`;
}

/**
 * Exports a clean PNG DataURL at 1x/2x/3x scale without Type Preview overlays.
 */
export function exportCompositePng(state, scale = 2) {
  const off = document.createElement('canvas');
  renderToCanvas(off, state, { scale });
  return off.toDataURL('image/png');
}
