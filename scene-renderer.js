/* ─────────────────────────────────────────────────────────────────────
   GTA3 Scene Viewer — raw WebGL multi-instance renderer (no libraries)

   Places many glTF models per the IPL instance transforms in scene.json.
   Each unique model's GPU buffers/textures are loaded once and reused for
   every instance (grouped draws).  Orbit/pan/zoom camera.

   Coordinate systems
   ------------------
   IPL transforms are in GTA world space (right-handed, Z-up).  The glTF
   models were baked to Y-up by gta_to_gltf.py (v_gltf = Rconv · v_gta,
   a −90° rotation about X).  So each instance matrix is:

       M = Rconv · T(pos) · R(quat) · S(scale) · Rconv⁻¹

   which un-bakes the model to GTA-local, applies the GTA instance
   transform, then converts the whole world back to Y-up for viewing.
   ───────────────────────────────────────────────────────────────────── */

'use strict';

// ── mat4 (column-major) ───────────────────────────────────────────────
const Mat4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },
  translation(x, y, z) {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
  },
  scaling(x, y, z) {
    return new Float32Array([x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1]);
  },
  fromQuat(x, y, z, w) {
    const n = Math.hypot(x, y, z, w) || 1; x/=n; y/=n; z/=n; w/=n;
    const x2=x+x, y2=y+y, z2=z+z;
    const xx=x*x2, xy=x*y2, xz=x*z2, yy=y*y2, yz=y*z2, zz=z*z2;
    const wx=w*x2, wy=w*y2, wz=w*z2;
    return new Float32Array([
      1-(yy+zz), xy+wz,     xz-wy,     0,
      xy-wz,     1-(xx+zz), yz+wx,     0,
      xz+wy,     yz-wx,     1-(xx+yy), 0,
      0,0,0,1,
    ]);
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([
      f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)*nf,-1, 0,0,2*far*near*nf,0,
    ]);
  },
  lookAt(eye, center, up) {
    let zx=eye[0]-center[0], zy=eye[1]-center[1], zz=eye[2]-center[2];
    let zl=Math.hypot(zx,zy,zz)||1; zx/=zl; zy/=zl; zz/=zl;
    let xx=up[1]*zz-up[2]*zy, xy=up[2]*zx-up[0]*zz, xz=up[0]*zy-up[1]*zx;
    let xl=Math.hypot(xx,xy,xz)||1; xx/=xl; xy/=xl; xz/=xl;
    const yx=zy*xz-zz*xy, yy=zz*xx-zx*xz, yz=zx*xy-zy*xx;
    return new Float32Array([
      xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0,
      -(xx*eye[0]+xy*eye[1]+xz*eye[2]),
      -(yx*eye[0]+yy*eye[1]+yz*eye[2]),
      -(zx*eye[0]+zy*eye[1]+zz*eye[2]), 1,
    ]);
  },
};

// GTA Z-up ↔ viewer Y-up (±90° about X)
const RCONV     = new Float32Array([1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]);
const RCONV_INV = new Float32Array([1,0,0,0, 0,0,1,0, 0,-1,0,0, 0,0,0,1]);

function instanceMatrix(i) {
  const T = Mat4.translation(i.x, i.y, i.z);
  // GTA III IPL stores the rotation such that the engine applies its
  // conjugate (negated vector part).  Using the raw quaternion swaps +90°/−90°
  // rotations, which flips corners, curves and T-junctions.
  const R = Mat4.fromQuat(-i.rx, -i.ry, -i.rz, i.rw);
  const S = Mat4.scaling(i.sx || 1, i.sy || 1, i.sz || 1);
  // M = RCONV · T · R · S · RCONV_INV
  return Mat4.mul(RCONV, Mat4.mul(T, Mat4.mul(R, Mat4.mul(S, RCONV_INV))));
}

// ── Shaders ───────────────────────────────────────────────────────────
const VERT = `
precision highp float;
attribute vec3 a_position; attribute vec2 a_uv;
attribute vec4 a_color;    attribute vec3 a_normal;
uniform mat4 u_proj, u_view, u_model;
varying vec2 v_uv; varying vec4 v_color; varying vec3 v_normal;
void main() {
  v_uv = a_uv; v_color = a_color;
  v_normal = mat3(u_view) * mat3(u_model) * a_normal;
  gl_Position = u_proj * u_view * u_model * vec4(a_position, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 v_uv; varying vec4 v_color; varying vec3 v_normal;
uniform vec4 u_baseColor; uniform sampler2D u_tex;
uniform bool u_hasTex, u_hasColor, u_lit;
uniform float u_prelitStrength;
void main() {
  vec4 c = u_baseColor;
  if (u_hasTex) c *= texture2D(u_tex, v_uv);
  if (c.a < 0.5) discard;
  vec3 light = vec3(1.0);
  if (u_hasColor)      light = mix(vec3(1.0), v_color.rgb, u_prelitStrength);
  else if (u_lit) {
    vec3 n = normalize(v_normal);
    light = vec3(0.45 + 0.55 * max(dot(n, normalize(vec3(0.35,0.55,1.0))), 0.0));
  }
  gl_FragColor = vec4(c.rgb * light, c.a);
}`;

// Sky: a full-screen vertical gradient drawn as the backdrop.  A clip-space
// quad; v_t is 0 at the bottom of the screen, 1 at the top, mixing the horizon
// (SkyBottom) and zenith (SkyTop) colours — GTA III's sky is exactly this.
const SKY_VERT = `
attribute vec2 a_pos;
varying float v_t;
void main() { v_t = a_pos.y * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const SKY_FRAG = `
precision mediump float;
varying float v_t;
uniform vec3 u_skyTop, u_skyBottom;
void main() { gl_FragColor = vec4(mix(u_skyBottom, u_skyTop, v_t), 1.0); }`;

const COMP_BYTES = { 5120:1, 5121:1, 5122:2, 5123:2, 5125:4, 5126:4 };
const TYPE_N = { SCALAR:1, VEC2:2, VEC3:3, VEC4:4, MAT4:16 };


function createSceneRenderer(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('WebGL not available');
  if (!(typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext))
    gl.getExtension('OES_element_index_uint');

  const onProgress = opts.onProgress || (() => {});
  let speedMult = opts.speed || 1;
  const prog = linkProgram(gl, VERT, FRAG);
  gl.useProgram(prog);
  const A = {
    position: gl.getAttribLocation(prog, 'a_position'),
    uv:       gl.getAttribLocation(prog, 'a_uv'),
    color:    gl.getAttribLocation(prog, 'a_color'),
    normal:   gl.getAttribLocation(prog, 'a_normal'),
  };
  const U = {};
  for (const n of ['u_proj','u_view','u_model','u_baseColor','u_tex',
                   'u_hasTex','u_hasColor','u_lit','u_prelitStrength'])
    U[n] = gl.getUniformLocation(prog, n);
  gl.uniform1f(U.u_prelitStrength, 0.55);

  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(0, 0, 0, 0);

  // Sky gradient program + full-screen clip-space quad (triangle strip).
  const skyProg = linkProgram(gl, SKY_VERT, SKY_FRAG);
  const skyPosLoc  = gl.getAttribLocation(skyProg, 'a_pos');
  const uSkyTop    = gl.getUniformLocation(skyProg, 'u_skyTop');
  const uSkyBottom = gl.getUniformLocation(skyProg, 'u_skyBottom');
  const skyQuad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, skyQuad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const modelCache = new Map();   // name -> Promise<model|null>
  let renderList = [];            // [{ model, matrices:[Float32Array] }]
  let pickupRenderList = [];      // toggleable pickup markers
  let pickupsVisible = false;
  let transitList = [];           // animated planes/trains: [{ model, waypoints, speed, idx, acc }]
  let transitVisible = false;
  let water = null;               // { posBuf, uvBuf, count, texture } — tiled water quads
  let waterVisible = false;
  let skyVisible = false;
  let skyTop = [0, 0, 0], skyBottom = [0, 0, 0];   // gradient colours, 0..1 RGB
  let loadToken = 0;

  // First-person fly camera: an eye position with yaw/pitch look angles.
  // Mouse turns the head (eye stays put); keys move the eye.
  const cam = {
    pos:[0,100,200], yaw:0, pitch:-0.3,
    near:1, far:100000, speed:100,
  };
  const forwardVec = () => {
    const cp=Math.cos(cam.pitch), sp=Math.sin(cam.pitch);
    const cy=Math.cos(cam.yaw),   sy=Math.sin(cam.yaw);
    return [sy*cp, sp, -cy*cp];               // yaw 0 looks toward -Z
  };
  const rightVec = () => [Math.cos(cam.yaw), 0, Math.sin(cam.yaw)];  // horizontal

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  window.addEventListener('resize', resize);
  resize();

  // ── glTF → reusable GPU model ─────────────────────────────────────
  async function loadModel(url) {
    const base = new URL(url, location.href);
    const gltf = await (await fetch(base)).json();
    const buffers = await Promise.all((gltf.buffers||[]).map(b =>
      fetch(new URL(b.uri, base)).then(r => r.arrayBuffer())));
    const images = await Promise.all((gltf.images||[]).map(im =>
      loadImage(new URL(im.uri, base).href).catch(() => null)));

    const glBuffers = new Array((gltf.bufferViews||[]).length).fill(null);
    const getBuf = (bvIdx, target) => {
      if (glBuffers[bvIdx]) return glBuffers[bvIdx];
      const bv = gltf.bufferViews[bvIdx];
      const view = new Uint8Array(buffers[bv.buffer], bv.byteOffset||0, bv.byteLength);
      const b = gl.createBuffer();
      gl.bindBuffer(target, b); gl.bufferData(target, view, gl.STATIC_DRAW);
      return (glBuffers[bvIdx] = b);
    };
    const glTex = (gltf.textures||[]).map((t) => {
      const img = images[t.source];
      if (!img) return null;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return tex;
    });
    const attr = (ai) => {
      const acc = gltf.accessors[ai], bv = gltf.bufferViews[acc.bufferView];
      return { buffer:getBuf(acc.bufferView, gl.ARRAY_BUFFER), size:TYPE_N[acc.type],
               type:acc.componentType, normalized:!!acc.normalized,
               stride:bv.byteStride||0, offset:acc.byteOffset||0 };
    };

    const primitives = [];
    for (const node of iterNodes(gltf)) {
      if (node.mesh == null) continue;
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const at = prim.attributes;
        if (at.POSITION == null || prim.indices == null) continue;
        const iAcc = gltf.accessors[prim.indices];
        const mat = (prim.material != null && gltf.materials) ? gltf.materials[prim.material] : null;
        const pbr = (mat && mat.pbrMetallicRoughness) || {};
        const ti = pbr.baseColorTexture ? pbr.baseColorTexture.index : null;
        primitives.push({
          attribs: {
            position: attr(at.POSITION),
            uv:   at.TEXCOORD_0 != null ? attr(at.TEXCOORD_0) : null,
            color:at.COLOR_0    != null ? attr(at.COLOR_0)    : null,
            normal:at.NORMAL    != null ? attr(at.NORMAL)     : null,
          },
          index: { buffer:getBuf(iAcc.bufferView, gl.ELEMENT_ARRAY_BUFFER),
                   count:iAcc.count, type:iAcc.componentType, offset:iAcc.byteOffset||0 },
          material: { baseColor: pbr.baseColorFactor || [1,1,1,1],
                      texture: ti != null ? glTex[ti] : null },
        });
      }
    }
    return { primitives };
  }

  function getModel(name) {
    if (!modelCache.has(name))
      modelCache.set(name, loadModel(opts.modelBase + name).catch(() => null));
    return modelCache.get(name);
  }

  // ── Load a set of instances ───────────────────────────────────────
  async function loadInstances(instances) {
    const token = ++loadToken;
    renderList = [];

    const withGltf = instances.filter(i => i.gltf);
    const names = [...new Set(withGltf.map(i => i.gltf))];

    let done = 0;
    onProgress({ phase: 'loading', done, total: names.length });
    const models = new Map();
    // Bounded concurrency to avoid opening thousands of sockets at once.
    const queue = names.slice();
    async function worker() {
      while (queue.length) {
        const name = queue.shift();
        const m = await getModel(name);
        if (token !== loadToken) return;
        if (m) models.set(name, m);
        onProgress({ phase: 'loading', done: ++done, total: names.length });
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    if (token !== loadToken) return { cancelled: true };

    // Group instance matrices by model; accumulate world bounds.
    const groups = new Map();
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const inst of withGltf) {
      const model = models.get(inst.gltf);
      if (!model) continue;
      const M = instanceMatrix(inst);
      if (!groups.has(model)) groups.set(model, []);
      groups.get(model).push(M);
      const wx = M[12], wy = M[13], wz = M[14];        // world translation (Y-up)
      min[0]=Math.min(min[0],wx); min[1]=Math.min(min[1],wy); min[2]=Math.min(min[2],wz);
      max[0]=Math.max(max[0],wx); max[1]=Math.max(max[1],wy); max[2]=Math.max(max[2],wz);
    }
    renderList = [...groups].map(([model, matrices]) => ({ model, matrices }));
    frameCamera(min, max);
    onProgress({ phase: 'done', instances: withGltf.length, models: models.size });
    return { instances: withGltf.length, models: models.size };
  }

  // ── Pickups (toggleable overlay) ──────────────────────────────────
  async function loadPickups(instances) {
    const names = [...new Set(instances.map(i => i.gltf).filter(Boolean))];
    const models = new Map();
    for (const name of names) {
      const m = await getModel(name);
      if (m) models.set(name, m);
    }
    const groups = new Map();
    for (const inst of instances) {
      const model = models.get(inst.gltf);
      if (!model) continue;
      const M = instanceMatrix(inst);
      if (!groups.has(model)) groups.set(model, []);
      groups.get(model).push(M);
    }
    pickupRenderList = [...groups].map(([model, matrices]) => ({ model, matrices }));
    return { placed: pickupRenderList.reduce((n, g) => n + g.matrices.length, 0) };
  }

  // ── Transit (animated planes & trains) ────────────────────────────
  // paths.json: { key: { model, paths:[[x,y,z],…], speed(ms/step) }, … }.
  // Each path gets one moving instance that travels its looped polyline at a
  // *constant* velocity.  The waypoints are very unevenly spaced (a runway
  // segment can be 600× longer than a turn segment), so stepping a fixed time
  // per waypoint made the plane lurch — slow through tight points, rocketing
  // down long ones.  Instead we spend time in proportion to distance: `speed`
  // is the mean ms per segment, and the whole loop still takes n·speed ms.
  async function loadTransit(pathsObj) {
    const entries = Object.values(pathsObj || {})
      .filter(p => p && p.model && Array.isArray(p.paths) && p.paths.length);
    const names = [...new Set(entries.map(p => p.model))];
    const models = new Map();
    for (const name of names) {
      const m = await getModel(name);
      if (m) models.set(name, m);
    }
    transitList = [];
    for (const p of entries) {
      const model = models.get(p.model);
      if (!model) continue;
      const wp = p.paths, n = wp.length;
      const seg = new Array(n);                    // length of segment i → i+1 (looped)
      let total = 0;
      for (let i = 0; i < n; i++) {
        const a = wp[i], b = wp[(i + 1) % n];
        seg[i] = Math.hypot(b[0]-a[0], b[1]-a[1], b[2]-a[2]);
        total += seg[i];
      }
      const speed = p.speed || 250;
      // world units per ms; whole loop keeps its old duration (n·speed ms).
      const velocity = total > 0 ? total / (n * speed) : 0;
      transitList.push({ model, waypoints: wp, seg, velocity,
                         groundOffset: p.groundOffset || 0,
                         idx: 0, segPos: 0, heading: null });
    }
    return { count: transitList.length };
  }

  // Advance each transit along its polyline by (velocity·dt) world units,
  // crossing waypoint boundaries as needed — constant speed regardless of how
  // far apart the waypoints are.
  function updateTransit(dt) {
    const ms = dt * 1000;
    for (const t of transitList) {
      const n = t.waypoints.length;
      if (n < 2 || t.velocity <= 0) continue;
      let advance = t.velocity * ms;
      let guard = 0;                               // stop crossing after ~one loop
      while (advance > 0 && guard++ < n + 8) {
        const remain = t.seg[t.idx] - t.segPos;
        if (advance < remain) { t.segPos += advance; break; }
        advance -= remain;                         // finish this segment, step on
        t.idx = (t.idx + 1) % n;
        t.segPos = 0;
      }
    }
  }

  // Build this frame's draw groups: each transit is interpolated between its
  // current and next waypoint (fraction acc/speed) and yawed to face its
  // direction of travel.
  function transitGroups() {
    const list = [];
    for (const t of transitList) {
      const wp = t.waypoints, n = wp.length;
      const cur = wp[t.idx], nxt = wp[(t.idx + 1) % n];
      const segLen = t.seg[t.idx];
      const f = segLen > 1e-9 ? Math.min(1, t.segPos / segLen) : 0;   // 0..1 by distance
      const x = cur[0] + (nxt[0] - cur[0]) * f;
      const y = cur[1] + (nxt[1] - cur[1]) * f;
      // Raise by the path's groundOffset so the model rests on the surface: a
      // plane's origin is ~4 units above its belly, so without this it sinks
      // into the runway.  Per-path (in paths.json) so runways at different
      // heights can be corrected independently.
      const z = cur[2] + (nxt[2] - cur[2]) * f + (t.groundOffset || 0);
      // Heading: yaw about GTA up (Z) so the model's forward (+Y) points along
      // the horizontal travel direction.  Keep the last heading through any
      // zero-length segment (duplicate waypoints).
      const dx = nxt[0] - cur[0], dy = nxt[1] - cur[1];
      if (dx*dx + dy*dy > 1e-9) t.heading = Math.atan2(-dx, dy);
      const th = t.heading || 0;
      // instanceMatrix applies the quaternion's conjugate, so pass conj(Rz(th)).
      const M = instanceMatrix({ x, y, z, sx:1, sy:1, sz:1,
                                 rx:0, ry:0, rz:-Math.sin(th/2), rw:Math.cos(th/2) });
      list.push({ model: t.model, matrices: [M] });
    }
    return list;
  }

  // ── Water (tiled surface rectangles) ──────────────────────────────
  // water.json: { water:[{ level, xLeft, yBottom, xRight, yTop }, …] }.  Each
  // rectangle becomes a horizontal textured quad at height `level` (GTA Z),
  // with the water texture tiled every WATER_TILE units so it isn't stretched.
  const WATER_TILE = 40;                    // GTA world units per texture repeat
  async function loadWater(entries) {
    if (!Array.isArray(entries) || !entries.length) { water = null; return { rects: 0 }; }
    let texture = water && water.texture;
    if (!texture) {
      const img = await loadImage(new URL(opts.modelBase + 'water_old.png',
                                         location.href).href).catch(() => null);
      if (img) {
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      }
    }
    // Two triangles per rectangle.  GTA (x,y,z) → viewer Y-up (x, z, −y); the
    // quad is flat at world Y = level.  UVs are world position / tile size.
    const pos = [], uv = [];
    for (const r of entries) {
      const L = r.level || 0, x0 = r.xLeft, x1 = r.xRight, y0 = r.yBottom, y1 = r.yTop;
      const c = [
        [x0, L, -y0, x0 / WATER_TILE, y0 / WATER_TILE],
        [x1, L, -y0, x1 / WATER_TILE, y0 / WATER_TILE],
        [x1, L, -y1, x1 / WATER_TILE, y1 / WATER_TILE],
        [x0, L, -y1, x0 / WATER_TILE, y1 / WATER_TILE],
      ];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(c[i][0], c[i][1], c[i][2]);
        uv.push(c[i][3], c[i][4]);
      }
    }
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    const uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    water = { posBuf, uvBuf, count: pos.length / 3, texture };
    return { rects: entries.length };
  }

  const IDENTITY = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  function drawWater() {
    if (!water || !water.count) return;
    gl.uniformMatrix4fv(U.u_model, false, IDENTITY);
    gl.uniform4fv(U.u_baseColor, [1, 1, 1, 1]);
    gl.uniform1i(U.u_hasColor, 0);
    gl.uniform1i(U.u_lit, 0);
    setAttr(A.position, { buffer: water.posBuf, size:3, type: gl.FLOAT,
                          normalized:false, stride:0, offset:0 }, null);
    setAttr(A.uv,       { buffer: water.uvBuf,  size:2, type: gl.FLOAT,
                          normalized:false, stride:0, offset:0 }, null);
    setAttr(A.color,  null, [1,1,1,1]);
    setAttr(A.normal, null, [0,0,1,0]);
    if (water.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, water.texture);
      gl.uniform1i(U.u_tex, 0); gl.uniform1i(U.u_hasTex, 1);
    } else gl.uniform1i(U.u_hasTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, water.count);
  }

  // Draw the sky gradient as the backdrop: fills the framebuffer before the
  // world, with depth test off so it never occludes (and never writes depth).
  function drawSky() {
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(skyProg);
    gl.uniform3fv(uSkyTop, skyTop);
    gl.uniform3fv(uSkyBottom, skyBottom);
    gl.bindBuffer(gl.ARRAY_BUFFER, skyQuad);
    gl.enableVertexAttribArray(skyPosLoc);
    gl.vertexAttribPointer(skyPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(skyPosLoc);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(prog);
  }

  function frameCamera(min, max) {
    if (!isFinite(min[0])) { min=[-50,-50,-50]; max=[50,50,50]; }
    const cx=(min[0]+max[0])/2, cy=(min[1]+max[1])/2, cz=(min[2]+max[2])/2;
    const r = Math.max(5, 0.5*Math.hypot(max[0]-min[0], max[1]-min[1], max[2]-min[2]));
    // Perch back/above the centre and aim at it.
    cam.pos = [cx, cy + r*0.7, cz + r*1.3];
    const dx=cx-cam.pos[0], dy=cy-cam.pos[1], dz=cz-cam.pos[2];
    const dl=Math.hypot(dx,dy,dz)||1;
    cam.yaw = Math.atan2(dx/dl, -dz/dl);
    cam.pitch = Math.asin(dy/dl);
    cam.speed = r * 0.15;                      // base move units/sec (slider 1×)
    cam.near = Math.max(r*0.001, 0.5); cam.far = r*20;
  }

  // ── Render ────────────────────────────────────────────────────────
  function bindPrim(p) {
    setAttr(A.position, p.attribs.position, null);
    setAttr(A.uv,       p.attribs.uv,       [0,0,0,0]);
    setAttr(A.color,    p.attribs.color,    [1,1,1,1]);
    setAttr(A.normal,   p.attribs.normal,   [0,0,1,0]);
    gl.uniform4fv(U.u_baseColor, p.material.baseColor);
    gl.uniform1i(U.u_hasColor, p.attribs.color ? 1 : 0);
    gl.uniform1i(U.u_lit, (p.attribs.normal && !p.attribs.color) ? 1 : 0);
    if (p.material.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, p.material.texture);
      gl.uniform1i(U.u_tex, 0); gl.uniform1i(U.u_hasTex, 1);
    } else gl.uniform1i(U.u_hasTex, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.index.buffer);
  }
  function drawGroups(list) {
    for (const { model, matrices } of list)
      for (const p of model.primitives) {
        bindPrim(p);
        for (const m of matrices) {
          gl.uniformMatrix4fv(U.u_model, false, m);
          gl.drawElements(gl.TRIANGLES, p.index.count, p.index.type, p.index.offset);
        }
      }
  }
  function setAttr(loc, a, c) {
    if (loc < 0) return;
    if (a) {
      gl.enableVertexAttribArray(loc);
      gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
      gl.vertexAttribPointer(loc, a.size, a.type, a.normalized, a.stride, a.offset);
    } else { gl.disableVertexAttribArray(loc); gl.vertexAttrib4f(loc, c[0],c[1],c[2],c[3]); }
  }

  let lastTime = performance.now();

  function frame() {
    const now = performance.now();
    let dt = (now - lastTime) / 1000; lastTime = now;
    if (dt > 0.1) dt = 0.1;                 // clamp after tab-switches
    applyMovement(dt);

    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (skyVisible) drawSky();
    if (renderList.length) {
      const aspect = canvas.width / canvas.height || 1;
      const proj = Mat4.perspective(Math.PI/4, aspect, cam.near, cam.far);
      const f = forwardVec();
      const view = Mat4.lookAt(cam.pos,
        [cam.pos[0]+f[0], cam.pos[1]+f[1], cam.pos[2]+f[2]], [0,1,0]);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.u_proj, false, proj);
      gl.uniformMatrix4fv(U.u_view, false, view);
      drawGroups(renderList);
      if (waterVisible) drawWater();
      if (pickupsVisible) drawGroups(pickupRenderList);
      if (transitVisible && transitList.length) {
        updateTransit(dt);
        drawGroups(transitGroups());
      }
    }
    requestAnimationFrame(frame);
  }

  // ── Look controls ─────────────────────────────────────────────────
  // Mouse turns the head from the current position (yaw/pitch), the eye stays
  // put — no orbiting.  Drag to look, or click for pointer-locked look (Esc
  // releases).  Wheel dollies forward/back along the view.
  let drag = null, moved = false, locked = false;
  const LOOK = 0.0028;
  const clampPitch = p => Math.max(-Math.PI/2 + 0.02, Math.min(Math.PI/2 - 0.02, p));
  const look = (dx, dy) => {
    cam.yaw   += dx * LOOK;
    cam.pitch  = clampPitch(cam.pitch - dy * LOOK);
  };

  canvas.addEventListener('mousedown', e => {
    // Interacting with the canvas hands control to the camera: drop focus from
    // the fly-speed slider / pickups checkbox (both <input>s) so they no longer
    // swallow the arrow keys.
    if (document.activeElement && document.activeElement !== document.body)
      document.activeElement.blur();
    if (locked) return;
    drag = { x:e.clientX, y:e.clientY }; moved = false;
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (locked) { look(e.movementX, e.movementY); return; }
    if (!drag) return;
    const dx=e.clientX-drag.x, dy=e.clientY-drag.y; drag.x=e.clientX; drag.y=e.clientY;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    look(dx, dy);
  });
  window.addEventListener('mouseup', () => { drag=null; });
  canvas.addEventListener('click', () => { if (!locked && !moved) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange',
    () => { locked = document.pointerLockElement === canvas; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const f = forwardVec(), d = -e.deltaY * cam.speed * 0.003;
    cam.pos[0]+=f[0]*d; cam.pos[1]+=f[1]*d; cam.pos[2]+=f[2]*d;
  }, { passive:false });

  // ── Fly-through: WASD / arrows move, Q/E up-down, Shift sprints ────
  const MOVE_KEYS = new Set(['w','a','s','d','q','e',
    'arrowup','arrowdown','arrowleft','arrowright']);
  const keys = new Set();
  let sprint = false;
  const isTyping = () => {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  };
  window.addEventListener('keydown', e => {
    if (isTyping()) return;
    const k = e.key.toLowerCase();
    if (k === 'shift') { sprint = true; return; }
    if (MOVE_KEYS.has(k)) { keys.add(k); e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'shift') sprint = false;
    keys.delete(k);
  });
  window.addEventListener('blur', () => { keys.clear(); sprint = false; });

  function applyMovement(dt) {
    if (!keys.size) return;
    const fwd = forwardVec(), right = rightVec();
    const step = cam.speed * speedMult * (sprint ? 3 : 1) * dt;
    let dx=0, dy=0, dz=0;
    if (keys.has('w') || keys.has('arrowup'))    { dx+=fwd[0]; dy+=fwd[1]; dz+=fwd[2]; }
    if (keys.has('s') || keys.has('arrowdown'))  { dx-=fwd[0]; dy-=fwd[1]; dz-=fwd[2]; }
    if (keys.has('d') || keys.has('arrowright')) { dx+=right[0];          dz+=right[2]; }
    if (keys.has('a') || keys.has('arrowleft'))  { dx-=right[0];          dz-=right[2]; }
    if (keys.has('e')) dy += 1;
    if (keys.has('q')) dy -= 1;
    cam.pos[0]+=dx*step; cam.pos[1]+=dy*step; cam.pos[2]+=dz*step;
  }

  requestAnimationFrame(frame);
  return {
    loadInstances, loadPickups, loadTransit, loadWater,
    setSpeed(v) { speedMult = v; },
    setPickupsVisible(b) { pickupsVisible = b; },
    setTransitVisible(b) { transitVisible = b; },
    setWaterVisible(b) { waterVisible = b; },
    // Sky gradient. opts: { visible, top:[r,g,b], bottom:[r,g,b] } (RGB 0..1).
    setSky(opts = {}) {
      if (opts.visible !== undefined) skyVisible = opts.visible;
      if (opts.top)    skyTop = opts.top;
      if (opts.bottom) skyBottom = opts.bottom;
    },
    // Jump the camera to look at a GTA-space point (x,y,z) from `dist` away.
    focusWorld(gx, gy, gz, dist = 60) {
      const wx = gx, wy = gz, wz = -gy;          // GTA (Z-up) → viewer (Y-up)
      cam.pos = [wx, wy + dist * 0.35, wz + dist];
      const dx = wx - cam.pos[0], dy = wy - cam.pos[1], dz = wz - cam.pos[2];
      const dl = Math.hypot(dx, dy, dz) || 1;
      cam.yaw = Math.atan2(dx / dl, -dz / dl);
      cam.pitch = Math.asin(dy / dl);
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────
function* iterNodes(gltf) {
  const sc = gltf.scenes ? gltf.scenes[gltf.scene||0] : null;
  const roots = sc ? sc.nodes : (gltf.nodes||[]).map((_,i)=>i);
  const stack = [...(roots||[])];
  while (stack.length) {
    const n = gltf.nodes[stack.pop()];
    if (!n) continue;
    yield n;
    if (n.children) stack.push(...n.children);
  }
}
function loadImage(url) {
  return new Promise((res, rej) => { const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; });
}
function linkProgram(gl, vs, fs) {
  const c=(t,s)=>{const sh=gl.createShader(t);gl.shaderSource(sh,s);gl.compileShader(sh);
    if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error('shader: '+gl.getShaderInfoLog(sh));return sh;};
  const p=gl.createProgram();
  gl.attachShader(p,c(gl.VERTEX_SHADER,vs)); gl.attachShader(p,c(gl.FRAGMENT_SHADER,fs));
  gl.linkProgram(p);
  if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('link: '+gl.getProgramInfoLog(p));
  return p;
}

window.createSceneRenderer = createSceneRenderer;
