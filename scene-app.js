/* ─────────────────────────────────────────────────────────────────────
   GTA3 Scene Viewer — sidebar / tree / search
   Tree leaves are IPL districts (arrays of instances); clicking one places
   all of its models in the WebGL viewport.
   ───────────────────────────────────────────────────────────────────── */

'use strict';

const SCENE_URL   = '../extracted/scene.json';
const MODEL_BASE  = '../extracted/';

const ICONS = {
  chevron: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M6 4l4 4-4 4V4z"/></svg>',
  folder:  '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M1.5 3.5h4l1.2 1.5h7.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/></svg>',
  district:'<svg viewBox="0 0 16 16"><path fill="currentColor" d="M2 14V6l4-2 4 2 4-2v10H2zm3-1h2v-3H5v3zm4 0h2V8H9v5z"/></svg>',
};

let rootNodes = [];
let allLeaves = [];
let selectedRow = null;
let renderer = null;

const treeEl    = document.getElementById('tree');
const searchEl  = document.getElementById('search');
const clearEl   = document.getElementById('search-clear');
const countEl   = document.getElementById('model-count');
const speedEl   = document.getElementById('fly-speed');
const speedValEl = document.getElementById('fly-speed-val');
const selNameEl = document.getElementById('selected-name');
const selPathEl = document.getElementById('selected-path');
const placeholder = document.getElementById('canvas-placeholder');
const progressEl  = document.getElementById('progress');

async function init() {
  let data;
  try {
    const res = await fetch(SCENE_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    treeEl.innerHTML =
      `<div class="tree-message error">Could not load <b>${SCENE_URL}</b><br>${err.message}` +
      `<br><br>Run <code>ipl_to_scene.py</code>, then serve over HTTP:` +
      `<br><code>python3 -m http.server</code></div>`;
    return;
  }

  rootNodes = buildNodes(data, 0);
  allLeaves = [];
  collectLeaves(rootNodes, allLeaves);
  treeEl.innerHTML = '';
  for (const n of rootNodes) treeEl.appendChild(renderNode(n));
  countEl.textContent = `${allLeaves.length} districts`;
}

// folder → object; district → Array of instances
function buildNodes(obj, depth) {
  const folders = [], districts = [];
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) districts.push({ type:'district', name:key, depth, instances:val });
    else folders.push({ type:'folder', name:key, depth,
                        children: buildNodes(val, depth+1),
                        hasFolders: Object.values(val).some(v => !Array.isArray(v)) });
  }
  const by = (a,b) => a.name.localeCompare(b.name, undefined, {numeric:true});
  folders.sort(by); districts.sort(by);
  return [...folders, ...districts];
}

function collectLeaves(nodes, out) {
  for (const n of nodes) {
    if (n.type === 'district') out.push(n);
    else collectLeaves(n.children, out);
  }
}

function renderNode(node) {
  const el = document.createElement('div');
  el.className = 'node'; node.el = el;

  const row = document.createElement('div');
  row.className = 'row ' + (node.type === 'folder' ? 'folder-row' : 'model-row');
  row.style.paddingLeft = (8 + node.depth * 14) + 'px';
  node.row = row;

  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  if (node.type === 'folder') chevron.innerHTML = ICONS.chevron;
  row.appendChild(chevron);

  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.innerHTML = node.type === 'folder' ? ICONS.folder : ICONS.district;
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'label'; label.textContent = node.name; node.label = label;
  row.appendChild(label);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = node.type === 'folder'
    ? leafCount(node) : node.instances.length;
  row.appendChild(badge);

  el.appendChild(row);

  if (node.type === 'folder') {
    const childrenEl = document.createElement('div');
    childrenEl.className = 'children';
    for (const c of node.children) childrenEl.appendChild(renderNode(c));
    el.appendChild(childrenEl);
    if (node.depth <= 1 && node.hasFolders) el.classList.add('open');
    row.addEventListener('click', () => el.classList.toggle('open'));
  } else {
    row.addEventListener('click', () => selectDistrict(node));
  }
  return el;
}

function leafCount(node) {
  if (node.type === 'district') return node.instances.length;
  if (node._lc == null) node._lc = node.children.reduce((s,c)=>s+leafCount(c), 0);
  return node._lc;
}

function selectDistrict(node) {
  if (selectedRow) selectedRow.classList.remove('selected');
  node.row.classList.add('selected'); selectedRow = node.row;
  loadScene(node.name, node.instances);
}

let flySpeed = 1;
speedEl.addEventListener('input', () => {
  flySpeed = parseFloat(speedEl.value);
  speedValEl.textContent = flySpeed + '×';
  if (renderer) renderer.setSpeed(flySpeed);
});

async function loadScene(label, instances) {
  // scene.json is already the gta3.dat game scene with LODs removed by
  // ipl_to_scene.py, so no viewer-side filtering is needed here.
  if (!renderer) {
    renderer = createSceneRenderer(document.getElementById('gl-canvas'), {
      modelBase: MODEL_BASE,
      speed: flySpeed,
      onProgress: p => {
        if (p.phase === 'loading')
          progressEl.textContent = `Loading models… ${p.done}/${p.total}`;
        else if (p.phase === 'done')
          progressEl.textContent = '';
      },
    });
  }
  placeholder.classList.add('hidden');
  selNameEl.textContent = label;
  selPathEl.textContent = `${instances.length} instances`;
  const r = await renderer.loadInstances(instances);
  if (r && !r.cancelled)
    selPathEl.textContent = `${r.instances.toLocaleString()} instances · ${r.models} models`;
}

// ── Search ────────────────────────────────────────────────────────────
let timer = null;
searchEl.addEventListener('input', () => {
  clearEl.hidden = searchEl.value === '';
  clearTimeout(timer); timer = setTimeout(applyFilter, 100);
});
clearEl.addEventListener('click', () => {
  searchEl.value=''; clearEl.hidden=true; applyFilter(); searchEl.focus();
});

function applyFilter() {
  const q = searchEl.value.trim().toLowerCase();
  for (const n of rootNodes) filterNode(n, q);
  countEl.textContent = q
    ? `${allLeaves.filter(l => l.name.toLowerCase().includes(q)).length} / ${allLeaves.length} districts`
    : `${allLeaves.length} districts`;
}

function filterNode(node, q) {
  if (node.type === 'district') {
    const m = q === '' || node.name.toLowerCase().includes(q);
    node.el.classList.toggle('hidden', !m);
    return m ? 1 : 0;
  }
  let c = 0;
  for (const ch of node.children) c += filterNode(ch, q);
  node.el.classList.toggle('hidden', c === 0);
  if (q === '') node.el.classList.toggle('open', node.depth <= 1 && node.hasFolders);
  else if (c > 0) node.el.classList.add('open');
  return c;
}

// ── Resizer (shared behaviour with the model viewer) ──────────────────
(function () {
  const resizer = document.getElementById('resizer');
  const sidebar = document.getElementById('sidebar');
  let dragging = false;
  resizer.addEventListener('mousedown', e => { dragging=true; resizer.classList.add('dragging');
    document.body.style.cursor='col-resize'; e.preventDefault(); });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    sidebar.style.width = Math.min(Math.max(e.clientX, 180), window.innerWidth*0.7) + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return; dragging=false; resizer.classList.remove('dragging'); document.body.style.cursor='';
  });
})();

init();
