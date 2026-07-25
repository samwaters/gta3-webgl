/* ─────────────────────────────────────────────────────────────────────
   GTA3 Model Viewer — sidebar / tree / search
   (WebGL rendering is stubbed for now; loadModel() is the hook.)
   ───────────────────────────────────────────────────────────────────── */

'use strict';

// Manifest and glTF files live in ../extracted relative to this page.
const MANIFEST_URL = '../extracted/gta3.json';
const MODEL_BASE   = '../extracted/';

// ── Inline SVG icons ──────────────────────────────────────────────────
const ICONS = {
  chevron: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M6 4l4 4-4 4V4z"/></svg>',
  folder:  '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M1.5 3.5h4l1.2 1.5h7.8a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z"/></svg>',
  model:   '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M8 1L2 4.2v7.6L8 15l6-3.2V4.2L8 1zm0 1.7l4 2.1-4 2.1-4-2.1 4-2.1zM3.2 6.1l4.2 2.2v4.8L3.2 11V6.1zm5.4 7V8.3l4.2-2.2V11l-4.2 2.1z"/></svg>',
};

// ── State ─────────────────────────────────────────────────────────────
let rootNodes = [];          // tree of node objects (see buildNodes)
let allLeaves = [];          // flat list of model nodes (for counting)
let selectedRow = null;

// ── DOM refs ──────────────────────────────────────────────────────────
const treeEl     = document.getElementById('tree');
const searchEl   = document.getElementById('search');
const clearEl    = document.getElementById('search-clear');
const countEl    = document.getElementById('model-count');
const selNameEl  = document.getElementById('selected-name');
const selPathEl  = document.getElementById('selected-path');
const placeholder = document.getElementById('canvas-placeholder');


// ── Load manifest ─────────────────────────────────────────────────────
async function init() {
  let data;
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    showTreeError(err);
    return;
  }

  rootNodes = buildNodes(data, 0);
  allLeaves = [];
  collectLeaves(rootNodes, allLeaves);

  treeEl.innerHTML = '';
  for (const n of rootNodes) treeEl.appendChild(renderNode(n));
  updateCount(allLeaves.length);
}

function showTreeError(err) {
  treeEl.innerHTML =
    `<div class="tree-message error">Could not load <b>${MANIFEST_URL}</b><br>` +
    `${err.message}<br><br>Serve the project over HTTP, e.g.:` +
    `<br><code>python3 -m http.server</code><br>then open ` +
    `<code>/viewer/</code></div>`;
}


// ── Build a tree of nodes from the nested manifest ────────────────────
//   folder → { type:'folder', name, depth, children[], hasFolders }
//   model  → { type:'model',  name, depth, path }
function buildNodes(obj, depth) {
  const folders = [], models = [];
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val === 'string') {
      models.push({ type: 'model', name: key, depth, path: val });
    } else {
      const children = buildNodes(val, depth + 1);
      folders.push({
        type: 'folder', name: key, depth, children,
        hasFolders: children.some(c => c.type === 'folder'),
      });
    }
  }
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  folders.sort(byName);
  models.sort(byName);
  return [...folders, ...models];
}

function collectLeaves(nodes, out) {
  for (const n of nodes) {
    if (n.type === 'model') out.push(n);
    else collectLeaves(n.children, out);
  }
}

function leafCount(node) {
  if (node.type === 'model') return 1;
  if (node._leafCount == null) {
    node._leafCount = node.children.reduce((s, c) => s + leafCount(c), 0);
  }
  return node._leafCount;
}


// ── Render a node (and its subtree) to DOM ────────────────────────────
function renderNode(node) {
  const el = document.createElement('div');
  el.className = 'node';
  node.el = el;

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
  icon.innerHTML = node.type === 'folder' ? ICONS.folder : ICONS.model;
  row.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = node.name;
  node.label = label;
  row.appendChild(label);

  if (node.type === 'folder') {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = leafCount(node);
    row.appendChild(badge);
  }

  el.appendChild(row);

  if (node.type === 'folder') {
    const childrenEl = document.createElement('div');
    childrenEl.className = 'children';
    for (const c of node.children) childrenEl.appendChild(renderNode(c));
    el.appendChild(childrenEl);

    // Default: expand top two levels of structural folders.
    if (node.depth <= 1 && node.hasFolders) el.classList.add('open');

    row.addEventListener('click', () => el.classList.toggle('open'));
  } else {
    row.addEventListener('click', () => selectModel(node));
  }

  return el;
}


// ── Selection ─────────────────────────────────────────────────────────
function selectModel(node) {
  if (selectedRow) selectedRow.classList.remove('selected');
  node.row.classList.add('selected');
  selectedRow = node.row;

  selNameEl.textContent = node.name;
  selPathEl.textContent = node.path;
  placeholder.classList.add('hidden');

  loadModel(MODEL_BASE + node.path, node.name);
}

// WebGL renderer (created lazily on first selection).
let renderer = null;
async function loadModel(url, name) {
  try {
    if (!renderer) renderer = createRenderer(document.getElementById('gl-canvas'));
    selPathEl.textContent = url.replace(MODEL_BASE, '');
    const info = await renderer.load(url);
    selPathEl.textContent =
      `${url.replace(MODEL_BASE, '')}  ·  ${info.primitives} primitive${info.primitives === 1 ? '' : 's'}`;
  } catch (err) {
    console.error('[viewer] load failed:', err);
    selNameEl.textContent = name;
    selPathEl.textContent = 'failed to load — ' + err.message;
    placeholder.classList.remove('hidden');
  }
}


// ── Search / filter ───────────────────────────────────────────────────
let searchTimer = null;
searchEl.addEventListener('input', () => {
  clearEl.hidden = searchEl.value === '';
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFilter, 100);
});
clearEl.addEventListener('click', () => {
  searchEl.value = '';
  clearEl.hidden = true;
  applyFilter();
  searchEl.focus();
});

function applyFilter() {
  const q = searchEl.value.trim().toLowerCase();
  let visible = 0;
  for (const n of rootNodes) visible += filterNode(n, q);
  updateCount(visible, q !== '');
}

// Returns number of visible leaves under (and including) node.
function filterNode(node, q) {
  if (node.type === 'model') {
    const match = q === '' || node.name.toLowerCase().includes(q);
    node.el.classList.toggle('hidden', !match);
    highlightLabel(node, q, match);
    return match ? 1 : 0;
  }

  let count = 0;
  for (const c of node.children) count += filterNode(c, q);

  node.el.classList.toggle('hidden', count === 0);
  if (q === '') {
    // Restore default expansion when the query is cleared.
    node.el.classList.toggle('open', node.depth <= 1 && node.hasFolders);
  } else if (count > 0) {
    node.el.classList.add('open');   // auto-expand to reveal matches
  }
  return count;
}

function highlightLabel(node, q, match) {
  if (!q || !match) { node.label.textContent = node.name; return; }
  const i = node.name.toLowerCase().indexOf(q);
  if (i < 0) { node.label.textContent = node.name; return; }
  node.label.innerHTML =
    escapeHtml(node.name.slice(0, i)) +
    '<span class="highlight">' + escapeHtml(node.name.slice(i, i + q.length)) + '</span>' +
    escapeHtml(node.name.slice(i + q.length));
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function updateCount(n, filtered = false) {
  const total = allLeaves.length;
  countEl.textContent = filtered ? `${n} / ${total}` : `${total}`;
}


// ── Resizable sidebar ─────────────────────────────────────────────────
(function setupResizer() {
  const resizer = document.getElementById('resizer');
  const sidebar = document.getElementById('sidebar');
  let dragging = false;

  resizer.addEventListener('mousedown', e => {
    dragging = true;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.min(Math.max(e.clientX, 180), window.innerWidth * 0.7);
    sidebar.style.width = w + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.cursor = '';
  });
})();


init();
