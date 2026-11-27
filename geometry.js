import { createSimplex2D, fbm2D, SAFE_ZONES, SPAN_PRESETS } from './math.js';

function fmt(n) {
  return Number(n).toFixed(2);
}

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Converts a polyline into smooth cubic Bezier segments (appending onto an existing M command or starting new).
 */
function openCatmullRomSegments(pts, includeMove = true) {
  const n = pts.length;
  if (n < 2) return '';
  let d = includeMove ? `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}` : ` L ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${fmt(cp1x)} ${fmt(cp1y)}, ${fmt(cp2x)} ${fmt(cp2y)}, ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return d;
}

/**
 * Computes closed fluid ribbon Bezier path, crest path, and cross-ribbon depth lookups.
 */
export function computeRibbonGeometry(
  layer,
  { width, height, seed = 17, fluidity = 1.0, safeZone = 'bottom-left' }
) {
  const span = SPAN_PRESETS[layer.span] || SPAN_PRESETS.full;
  const sz = SAFE_ZONES[safeZone] || SAFE_ZONES['full-bleed'];
  const noise = createSimplex2D(Math.round(seed * 13 + layer.seedShift * 37));
  const shift = layer.seedShift + (seed % 97) * 0.17;

  const x0 = span.start * width;
  const x1 = span.end * width;
  const steps = 52;

  const topPts = [];
  const botPts = [];
  const xs = new Float32Array(steps + 1);
  const topYs = new Float32Array(steps + 1);
  const botYs = new Float32Array(steps + 1);

  const yBase = (layer.yPct / 100) * height;
  const baseThick = (layer.thicknessPct / 100) * height;
  const szMidY = sz.cy * height;
  const szRyPx = sz.ry * height;
  // Lock push direction once per ribbon so curves never flip mid-span across center safe-zones
  const ribbonPushDir = sz.pushBias !== 0 ? sz.pushBias : (yBase + baseThick * 0.5 < szMidY ? -1 : 1);

  let minY = height;
  let maxY = 0;

  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const x = x0 + u * (x1 - x0);
    const nx = x / Math.max(width, 1);

    const nWave = fbm2D(noise, nx * 2.15 + shift, shift * 0.63, 3);
    const wave =
      (nWave * 0.14 +
        Math.sin(nx * 4.5 + shift * 1.05) * 0.068 +
        Math.cos(nx * 2.2 - shift * 0.68) * 0.044) *
      height *
      fluidity;

    const nThick = fbm2D(noise, nx * 2.75 - shift, shift * 1.31, 2);
    let thickMod =
      0.56 +
      0.56 * (0.5 + 0.5 * nThick) +
      0.22 * Math.sin(nx * 6.1 + shift * 2.1);

    let spanTaper = 1.0;
    if (span.start > 0) {
      spanTaper *= smoothstep(0.0, 0.22, u);
    }
    if (span.end < 1) {
      spanTaper *= smoothstep(1.0, 0.78, u);
    }

    let yTop = yBase + wave;
    let thick = Math.max(2, baseThick * thickMod * spanTaper);

    // Safe-zone steering: smoothly bend and pinch ribbons around typography pocket
    if (layer.respectSafeZone !== false && sz.rx > 0 && sz.ry > 0) {
      const dx = (nx - sz.cx) / sz.rx;
      if (Math.abs(dx) < 1.35) {
        const hx = Math.max(0, 1 - (dx / 1.35) ** 2);
        const wx = hx * hx * (3 - 2 * hx);
        const yCenter = yTop + thick * 0.5;
        const dy = Math.abs(yCenter - szMidY) / szRyPx;
        if (dy < 1.42) {
          const hy = Math.max(0, 1 - (dy / 1.42) ** 2);
          const prox = wx * hy * hy * (3 - 2 * hy);
          yTop += ribbonPushDir * prox * szRyPx * 0.92;
          thick = Math.max(1.5, thick * (1 - 0.86 * prox));
        }
      }
    }

    const yBot = yTop + thick;
    topPts.push([x, yTop]);
    botPts.push([x, yBot]);
    xs[i] = x;
    topYs[i] = yTop;
    botYs[i] = yBot;

    if (yTop < minY) minY = yTop;
    if (yBot > maxY) maxY = yBot;
  }

  const crestPathD = openCatmullRomSegments(topPts, true);
  const botReversed = [...botPts].reverse();
  const pathD = crestPathD + openCatmullRomSegments(botReversed, false) + ' Z';

  function sampleAt(arr, x) {
    if (x <= xs[0]) return arr[0];
    if (x >= xs[steps]) return arr[steps];
    const u = ((x - xs[0]) / (xs[steps] - xs[0])) * steps;
    const idx = Math.min(steps - 1, Math.max(0, Math.floor(u)));
    const frac = u - idx;
    return arr[idx] + (arr[idx + 1] - arr[idx]) * frac;
  }

  return {
    pathD,
    crestPathD,
    topYAt: (x) => sampleAt(topYs, x),
    botYAt: (x) => sampleAt(botYs, x),
    bounds: {
      minX: Math.max(0, Math.floor(x0)),
      minY: Math.max(0, Math.floor(minY - 4)),
      maxX: Math.min(width, Math.ceil(x1)),
      maxY: Math.min(height, Math.ceil(maxY + 4))
    }
  };
}
