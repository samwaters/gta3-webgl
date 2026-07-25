/* ─────────────────────────────────────────────────────────────────────
   GTA3 Full City — always renders every district, with the overlay
   toggles (pickups / transit / water) in a right-hand settings panel.
   ───────────────────────────────────────────────────────────────────── */

'use strict';

const SCENE_URL   = '../extracted/scene.json';
const PICKUPS_URL = '../extracted/pickups.json';
const PATHS_URL   = '../extracted/paths.json';
const WATER_URL   = '../extracted/water.json';
const TIMECYC_URL = '../extracted/timecyc.json';
const MODEL_BASE  = '../extracted/';
// Fallback marker for any pickup whose model has no glTF.
const MARKER_GLTF  = 'bonus.gltf';
const PICKUP_SCALE = 2;

const speedEl     = document.getElementById('fly-speed');
const speedValEl  = document.getElementById('fly-speed-val');
const showPickups = document.getElementById('show-pickups');
const showTransit = document.getElementById('show-transit');
const showWater   = document.getElementById('show-water');
const showSky     = document.getElementById('show-sky');
const weatherEl   = document.getElementById('weather');
const timeEl      = document.getElementById('time-of-day');
const timeValEl   = document.getElementById('time-val');
const selNameEl   = document.getElementById('selected-name');
const selPathEl   = document.getElementById('selected-path');
const placeholder = document.getElementById('canvas-placeholder');
const progressEl  = document.getElementById('progress');

let renderer = null;
let flySpeed = 1;

async function init() {
  let data;
  try {
    const res = await fetch(SCENE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    selPathEl.textContent = `Could not load ${SCENE_URL} — run ipl_to_scene.py`;
    return;
  }

  // Flatten every district's instances into one full-city list.
  const instances = [];
  (function walk(obj) {
    for (const val of Object.values(obj)) {
      if (Array.isArray(val)) instances.push(...val);
      else if (val && typeof val === 'object') walk(val);
    }
  })(data);

  renderer = createSceneRenderer(document.getElementById('gl-canvas'), {
    modelBase: MODEL_BASE,
    speed: flySpeed,
    onProgress: p => {
      if (p.phase === 'loading') progressEl.textContent = `Loading models… ${p.done}/${p.total}`;
      else if (p.phase === 'done') progressEl.textContent = '';
    },
  });

  placeholder.classList.add('hidden');
  selPathEl.textContent = `${instances.length} instances`;
  const r = await renderer.loadInstances(instances);
  if (r && !r.cancelled)
    selPathEl.textContent = `${r.instances.toLocaleString()} instances · ${r.models} models`;
}

// ── Fly speed ─────────────────────────────────────────────────────────
speedEl.addEventListener('input', () => {
  flySpeed = parseFloat(speedEl.value);
  speedValEl.textContent = flySpeed + '×';
  if (renderer) renderer.setSpeed(flySpeed);
});

// ── Overlays ──────────────────────────────────────────────────────────
let pickupInstances = null;
async function ensurePickups() {
  if (pickupInstances) return pickupInstances;
  const raw = await (await fetch(PICKUPS_URL, { cache: 'no-store' })).json();
  pickupInstances = raw.map(p => ({
    x: p.x, y: p.y, z: p.z,
    sx: PICKUP_SCALE, sy: PICKUP_SCALE, sz: PICKUP_SCALE,
    rx: 0, ry: 0, rz: 0, rw: 1,
    gltf: p.gltf || MARKER_GLTF,
  }));
  return pickupInstances;
}
showPickups.addEventListener('change', async () => {
  if (!renderer) return;
  if (showPickups.checked) {
    await renderer.loadPickups(await ensurePickups());
    renderer.setPickupsVisible(true);
  } else renderer.setPickupsVisible(false);
});

let transitPaths = null;
async function ensureTransit() {
  if (transitPaths) return transitPaths;
  transitPaths = await (await fetch(PATHS_URL, { cache: 'no-store' })).json();
  return transitPaths;
}
showTransit.addEventListener('change', async () => {
  if (!renderer) return;
  if (showTransit.checked) {
    await renderer.loadTransit(await ensureTransit());
    renderer.setTransitVisible(true);
  } else renderer.setTransitVisible(false);
});

let waterRects = null;
async function ensureWater() {
  if (waterRects) return waterRects;
  waterRects = (await (await fetch(WATER_URL, { cache: 'no-store' })).json()).water || [];
  return waterRects;
}
showWater.addEventListener('change', async () => {
  if (!renderer) return;
  if (showWater.checked) {
    await renderer.loadWater(await ensureWater());
    renderer.setWaterVisible(true);
  } else renderer.setWaterVisible(false);
});

// ── Sky ───────────────────────────────────────────────────────────────
// Show Sky master toggle + weather + time of day (0–24h).  The gradient's two
// colours are interpolated from timecyc.json for the current hour/weather and
// handed to the renderer, which paints a full-screen SkyTop→SkyBottom gradient.
const sky = { visible: false, weather: 'sunny', time: 12 };
let timecyc = null;

function formatTime(t) {
  t = ((t % 24) + 24) % 24;                 // wrap 24 → 0
  const h = Math.floor(t);
  const m = Math.floor((t - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Interpolate a colour field between the two hours bracketing `time`, → 0..1 RGB.
function sampleSky() {
  const hours = timecyc[sky.weather] || timecyc.sunny;
  const n = hours.length;                   // 24
  const t = ((sky.time % 24) + 24) % 24;
  const h0 = Math.floor(t) % n, h1 = (h0 + 1) % n, f = t - Math.floor(t);
  const lerp = key => [0, 1, 2].map(i =>
    (hours[h0][key][i] + (hours[h1][key][i] - hours[h0][key][i]) * f) / 255);
  return { top: lerp('skyTop'), bottom: lerp('skyBot') };
}

async function ensureTimecyc() {
  if (!timecyc) timecyc = await (await fetch(TIMECYC_URL, { cache: 'no-store' })).json();
  return timecyc;
}

async function refreshSky() {
  if (!renderer) return;
  await ensureTimecyc();
  const { top, bottom } = sampleSky();
  renderer.setSky({ visible: sky.visible, top, bottom });
}

showSky.addEventListener('change',  () => { sky.visible = showSky.checked; refreshSky(); });
weatherEl.addEventListener('change', () => { sky.weather = weatherEl.value; refreshSky(); });
timeEl.addEventListener('input', () => {
  sky.time = parseFloat(timeEl.value);
  timeValEl.textContent = formatTime(sky.time);
  refreshSky();
});
timeValEl.textContent = formatTime(sky.time);

// ── Resizer (left panel, matching the other pages) ────────────────────
(function () {
  const resizer = document.getElementById('resizer');
  const sidebar = document.getElementById('sidebar');
  let dragging = false;
  resizer.addEventListener('mousedown', e => {
    dragging = true; resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize'; e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    sidebar.style.width = Math.min(Math.max(e.clientX, 180), window.innerWidth * 0.7) + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false; resizer.classList.remove('dragging'); document.body.style.cursor = '';
  });
})();

init();
