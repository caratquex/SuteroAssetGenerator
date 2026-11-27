/**
 * Deterministic PRNG, 2D Simplex noise, FBM, Bayer 8x8 matrix,
 * Sutero locked palette swatches, presets, safe-zones, and starter recipes.
 */

export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

const GRAD3 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]
];

export function createSimplex2D(seed = 1) {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  return function simplex2D(xin, yin) {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = xin - X0;
    const y0 = yin - Y0;

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = permMod12[ii + perm[jj]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1]];
    const gi2 = permMod12[ii + 1 + perm[jj + 1]];

    let n0 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      const g = GRAD3[gi0];
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }

    let n1 = 0;
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      const g = GRAD3[gi1];
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }

    let n2 = 0;
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      const g = GRAD3[gi2];
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }

    return 70 * (n0 + n1 + n2);
  };
}

export function fbm2D(noise, x, y, octaves = 3, lacunarity = 1.92, gain = 0.48) {
  let sum = 0;
  let amp = 0.55;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum / (norm || 1);
}

const BAYER_RAW_8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21
];

export const BAYER_8X8 = Float32Array.from(BAYER_RAW_8, (v) => (v + 0.5) / 64);

export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const n = parseInt(clean, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbaStr(hex, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha).toFixed(3)})`;
}

export const SUTERO_SWATCHES = [
  { id: 'midnight', name: 'Deep Midnight Indigo', hex: '#0C162C', group: 'dark' },
  { id: 'navy', name: 'Institutional Navy', hex: '#142648', group: 'dark' },
  { id: 'navy-deep', name: 'Rich Cobalt Navy', hex: '#1D3766', group: 'dark' },
  { id: 'navy-mid', name: 'Luminous Steel-Cobalt', hex: '#3B5D93', group: 'mid' },
  { id: 'slate', name: 'Cerulean Horizon Sky', hex: '#6B8CBC', group: 'mid' },
  { id: 'slate-gray', name: 'Slate Contour Blue', hex: '#5C789E', group: 'mid' },
  { id: 'cool-mist', name: 'Pale Horizon Mist', hex: '#A7BEDB', group: 'light' },
  { id: 'warm-mist', name: 'Warm Dawn Cream', hex: '#F6F2E4', group: 'light' },
  { id: 'ivory', name: 'Canvas Ivory', hex: '#F5F2EB', group: 'light' },
  { id: 'teal', name: 'Muted Teal', hex: '#1A9BA6', group: 'accent' },
  { id: 'champagne', name: 'Warm Dawn Highlight', hex: '#EBE3CC', group: 'accent' }
];

export const SWATCH_BY_ID = Object.fromEntries(SUTERO_SWATCHES.map((s) => [s.id, s]));

export const CANVAS_PRESETS = {
  hero: { id: 'hero', label: 'Hero 696×868', width: 696, height: 868 },
  approach: { id: 'approach', label: 'Approach 1408×704', width: 1408, height: 704 },
  footer: { id: 'footer', label: 'Footer 1408×684', width: 1408, height: 684 },
  desktop: { id: 'desktop', label: 'Desktop 1440×900', width: 1440, height: 900 }
};

export const SAFE_ZONES = {
  'bottom-left': {
    id: 'bottom-left',
    label: 'Bottom-Left Pocket',
    cx: 0.24,
    cy: 0.78,
    rx: 0.30,
    ry: 0.26,
    pushBias: -1 // steer ribbons up/away cleanly
  },
  'upper-left': {
    id: 'upper-left',
    label: 'Upper-Left Editorial',
    cx: 0.25,
    cy: 0.28,
    rx: 0.32,
    ry: 0.28,
    pushBias: 1
  },
  center: {
    id: 'center',
    label: 'Center Wordmark',
    cx: 0.50,
    cy: 0.50,
    rx: 0.28,
    ry: 0.18,
    pushBias: 0
  },
  diagonal: {
    id: 'diagonal',
    label: 'Diagonal Sweep',
    cx: 0.22,
    cy: 0.68,
    rx: 0.26,
    ry: 0.28,
    pushBias: -1
  },
  'full-bleed': {
    id: 'full-bleed',
    label: 'Full-Bleed (No Cutout)',
    cx: -1,
    cy: -1,
    rx: 0,
    ry: 0,
    pushBias: 0
  }
};

export const EFFECT_DEFS = [
  { id: 'organic-stipple', name: 'Organic Ridge Stipple', kind: 'Vector' },
  { id: 'eroded-dither', name: 'Eroded Dot-Matrix + Bayer', kind: 'Pixel' },
  { id: 'horizon-mist', name: 'Horizon Mist + Paper Grain', kind: 'Pixel' },
  { id: 'seigaiha-wave', name: 'Seigaiha Wave Arcs', kind: 'Vector' },
  { id: 'water-ripples', name: 'Water-Silk Ripples', kind: 'Vector' },
  { id: 'songket-diamond', name: 'Songket Diamond Weave', kind: 'Vector' },
  { id: 'shippo-rings', name: 'Shippo Compass Rings', kind: 'Vector' },
  { id: 'silk-contours', name: 'Parallel Silk Contours', kind: 'Vector' }
];

export const EFFECT_BY_ID = Object.fromEntries(EFFECT_DEFS.map((e) => [e.id, e]));

export const SPAN_PRESETS = {
  full: { id: 'full', label: 'Full Width', start: -0.04, end: 1.04 },
  left: { id: 'left', label: 'Left-Biased', start: -0.04, end: 0.72 },
  right: { id: 'right', label: 'Right Pocket', start: 0.34, end: 1.04 },
  center: { id: 'center', label: 'Center Drift', start: 0.14, end: 0.88 }
};

let nextLayerUid = 1;
export function makeLayer(overrides = {}) {
  return {
    id: `layer_${nextLayerUid++}`,
    name: overrides.name || '',
    visible: overrides.visible !== undefined ? overrides.visible : true,
    effect: overrides.effect || 'organic-stipple',
    swatch: overrides.swatch || 'navy',
    yPct: overrides.yPct !== undefined ? overrides.yPct : 42,
    thicknessPct: overrides.thicknessPct !== undefined ? overrides.thicknessPct : 28,
    span: overrides.span || 'full',
    density: overrides.density !== undefined ? overrides.density : 1.05,
    opacity: overrides.opacity !== undefined ? overrides.opacity : 0.85,
    crestHairline: overrides.crestHairline || 'fine', // 'off' | 'fine' | 'crisp'
    respectSafeZone: overrides.respectSafeZone !== undefined ? overrides.respectSafeZone : true,
    fillWash: overrides.fillWash !== undefined ? overrides.fillWash : 0.06,
    seedShift: overrides.seedShift !== undefined ? overrides.seedShift : nextLayerUid * 1.73
  };
}

export function getRecipe(recipeId) {
  if (recipeId === 'midnight-horizon') {
    return {
      id: 'midnight-horizon',
      name: 'Midnight Horizon Strata',
      preset: 'hero',
      surface: 'dark',
      safeZone: 'center',
      fluidity: 0.92,
      typePreview: 'wordmark',
      layers: [
        makeLayer({
          name: 'Horizon Mist Wash',
          effect: 'horizon-mist',
          swatch: 'navy-deep',
          yPct: 48,
          thicknessPct: 65,
          span: 'full',
          density: 1.0,
          opacity: 0.94,
          crestHairline: 'off',
          respectSafeZone: false,
          fillWash: 0,
          seedShift: 1.2
        }),
        makeLayer({
          name: 'Upper Shippo Canopy',
          effect: 'shippo-rings',
          swatch: 'cool-mist',
          yPct: 18,
          thicknessPct: 30,
          span: 'left',
          density: 0.95,
          opacity: 0.36,
          crestHairline: 'fine',
          respectSafeZone: true,
          fillWash: 0.08,
          seedShift: 2.8
        }),
        makeLayer({
          name: 'Mid Silk Ripples',
          effect: 'water-ripples',
          swatch: 'slate',
          yPct: 42,
          thicknessPct: 26,
          span: 'full',
          density: 1.05,
          opacity: 0.48,
          crestHairline: 'fine',
          respectSafeZone: true,
          fillWash: 0.10,
          seedShift: 4.5
        }),
        makeLayer({
          name: 'Lower Eroded Dither',
          effect: 'eroded-dither',
          swatch: 'warm-mist',
          yPct: 68,
          thicknessPct: 32,
          span: 'right',
          density: 1.15,
          opacity: 0.72,
          crestHairline: 'off',
          respectSafeZone: true,
          fillWash: 0.04,
          seedShift: 6.1
        }),
        makeLayer({
          name: 'Crest Ridge Stipple',
          effect: 'organic-stipple',
          swatch: 'ivory',
          yPct: 74,
          thicknessPct: 24,
          span: 'full',
          density: 1.10,
          opacity: 0.80,
          crestHairline: 'crisp',
          respectSafeZone: true,
          fillWash: 0.05,
          seedShift: 8.3
        }),
        makeLayer({
          name: 'Horizon Seigaiha Base',
          effect: 'seigaiha-wave',
          swatch: 'teal',
          yPct: 88,
          thicknessPct: 22,
          span: 'right',
          density: 1.15,
          opacity: 0.42,
          crestHairline: 'fine',
          respectSafeZone: true,
          fillWash: 0.07,
          seedShift: 10.4
        })
      ]
    };
  }

  if (recipeId === 'editorial-tapestry') {
    return {
      id: 'editorial-tapestry',
      name: 'Editorial Tapestry',
      preset: 'approach',
      surface: 'light',
      safeZone: 'upper-left',
      fluidity: 0.95,
      typePreview: 'headline',
      layers: [
        makeLayer({
          name: 'Background Silk Contours',
          effect: 'silk-contours',
          swatch: 'slate',
          yPct: 36,
          thicknessPct: 58,
          span: 'full',
          density: 0.95,
          opacity: 0.46,
          crestHairline: 'off',
          respectSafeZone: true,
          fillWash: 0.05,
          seedShift: 1.9
        }),
        makeLayer({
          name: 'Songket Weave Canopy',
          effect: 'songket-diamond',
          swatch: 'navy-mid',
          yPct: 24,
          thicknessPct: 34,
          span: 'right',
          density: 1.1,
          opacity: 0.42,
          crestHairline: 'fine',
          respectSafeZone: true,
          fillWash: 0.12,
          seedShift: 3.4
        }),
        makeLayer({
          name: 'Digital Eroded Dither',
          effect: 'eroded-dither',
          swatch: 'navy-deep',
          yPct: 54,
          thicknessPct: 32,
          span: 'center',
          density: 1.15,
          opacity: 0.70,
          crestHairline: 'off',
          respectSafeZone: true,
          fillWash: 0.04,
          seedShift: 5.7
        }),
        makeLayer({
          name: 'Warm Dawn Silk Pocket',
          effect: 'organic-stipple',
          swatch: 'champagne',
          yPct: 68,
          thicknessPct: 24,
          span: 'right',
          density: 1.25,
          opacity: 0.90,
          crestHairline: 'fine',
          respectSafeZone: true,
          fillWash: 0.24,
          seedShift: 7.1
        }),
        makeLayer({
          name: 'Navy Ridge Stipple',
          effect: 'organic-stipple',
          swatch: 'navy',
          yPct: 78,
          thicknessPct: 26,
          span: 'full',
          density: 1.12,
          opacity: 0.85,
          crestHairline: 'crisp',
          respectSafeZone: true,
          fillWash: 0.06,
          seedShift: 9.2
        }),
        makeLayer({
          name: 'Teal Horizon Wave',
          effect: 'seigaiha-wave',
          swatch: 'teal',
          yPct: 90,
          thicknessPct: 18,
          span: 'right',
          density: 1.2,
          opacity: 0.44,
          crestHairline: 'fine',
          respectSafeZone: true,
          fillWash: 0.07,
          seedShift: 11.5
        })
      ]
    };
  }

  // Default: 'silk-ridge-stipple' (Closest to user's uploaded reference in latest Sutero blue-horizon palette)
  return {
    id: 'silk-ridge-stipple',
    name: 'Silk Ridge Stipple',
    preset: 'desktop',
    surface: 'light',
    safeZone: 'bottom-left',
    fluidity: 1.05,
    typePreview: 'headline',
    layers: [
      makeLayer({
        name: 'Upper Cerulean Drift',
        effect: 'organic-stipple',
        swatch: 'slate',
        yPct: 14,
        thicknessPct: 34,
        span: 'left',
        density: 0.95,
        opacity: 0.78,
        crestHairline: 'fine',
        respectSafeZone: true,
        fillWash: 0.06,
        seedShift: 1.4
      }),
      makeLayer({
        name: 'Upper-Right Cobalt Crest',
        effect: 'organic-stipple',
        swatch: 'navy-deep',
        yPct: 16,
        thicknessPct: 26,
        span: 'right',
        density: 1.32,
        opacity: 0.90,
        crestHairline: 'crisp',
        respectSafeZone: true,
        fillWash: 0.11,
        seedShift: 3.1
      }),
      makeLayer({
        name: 'Mid Steel-Cobalt Stratum',
        effect: 'water-ripples',
        swatch: 'navy-mid',
        yPct: 36,
        thicknessPct: 24,
        span: 'full',
        density: 1.08,
        opacity: 0.44,
        crestHairline: 'fine',
        respectSafeZone: true,
        fillWash: 0.07,
        seedShift: 4.9
      }),
      makeLayer({
        name: 'Center-Right Cobalt Dither',
        effect: 'eroded-dither',
        swatch: 'navy-deep',
        yPct: 48,
        thicknessPct: 28,
        span: 'right',
        density: 1.14,
        opacity: 0.76,
        crestHairline: 'off',
        respectSafeZone: true,
        fillWash: 0.04,
        seedShift: 6.7
      }),
      makeLayer({
        name: 'Warm Dawn Pocket',
        effect: 'organic-stipple',
        swatch: 'champagne',
        yPct: 68,
        thicknessPct: 24,
        span: 'right',
        density: 1.30,
        opacity: 0.92,
        crestHairline: 'fine',
        respectSafeZone: true,
        fillWash: 0.34,
        seedShift: 8.4
      }),
      makeLayer({
        name: 'Muted Teal Silk Fold',
        effect: 'organic-stipple',
        swatch: 'teal',
        yPct: 76,
        thicknessPct: 20,
        span: 'center',
        density: 1.18,
        opacity: 0.80,
        crestHairline: 'crisp',
        respectSafeZone: true,
        fillWash: 0.08,
        seedShift: 10.2
      }),
      makeLayer({
        name: 'Foreground Navy Ridge',
        effect: 'seigaiha-wave',
        swatch: 'navy',
        yPct: 84,
        thicknessPct: 22,
        span: 'right',
        density: 1.12,
        opacity: 0.58,
        crestHairline: 'crisp',
        respectSafeZone: true,
        fillWash: 0.09,
        seedShift: 12.1
      })
    ]
  };
}
