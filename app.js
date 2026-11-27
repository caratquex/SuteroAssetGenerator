import {
  CANVAS_PRESETS,
  SAFE_ZONES,
  SUTERO_SWATCHES,
  SWATCH_BY_ID,
  EFFECT_DEFS,
  EFFECT_BY_ID,
  makeLayer,
  getRecipe
} from './math.js';
import {
  renderToCanvas,
  buildLayeredSvg,
  exportCompositePng
} from './renderer.js';

const initialRecipe = getRecipe('silk-ridge-stipple');

const state = {
  recipeId: initialRecipe.id,
  presetId: initialRecipe.preset,
  width: CANVAS_PRESETS[initialRecipe.preset].width,
  height: CANVAS_PRESETS[initialRecipe.preset].height,
  surface: initialRecipe.surface,
  safeZone: initialRecipe.safeZone,
  fluidity: initialRecipe.fluidity,
  typePreview: initialRecipe.typePreview,
  showGuide: false,
  seed: 17,
  exportScale: 2,
  layers: initialRecipe.layers,
  selectedLayerId: initialRecipe.layers[initialRecipe.layers.length - 1].id
};

// DOM References
const stageArea = document.getElementById('stage-area');
const artboardWrap = document.getElementById('artboard-wrap');
const stageCanvas = document.getElementById('stage-canvas');
const safeZoneGuide = document.getElementById('safe-zone-guide');
const typeOverlay = document.getElementById('type-overlay');
const stageTelemetry = document.getElementById('stage-telemetry');

const inputWidth = document.getElementById('input-width');
const inputHeight = document.getElementById('input-height');
const seedBadge = document.getElementById('seed-badge');
const selectSafeZone = document.getElementById('select-safe-zone');
const rangeFluidity = document.getElementById('range-fluidity');
const valFluidity = document.getElementById('val-fluidity');
const toggleGuide = document.getElementById('toggle-guide');

const layersHeading = document.getElementById('layers-heading');
const layerListEl = document.getElementById('layer-list');
const propKindBadge = document.getElementById('prop-kind-badge');
const propName = document.getElementById('prop-name');
const propEffect = document.getElementById('prop-effect');
const swatchGrid = document.getElementById('swatch-grid');
const propSwatchReadout = document.getElementById('prop-swatch-readout');

const propY = document.getElementById('prop-y');
const valY = document.getElementById('val-y');
const propThick = document.getElementById('prop-thick');
const valThick = document.getElementById('val-thick');
const propDensity = document.getElementById('prop-density');
const valDensity = document.getElementById('val-density');
const propWash = document.getElementById('prop-wash');
const valWash = document.getElementById('val-wash');
const propOpacity = document.getElementById('prop-opacity');
const valOpacity = document.getElementById('val-opacity');
const propSafeZone = document.getElementById('prop-safezone');

let refineTimer = 0;

function getSelectedLayer() {
  return state.layers.find((l) => l.id === state.selectedLayerId) || state.layers[state.layers.length - 1] || null;
}

function fitArtboard() {
  const rect = stageArea.getBoundingClientRect();
  const availW = Math.max(220, rect.width - 48);
  const availH = Math.max(200, rect.height - 48);
  const ratio = state.width / Math.max(1, state.height);

  let w = availW;
  let h = w / ratio;
  if (h > availH) {
    h = availH;
    w = h * ratio;
  }

  artboardWrap.style.width = `${Math.round(w)}px`;
  artboardWrap.style.height = `${Math.round(h)}px`;
}

function updateOverlays() {
  // Safe-zone guide ellipse
  const sz = SAFE_ZONES[state.safeZone];
  const showSZ = state.showGuide && sz && sz.rx > 0;
  safeZoneGuide.classList.toggle('is-visible', Boolean(showSZ));
  if (showSZ) {
    safeZoneGuide.style.left = `${(sz.cx - sz.rx) * 100}%`;
    safeZoneGuide.style.top = `${(sz.cy - sz.ry) * 100}%`;
    safeZoneGuide.style.width = `${sz.rx * 200}%`;
    safeZoneGuide.style.height = `${sz.ry * 200}%`;
  }

  // Live Type Preview (excluded from exports)
  typeOverlay.className = `type-overlay is-${state.surface} zone-${state.safeZone}`;
  if (state.typePreview === 'off') {
    typeOverlay.innerHTML = '';
  } else if (state.typePreview === 'wordmark') {
    typeOverlay.innerHTML =
      `<svg class="overlay-wordmark" viewBox="0 0 820 116" role="img" aria-label="Sutero">` +
      `<use href="#sutero-wordmark"></use></svg>`;
  } else {
    typeOverlay.innerHTML = `
      <div class="overlay-headline-block">
        <span class="overlay-kicker">Sutero · Private Investment Club</span>
        <h3 class="overlay-headline">Collective member resolutions across global public and private markets.</h3>
        <div class="overlay-meta">Public Equities · Sukuk · Fixed Income · Private Markets</div>
      </div>`;
  }
}

function renderStage({ fastPreview = false } = {}) {
  fitArtboard();
  updateOverlays();

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const scale = fastPreview ? 0.5 : dpr;
  const stats = renderToCanvas(stageCanvas, state, { scale });

  stageTelemetry.textContent = `${state.width}×${state.height} · ${stats.visibleCount} layers · ${stats.renderMs}ms`;
}

function scheduleRefineRender() {
  clearTimeout(refineTimer);
  refineTimer = setTimeout(() => renderStage({ fastPreview: false }), 90);
}

function syncTopControls() {
  inputWidth.value = state.width;
  inputHeight.value = state.height;
  seedBadge.textContent = `#${state.seed}`;
  selectSafeZone.value = state.safeZone;
  rangeFluidity.value = state.fluidity;
  valFluidity.textContent = Number(state.fluidity).toFixed(2);
  toggleGuide.checked = state.showGuide;

  document.querySelectorAll('[data-preset]').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-preset') === state.presetId);
  });
  document.querySelectorAll('[data-surface]').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-surface') === state.surface);
  });
  document.querySelectorAll('[data-recipe]').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-recipe') === state.recipeId);
  });
  document.querySelectorAll('[data-type-preview]').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-type-preview') === state.typePreview);
  });
  document.querySelectorAll('[data-export-scale]').forEach((b) => {
    b.classList.toggle('is-active', Number(b.getAttribute('data-export-scale')) === state.exportScale);
  });
}

function renderLayerList() {
  layersHeading.textContent = `Layers (${state.layers.length})`;
  layerListEl.innerHTML = '';

  // Display top-most foreground layer first (Figma convention)
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    const sw = SWATCH_BY_ID[layer.swatch] || SWATCH_BY_ID.navy;
    const eff = EFFECT_BY_ID[layer.effect] || EFFECT_DEFS[0];

    const row = document.createElement('div');
    row.className = 'layer-row';
    if (layer.id === state.selectedLayerId) row.classList.add('is-selected');
    if (!layer.visible) row.classList.add('is-hidden');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(layer.id === state.selectedLayerId));

    const label = layer.name || eff.name;

    row.innerHTML = `
      <span class="layer-dot" style="background:${sw.hex}"></span>
      <div class="layer-info">
        <div class="layer-row-title">${label}</div>
        <div class="layer-row-sub">${eff.name} · ${Math.round(layer.opacity * 100)}%</div>
      </div>
      <div class="layer-row-btns">
        <button type="button" class="icon-btn" data-act="vis" title="${layer.visible ? 'Hide' : 'Show'}">${layer.visible ? '◉' : '○'}</button>
        <button type="button" class="icon-btn" data-act="up" title="Bring Forward">↑</button>
        <button type="button" class="icon-btn" data-act="down" title="Send Backward">↓</button>
        <button type="button" class="icon-btn" data-act="dup" title="Duplicate">⧉</button>
        <button type="button" class="icon-btn" data-act="del" title="Delete">×</button>
      </div>
    `;

    row.addEventListener('click', (ev) => {
      const actBtn = ev.target.closest('[data-act]');
      if (!actBtn) {
        state.selectedLayerId = layer.id;
        renderLayerList();
        syncInspector();
        return;
      }
      ev.stopPropagation();
      const act = actBtn.getAttribute('data-act');
      if (act === 'vis') {
        layer.visible = !layer.visible;
      } else if (act === 'up' && i < state.layers.length - 1) {
        const tmp = state.layers[i + 1];
        state.layers[i + 1] = layer;
        state.layers[i] = tmp;
      } else if (act === 'down' && i > 0) {
        const tmp = state.layers[i - 1];
        state.layers[i - 1] = layer;
        state.layers[i] = tmp;
      } else if (act === 'dup') {
        const copy = makeLayer({
          ...layer,
          name: `${label} Copy`,
          seedShift: layer.seedShift + 1.37
        });
        state.layers.splice(i + 1, 0, copy);
        state.selectedLayerId = copy.id;
      } else if (act === 'del' && state.layers.length > 1) {
        state.layers.splice(i, 1);
        if (state.selectedLayerId === layer.id) {
          state.selectedLayerId = state.layers[Math.min(i, state.layers.length - 1)].id;
        }
      }
      renderLayerList();
      syncInspector();
      renderStage();
    });

    layerListEl.appendChild(row);
  }
}

function syncInspector() {
  const layer = getSelectedLayer();
  if (!layer) return;
  const eff = EFFECT_BY_ID[layer.effect] || EFFECT_DEFS[0];
  const sw = SWATCH_BY_ID[layer.swatch] || SWATCH_BY_ID.navy;

  propKindBadge.textContent = eff.kind;
  propName.value = layer.name || '';
  propEffect.value = layer.effect;
  propSwatchReadout.textContent = `${sw.name} · ${sw.hex}`;

  swatchGrid.querySelectorAll('.swatch-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-swatch') === layer.swatch);
  });

  propY.value = layer.yPct;
  valY.textContent = `${layer.yPct}%`;
  propThick.value = layer.thicknessPct;
  valThick.textContent = `${layer.thicknessPct}%`;
  propDensity.value = layer.density;
  valDensity.textContent = Number(layer.density).toFixed(2);
  propWash.value = layer.fillWash;
  valWash.textContent = `${Math.round(layer.fillWash * 100)}%`;
  propOpacity.value = layer.opacity;
  valOpacity.textContent = `${Math.round(layer.opacity * 100)}%`;
  propSafeZone.checked = layer.respectSafeZone !== false;

  document.querySelectorAll('#span-pills [data-span]').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-span') === layer.span);
  });
  document.querySelectorAll('#hairline-pills [data-hairline]').forEach((b) => {
    b.classList.toggle('is-active', b.getAttribute('data-hairline') === layer.crestHairline);
  });
}

function populateStaticInspectorInputs() {
  propEffect.innerHTML = EFFECT_DEFS.map(
    (e) => `<option value="${e.id}">${e.name} (${e.kind})</option>`
  ).join('');

  swatchGrid.innerHTML = '';
  for (const sw of SUTERO_SWATCHES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch-btn';
    btn.style.backgroundColor = sw.hex;
    btn.title = `${sw.name} (${sw.hex})`;
    btn.setAttribute('data-swatch', sw.id);
    btn.addEventListener('click', () => {
      const layer = getSelectedLayer();
      if (!layer) return;
      layer.swatch = sw.id;
      syncInspector();
      renderLayerList();
      renderStage();
    });
    swatchGrid.appendChild(btn);
  }
}

function loadRecipe(recipeId) {
  const rec = getRecipe(recipeId);
  state.recipeId = rec.id;
  state.presetId = rec.preset;
  state.width = CANVAS_PRESETS[rec.preset].width;
  state.height = CANVAS_PRESETS[rec.preset].height;
  state.surface = rec.surface;
  state.safeZone = rec.safeZone;
  state.fluidity = rec.fluidity;
  state.typePreview = rec.typePreview;
  state.layers = rec.layers;
  state.selectedLayerId = rec.layers[rec.layers.length - 1].id;
  syncTopControls();
  renderLayerList();
  syncInspector();
  renderStage();
}

// Top Bar Events
document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-preset');
    const preset = CANVAS_PRESETS[id];
    if (!preset) return;
    state.presetId = id;
    state.width = preset.width;
    state.height = preset.height;
    syncTopControls();
    renderStage();
  });
});

function applyCustomDimensions() {
  const w = Math.max(240, Math.min(2880, Number(inputWidth.value) || 1440));
  const h = Math.max(240, Math.min(2400, Number(inputHeight.value) || 900));
  state.width = w;
  state.height = h;
  state.presetId = 'custom';
  syncTopControls();
  renderStage();
}
inputWidth.addEventListener('change', applyCustomDimensions);
inputHeight.addEventListener('change', applyCustomDimensions);

document.querySelectorAll('[data-surface]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.surface = btn.getAttribute('data-surface');
    syncTopControls();
    renderStage();
  });
});

document.querySelectorAll('[data-recipe]').forEach((btn) => {
  btn.addEventListener('click', () => {
    loadRecipe(btn.getAttribute('data-recipe'));
  });
});

// Stage Bar Events
document.getElementById('shuffle-btn').addEventListener('click', () => {
  state.seed = Math.floor(Math.random() * 900) + 10;
  syncTopControls();
  renderStage();
});

selectSafeZone.addEventListener('change', () => {
  state.safeZone = selectSafeZone.value;
  renderStage();
});

rangeFluidity.addEventListener('input', () => {
  state.fluidity = Number(rangeFluidity.value);
  valFluidity.textContent = state.fluidity.toFixed(2);
  renderStage({ fastPreview: true });
  scheduleRefineRender();
});
rangeFluidity.addEventListener('change', () => renderStage());

document.querySelectorAll('[data-type-preview]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.typePreview = btn.getAttribute('data-type-preview');
    syncTopControls();
    updateOverlays();
  });
});

toggleGuide.addEventListener('change', () => {
  state.showGuide = toggleGuide.checked;
  updateOverlays();
});

document.querySelectorAll('[data-export-scale]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.exportScale = Number(btn.getAttribute('data-export-scale')) || 2;
    syncTopControls();
  });
});

// Inspector Events
document.getElementById('btn-add-layer').addEventListener('click', () => {
  const newLayer = makeLayer({
    name: `Ribbon ${state.layers.length + 1}`,
    effect: 'organic-stipple',
    swatch: state.surface === 'dark' ? 'ivory' : 'navy',
    yPct: 30 + ((state.layers.length * 13) % 52),
    thicknessPct: 24,
    span: 'full',
    density: 1.1,
    opacity: 0.78,
    crestHairline: 'fine'
  });
  state.layers.push(newLayer);
  state.selectedLayerId = newLayer.id;
  renderLayerList();
  syncInspector();
  renderStage();
});

propName.addEventListener('input', () => {
  const layer = getSelectedLayer();
  if (!layer) return;
  layer.name = propName.value;
  renderLayerList();
});

propEffect.addEventListener('change', () => {
  const layer = getSelectedLayer();
  if (!layer) return;
  layer.effect = propEffect.value;
  syncInspector();
  renderLayerList();
  renderStage();
});

function bindLayerSlider(el, prop, formatFn, displayEl) {
  el.addEventListener('input', () => {
    const layer = getSelectedLayer();
    if (!layer) return;
    layer[prop] = Number(el.value);
    displayEl.textContent = formatFn(layer[prop]);
    renderLayerList();
    renderStage({ fastPreview: true });
    scheduleRefineRender();
  });
  el.addEventListener('change', () => renderStage());
}

bindLayerSlider(propY, 'yPct', (v) => `${v}%`, valY);
bindLayerSlider(propThick, 'thicknessPct', (v) => `${v}%`, valThick);
bindLayerSlider(propDensity, 'density', (v) => Number(v).toFixed(2), valDensity);
bindLayerSlider(propWash, 'fillWash', (v) => `${Math.round(v * 100)}%`, valWash);
bindLayerSlider(propOpacity, 'opacity', (v) => `${Math.round(v * 100)}%`, valOpacity);

document.querySelectorAll('#span-pills [data-span]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const layer = getSelectedLayer();
    if (!layer) return;
    layer.span = btn.getAttribute('data-span');
    syncInspector();
    renderStage();
  });
});

document.querySelectorAll('#hairline-pills [data-hairline]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const layer = getSelectedLayer();
    if (!layer) return;
    layer.crestHairline = btn.getAttribute('data-hairline');
    syncInspector();
    renderStage();
  });
});

propSafeZone.addEventListener('change', () => {
  const layer = getSelectedLayer();
  if (!layer) return;
  layer.respectSafeZone = propSafeZone.checked;
  renderStage();
});

// Exports
function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

document.getElementById('btn-download-png').addEventListener('click', () => {
  const dataUrl = exportCompositePng(state, state.exportScale);
  triggerDownload(dataUrl, `sutero-${state.recipeId}-${state.width}x${state.height}-${state.exportScale}x-seed${state.seed}.png`);
});

document.getElementById('btn-download-svg').addEventListener('click', () => {
  const svgStr = buildLayeredSvg(state);
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, `sutero-${state.recipeId}-${state.width}x${state.height}-seed${state.seed}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

const copySvgBtn = document.getElementById('btn-copy-svg');
copySvgBtn.addEventListener('click', async () => {
  const svgStr = buildLayeredSvg(state);
  try {
    await navigator.clipboard.writeText(svgStr);
    copySvgBtn.textContent = 'Copied SVG!';
    copySvgBtn.classList.add('is-copied');
    setTimeout(() => {
      copySvgBtn.textContent = 'Copy SVG';
      copySvgBtn.classList.remove('is-copied');
    }, 1800);
  } catch {
    // Fallback download if clipboard blocked
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `sutero-${state.recipeId}-seed${state.seed}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});

window.addEventListener('resize', fitArtboard);

// Expose clean diagnostic hook for automated testing if needed
window.__suteroGenerator = {
  getState: () => state,
  buildLayeredSvg: () => buildLayeredSvg(state)
};

populateStaticInspectorInputs();
syncTopControls();
renderLayerList();
syncInspector();
renderStage();
