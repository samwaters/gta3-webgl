/* ─────────────────────────────────────────────────────────────────────
   GTA3 Model Viewer — raw WebGL glTF renderer (no libraries)

   Loads the glTF 2.0 files produced by gta_to_gltf.py:
     - external .bin buffers, PNG textures
     - attributes POSITION / TEXCOORD_0 / COLOR_0 / NORMAL
     - pbrMetallicRoughness baseColorFactor + baseColorTexture
   Orbit camera: drag to rotate, wheel to zoom, right-drag to pan.
   ───────────────────────────────────────────────────────────────────── */

'use strict';

// ── Minimal column-major mat4 helpers ─────────────────────────────────
const M4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ]);
  },
  lookAt(eye, center, up) {
    let [ex, ey, ez] = eye, [cx, cy, cz] = center, [ux, uy, uz] = up;
    let zx = ex - cx, zy = ey - cy, zz = ez - cz;
    let zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    let xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez),
      -(yx * ex + yy * ey + yz * ez),
      -(zx * ex + zy * ey + zz * ez), 1,
    ]);
  },
};

// ── Shaders (GLSL ES 1.00 — valid under WebGL1 and WebGL2) ─────────────
const VERT_SRC = `
precision highp float;
attribute vec3 a_position;
attribute vec2 a_uv;
attribute vec4 a_color;
attribute vec3 a_normal;
uniform mat4 u_proj;
uniform mat4 u_view;
varying vec2 v_uv;
varying vec4 v_color;
varying vec3 v_normal;
void main() {
  v_uv = a_uv;
  v_color = a_color;
  v_normal = mat3(u_view) * a_normal;   // view-space normal (model = identity)
  gl_Position = u_proj * u_view * vec4(a_position, 1.0);
}`;

const FRAG_SRC = `
precision highp float;
varying vec2 v_uv;
varying vec4 v_color;
varying vec3 v_normal;
uniform vec4 u_baseColor;
uniform sampler2D u_tex;
uniform bool u_hasTex;
uniform bool u_hasColor;
uniform bool u_lit;
uniform float u_prelitStrength;   // how much baked vertex-lighting to apply
void main() {
  vec4 c = u_baseColor;
  if (u_hasTex) c *= texture2D(u_tex, v_uv);
  if (c.a < 0.5) discard;                 // alpha cutout (fences, foliage)

  vec3 light = vec3(1.0);
  if (u_hasColor) {
    // GTA3 prelit colours bake in a very dark ambient (~15%) that the engine
    // lifts with a bright time-of-day light we don't have.  Blend the bake
    // toward white so the texture stays visible while keeping AO variation.
    light = mix(vec3(1.0), v_color.rgb, u_prelitStrength);
  } else if (u_lit) {
    vec3 n = normalize(v_normal);
    vec3 L = normalize(vec3(0.35, 0.55, 1.0));   // head-ish light, view space
    light = vec3(0.45 + 0.55 * max(dot(n, L), 0.0));
  }
  gl_FragColor = vec4(c.rgb * light, c.a);
}`;

// glTF component type → bytes
const COMP_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };


function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) throw new Error('WebGL not available');
  const isGL2 = (typeof WebGL2RenderingContext !== 'undefined') &&
                (gl instanceof WebGL2RenderingContext);
  if (!isGL2) gl.getExtension('OES_element_index_uint');  // uint indices on WebGL1

  // ── Program ──────────────────────────────────────────────────────
  const prog = linkProgram(gl, VERT_SRC, FRAG_SRC);
  gl.useProgram(prog);
  const A = {
    position: gl.getAttribLocation(prog, 'a_position'),
    uv:       gl.getAttribLocation(prog, 'a_uv'),
    color:    gl.getAttribLocation(prog, 'a_color'),
    normal:   gl.getAttribLocation(prog, 'a_normal'),
  };
  const U = {
    proj:      gl.getUniformLocation(prog, 'u_proj'),
    view:      gl.getUniformLocation(prog, 'u_view'),
    baseColor: gl.getUniformLocation(prog, 'u_baseColor'),
    tex:       gl.getUniformLocation(prog, 'u_tex'),
    hasTex:    gl.getUniformLocation(prog, 'u_hasTex'),
    hasColor:  gl.getUniformLocation(prog, 'u_hasColor'),
    lit:       gl.getUniformLocation(prog, 'u_lit'),
    prelitStrength: gl.getUniformLocation(prog, 'u_prelitStrength'),
  };
  gl.uniform1f(U.prelitStrength, 0.55);   // 0 = ignore bake, 1 = raw (very dark)

  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);        // GTA winding is inconsistent; models are doubleSided
  gl.clearColor(0, 0, 0, 0);

  // ── Scene / camera state ─────────────────────────────────────────
  let scene = null;                // { primitives[], glBuffers[], textures[] }
  const cam = {
    target: [0, 0, 0], radius: 5, theta: 0.9, phi: 1.15,
    minR: 0.01, maxR: 1000, near: 0.05, far: 1000,
  };

  // ── Resize (device-pixel aware) ──────────────────────────────────
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
    }
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Render loop ──────────────────────────────────────────────────
  function frame() {
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (scene) {
      const aspect = canvas.width / canvas.height || 1;
      const proj = M4.perspective(Math.PI / 4, aspect, cam.near, cam.far);
      const sp = Math.sin(cam.phi), cp = Math.cos(cam.phi);
      const st = Math.sin(cam.theta), ct = Math.cos(cam.theta);
      const eye = [
        cam.target[0] + cam.radius * sp * st,
        cam.target[1] + cam.radius * cp,
        cam.target[2] + cam.radius * sp * ct,
      ];
      const view = M4.lookAt(eye, cam.target, [0, 1, 0]);
      gl.useProgram(prog);
      gl.uniformMatrix4fv(U.proj, false, proj);
      gl.uniformMatrix4fv(U.view, false, view);
      for (const p of scene.primitives) drawPrimitive(p);
    }
    requestAnimationFrame(frame);
  }

  function drawPrimitive(p) {
    // Attributes (bind present ones; supply constants for the rest).
    bindAttrib(A.position, p.attribs.position, null);
    bindAttrib(A.uv,       p.attribs.uv,       [0, 0, 0, 0]);
    bindAttrib(A.color,    p.attribs.color,    [1, 1, 1, 1]);
    bindAttrib(A.normal,   p.attribs.normal,   [0, 0, 1, 0]);

    const m = p.material;
    gl.uniform4fv(U.baseColor, m.baseColor);
    gl.uniform1i(U.hasColor, p.attribs.color ? 1 : 0);
    gl.uniform1i(U.lit, (p.attribs.normal && !p.attribs.color) ? 1 : 0);

    if (m.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, m.texture);
      gl.uniform1i(U.tex, 0);
      gl.uniform1i(U.hasTex, 1);
    } else {
      gl.uniform1i(U.hasTex, 0);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, p.index.buffer);
    gl.drawElements(p.mode, p.index.count, p.index.type, p.index.offset);
  }

  function bindAttrib(loc, a, constVal) {
    if (loc < 0) return;
    if (a) {
      gl.enableVertexAttribArray(loc);
      gl.bindBuffer(gl.ARRAY_BUFFER, a.buffer);
      gl.vertexAttribPointer(loc, a.size, a.type, a.normalized, a.stride, a.offset);
    } else {
      gl.disableVertexAttribArray(loc);
      gl.vertexAttrib4f(loc, constVal[0], constVal[1], constVal[2], constVal[3]);
    }
  }

  // ── Dispose current scene GPU resources ──────────────────────────
  function disposeScene() {
    if (!scene) return;
    for (const b of scene.glBuffers) gl.deleteBuffer(b);
    for (const t of scene.textures) gl.deleteTexture(t);
    scene = null;
  }

  // ── Load a glTF ──────────────────────────────────────────────────
  async function load(gltfUrl) {
    const baseUrl = new URL(gltfUrl, location.href);
    const gltf = await (await fetch(baseUrl)).json();

    // Buffers (.bin)
    const buffers = await Promise.all(
      (gltf.buffers || []).map(b =>
        fetch(new URL(b.uri, baseUrl)).then(r => r.arrayBuffer()))
    );

    // Images / textures (tolerate missing PNGs — fall back to base color)
    const images = await Promise.all(
      (gltf.images || []).map(img =>
        loadImage(new URL(img.uri, baseUrl).href).catch(() => null))
    );

    disposeScene();

    const glBuffers = new Array((gltf.bufferViews || []).length).fill(null);
    const getGLBuffer = (bvIndex, target) => {
      if (glBuffers[bvIndex]) return glBuffers[bvIndex];
      const bv = gltf.bufferViews[bvIndex];
      const view = new Uint8Array(buffers[bv.buffer], bv.byteOffset || 0, bv.byteLength);
      const buf = gl.createBuffer();
      gl.bindBuffer(target, buf);
      gl.bufferData(target, view, gl.STATIC_DRAW);
      glBuffers[bvIndex] = buf;
      return buf;
    };

    // Textures
    const textures = [];
    const glTextures = (gltf.textures || []).map((t, i) => {
      const image = images[gltf.textures[i].source];
      if (!image) return null;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // glTF UV origin is the top-left of the image, matching WebGL's default
      // upload orientation — so do NOT flip Y here (flipping turns oriented
      // textures like signs and tree billboards upside-down).
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      textures.push(tex);
      return tex;
    });

    const attribFrom = (accIndex) => {
      const acc = gltf.accessors[accIndex];
      const bv = gltf.bufferViews[acc.bufferView];
      return {
        buffer: getGLBuffer(acc.bufferView, gl.ARRAY_BUFFER),
        size: TYPE_COMPONENTS[acc.type],
        type: acc.componentType,
        normalized: !!acc.normalized,
        stride: bv.byteStride || 0,
        offset: acc.byteOffset || 0,
      };
    };

    // Build primitives + bounding box
    const primitives = [];
    const bbMin = [Infinity, Infinity, Infinity];
    const bbMax = [-Infinity, -Infinity, -Infinity];

    for (const node of iterSceneNodes(gltf)) {
      if (node.mesh == null) continue;
      const mesh = gltf.meshes[node.mesh];
      for (const prim of mesh.primitives) {
        const at = prim.attributes;
        const attribs = {
          position: at.POSITION   != null ? attribFrom(at.POSITION)   : null,
          uv:       at.TEXCOORD_0 != null ? attribFrom(at.TEXCOORD_0) : null,
          color:    at.COLOR_0    != null ? attribFrom(at.COLOR_0)    : null,
          normal:   at.NORMAL     != null ? attribFrom(at.NORMAL)     : null,
        };
        if (!attribs.position || prim.indices == null) continue;

        // Bounds from POSITION accessor min/max.
        const pAcc = gltf.accessors[at.POSITION];
        if (pAcc.min && pAcc.max) {
          for (let i = 0; i < 3; i++) {
            bbMin[i] = Math.min(bbMin[i], pAcc.min[i]);
            bbMax[i] = Math.max(bbMax[i], pAcc.max[i]);
          }
        }

        const iAcc = gltf.accessors[prim.indices];
        const iBv = gltf.bufferViews[iAcc.bufferView];
        const mat = (prim.material != null && gltf.materials)
          ? gltf.materials[prim.material] : null;
        const pbr = mat && mat.pbrMetallicRoughness || {};
        const texIndex = pbr.baseColorTexture ? pbr.baseColorTexture.index : null;

        primitives.push({
          mode: prim.mode == null ? gl.TRIANGLES : prim.mode,
          attribs,
          index: {
            buffer: getGLBuffer(iAcc.bufferView, gl.ELEMENT_ARRAY_BUFFER),
            count: iAcc.count,
            type: iAcc.componentType,
            offset: iAcc.byteOffset || 0,
          },
          material: {
            baseColor: pbr.baseColorFactor || [1, 1, 1, 1],
            texture: texIndex != null ? glTextures[texIndex] : null,
          },
        });
        void iBv;
      }
    }

    scene = { primitives, glBuffers: glBuffers.filter(Boolean), textures };
    frameCamera(bbMin, bbMax);
    return { primitives: primitives.length };
  }

  // Fit the orbit camera to the model's bounding box.
  function frameCamera(min, max) {
    if (!isFinite(min[0])) { min = [-1, -1, -1]; max = [1, 1, 1]; }
    const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
    const r = Math.max(
      0.001,
      0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
    cam.target = [cx, cy, cz];
    cam.radius = r / Math.sin(Math.PI / 8) * 1.1;   // fit within fov
    cam.theta = 0.9; cam.phi = 1.15;
    cam.minR = r * 0.05;
    cam.maxR = r * 40;
    cam.near = Math.max(r * 0.01, 0.01);
    cam.far  = r * 200;
  }

  // ── Orbit / zoom / pan controls ──────────────────────────────────
  let drag = null;
  canvas.addEventListener('mousedown', e => {
    drag = { x: e.clientX, y: e.clientY, btn: e.button };
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    if (drag.btn === 2 || e.shiftKey) {           // pan
      const panScale = cam.radius * 0.0015;
      const st = Math.sin(cam.theta), ct = Math.cos(cam.theta);
      cam.target[0] -= (dx * ct - 0) * panScale;
      cam.target[2] -= (-dx * st) * panScale;
      cam.target[1] += dy * panScale;
    } else {                                       // rotate
      cam.theta -= dx * 0.01;
      cam.phi = Math.max(0.05, Math.min(Math.PI - 0.05, cam.phi - dy * 0.01));
    }
  });
  window.addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    cam.radius = Math.max(cam.minR, Math.min(cam.maxR,
      cam.radius * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });

  requestAnimationFrame(frame);
  return { load, dispose: disposeScene };
}


// ── Helpers ────────────────────────────────────────────────────────────
function* iterSceneNodes(gltf) {
  const sceneObj = gltf.scenes ? gltf.scenes[gltf.scene || 0] : null;
  const rootIdx = sceneObj ? sceneObj.nodes : (gltf.nodes || []).map((_, i) => i);
  const stack = [...(rootIdx || [])];
  while (stack.length) {
    const node = gltf.nodes[stack.pop()];
    if (!node) continue;
    yield node;
    if (node.children) stack.push(...node.children);
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function linkProgram(gl, vs, fs) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error('Shader compile: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error('Program link: ' + gl.getProgramInfoLog(p));
  return p;
}

window.createRenderer = createRenderer;
