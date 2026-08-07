/* ─────────────────────────────────────────────────────────────────────
   GTA3 Model Viewer — raw WebGL glTF renderer (no libraries)

   Renders the glTF 2.0 files produced by gta_to_gltf.py:
     - external .bin buffers, PNG textures
     - attributes POSITION / TEXCOORD_0 / COLOR_0 / NORMAL
     - pbrMetallicRoughness baseColorFactor + baseColorTexture

   Every byte comes out of OPFS via the worker pool — nothing is fetched over
   the network, so the viewer works entirely from the extracted archive.

   Orbit camera: drag to rotate, wheel to zoom, right-drag (or shift-drag)
   to pan.
   ───────────────────────────────────────────────────────────────────── */

import { Decode } from "../decode"
import { getFilesFromOPFS } from "../files"
import {
  FIT_MARGIN,
  FOV,
  MAX_PIXEL_RATIO,
  PRELIT_STRENGTH,
  START_PHI,
  START_THETA,
  TYPE_COMPONENTS,
} from "./constants"
import { decodeImage, iterSceneNodes, resolvePath } from "./helpers"
import { M4, type Vec3 } from "./M4"
import type {
  Attribute,
  AttributeLocations,
  BoundingBox,
  Camera,
  Drag,
  GlTF,
  Primitive,
  PrimitiveAttributes,
  Scene,
  UniformLocations,
} from "./renderer.types"
import { createProgram, FRAG_SRC, VERT_SRC } from "./shaders"
import { cross, dot, normalise } from "./vector"

export class Renderer {
  /**
   * Resolves once the model is on the GPU, rejects if it could not be loaded.
   * Attach a handler — nothing else reports load failures.
   */
  public readonly ready: Promise<void>

  private readonly attributes: AttributeLocations
  private readonly canvas: HTMLCanvasElement
  private readonly gl: WebGLRenderingContext
  private readonly program: WebGLProgram
  private readonly uniforms: UniformLocations

  // Replaced wholesale by frameCamera() as soon as a model is loaded; nothing
  // is drawn before that, so these are just placeholders.
  private camera: Camera = {
    far: 1000,
    maxRadius: 1000,
    minRadius: 0.01,
    near: 0.05,
    phi: START_PHI,
    radius: 5,
    target: [0, 0, 0],
    theta: START_THETA,
  }
  private disposed = false
  private drag: Drag | null = null
  private frameId = 0
  private pendingFit: BoundingBox | null = null
  private scene: Scene | null = null

  /**
   * @param path OPFS path of the .gltf to render, e.g. "air_grnd01.gltf"
   * @param canvas The canvas to draw into
   */
  public constructor(path: string, canvas: HTMLCanvasElement) {
    // WebGL2 is a superset of everything used here, so the context is treated
    // as WebGL1 throughout and only the index-size extension cares which it is.
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null
    if (!gl) {
      throw new Error("WebGL not available")
    }
    const isGL2 =
      typeof WebGL2RenderingContext !== "undefined" &&
      gl instanceof WebGL2RenderingContext
    if (!isGL2) {
      // Uint32 indices on WebGL1.
      gl.getExtension("OES_element_index_uint")
    }

    this.canvas = canvas
    this.gl = gl
    this.program = createProgram(gl, VERT_SRC, FRAG_SRC)
    gl.useProgram(this.program)

    this.attributes = {
      color: gl.getAttribLocation(this.program, "a_color"),
      normal: gl.getAttribLocation(this.program, "a_normal"),
      position: gl.getAttribLocation(this.program, "a_position"),
      uv: gl.getAttribLocation(this.program, "a_uv"),
    }
    this.uniforms = {
      baseColor: gl.getUniformLocation(this.program, "u_baseColor"),
      hasColor: gl.getUniformLocation(this.program, "u_hasColor"),
      hasTex: gl.getUniformLocation(this.program, "u_hasTex"),
      lit: gl.getUniformLocation(this.program, "u_lit"),
      prelitStrength: gl.getUniformLocation(this.program, "u_prelitStrength"),
      proj: gl.getUniformLocation(this.program, "u_proj"),
      tex: gl.getUniformLocation(this.program, "u_tex"),
      view: gl.getUniformLocation(this.program, "u_view"),
    }
    gl.uniform1f(this.uniforms.prelitStrength, PRELIT_STRENGTH)

    gl.enable(gl.DEPTH_TEST)
    // GTA winding is inconsistent; the models are all doubleSided.
    gl.disable(gl.CULL_FACE)
    gl.clearColor(0, 0, 0, 0)

    canvas.addEventListener("mousedown", this.onMouseDown)
    canvas.addEventListener("contextmenu", this.onContextMenu)
    canvas.addEventListener("wheel", this.onWheel, { passive: false })
    window.addEventListener("mousemove", this.onMouseMove)
    window.addEventListener("mouseup", this.onMouseUp)

    this.frameId = requestAnimationFrame(this.frame)
    this.ready = this.load(path)
  }

  /**
   * Stop rendering, drop every listener, and release the GPU resources. The
   * instance is dead afterwards; make a new one to show another model.
   */
  public dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    cancelAnimationFrame(this.frameId)
    this.canvas.removeEventListener("mousedown", this.onMouseDown)
    this.canvas.removeEventListener("contextmenu", this.onContextMenu)
    this.canvas.removeEventListener("wheel", this.onWheel)
    window.removeEventListener("mousemove", this.onMouseMove)
    window.removeEventListener("mouseup", this.onMouseUp)
    this.disposeScene()
    this.gl.deleteProgram(this.program)
  }

  /* ── Loading ─────────────────────────────────────────────────────── */

  /**
   * Read the glTF and everything it references out of OPFS, then upload it
   * @param path OPFS path of the .gltf
   */
  private async load(path: string): Promise<void> {
    const baseDir = path.slice(0, path.lastIndexOf("/") + 1)

    const { files: gltfFiles } = await getFilesFromOPFS([path])
    const gltfBytes = gltfFiles[path]
    if (!gltfBytes) {
      throw new Error(`Not in OPFS: ${path}`)
    }
    const gltf = JSON.parse(Decode.decode(gltfBytes)) as GlTF
    if (this.disposed) {
      return
    }

    // Buffers and images are pulled in one round trip; a model has one .bin
    // and a few dozen PNGs, and the worker reads them in parallel anyway.
    const bufferPaths = (gltf.buffers ?? []).map((buffer) => {
      if (!buffer.uri) {
        // GLB-style embedded buffers; the exporter never emits them.
        throw new Error(`Unsupported buffer without uri in ${path}`)
      }
      return resolvePath(baseDir, buffer.uri)
    })
    const imagePaths = (gltf.images ?? []).map((image) =>
      image.uri ? resolvePath(baseDir, image.uri) : null,
    )

    const { files } = await getFilesFromOPFS([
      ...new Set([...bufferPaths, ...imagePaths.filter((p) => p !== null)]),
    ])
    if (this.disposed) {
      return
    }

    const buffers = bufferPaths.map((bufferPath) => {
      const bytes = files[bufferPath]
      if (!bytes) {
        throw new Error(`Not in OPFS: ${bufferPath}`)
      }
      return bytes
    })
    // Missing PNGs are tolerated — the primitive falls back to its base colour.
    const images = await Promise.all(
      imagePaths.map((imagePath) =>
        imagePath === null ? null : decodeImage(files[imagePath]),
      ),
    )

    if (this.disposed) {
      for (const image of images) {
        image?.close()
      }
      return
    }
    this.build(gltf, buffers, images)
    for (const image of images) {
      image?.close()
    }
  }

  /**
   * Turn a parsed glTF and its loaded dependencies into GPU state
   * @param gltf The parsed glTF
   * @param buffers Contents of each entry in gltf.buffers
   * @param images Decoded contents of each entry in gltf.images, null if absent
   */
  private build(
    gltf: GlTF,
    buffers: Uint8Array<ArrayBuffer>[],
    images: (ImageBitmap | null)[],
  ) {
    const gl = this.gl
    this.disposeScene()

    const bufferViews = gltf.bufferViews ?? []
    const accessors = gltf.accessors ?? []
    const glBuffers: (WebGLBuffer | null)[] = new Array(
      bufferViews.length,
    ).fill(null)

    /**
     * Upload a bufferView once and reuse it for every accessor that points at
     * it. The target of the first use sticks, which is fine because the
     * exporter never shares a view between vertex and index data.
     */
    const getGLBuffer = (viewIndex: number, target: number): WebGLBuffer => {
      const cached = glBuffers[viewIndex]
      if (cached) {
        return cached
      }
      const view = bufferViews[viewIndex]
      const bytes = buffers[view.buffer]
      const offset = view.byteOffset ?? 0
      const buffer = gl.createBuffer()
      gl.bindBuffer(target, buffer)
      gl.bufferData(
        target,
        bytes.subarray(offset, offset + view.byteLength),
        gl.STATIC_DRAW,
      )
      glBuffers[viewIndex] = buffer
      return buffer
    }

    const textures: WebGLTexture[] = []
    const glTextures = (gltf.textures ?? []).map((texture) => {
      const image = texture.source === undefined ? null : images[texture.source]
      if (!image) {
        return null
      }
      const handle = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, handle)
      // glTF UV origin is the top-left of the image, matching WebGL's default
      // upload orientation — so do NOT flip Y here (flipping turns oriented
      // textures like signs and tree billboards upside-down).
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      )
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
      textures.push(handle)
      return handle
    })

    const attribFrom = (accessorIndex: number): Attribute | null => {
      const accessor = accessors[accessorIndex]
      if (!accessor || accessor.bufferView === undefined) {
        return null
      }
      const view = bufferViews[accessor.bufferView]
      return {
        buffer: getGLBuffer(accessor.bufferView, gl.ARRAY_BUFFER),
        normalized: !!accessor.normalized,
        offset: accessor.byteOffset ?? 0,
        size: TYPE_COMPONENTS[accessor.type],
        stride: view.byteStride ?? 0,
        type: accessor.componentType,
      }
    }

    const primitives: Primitive[] = []
    const bbMin: Vec3 = [Infinity, Infinity, Infinity]
    const bbMax: Vec3 = [-Infinity, -Infinity, -Infinity]

    for (const node of iterSceneNodes(gltf)) {
      if (node.mesh === undefined) {
        continue
      }
      const mesh = gltf.meshes?.[node.mesh]
      for (const primitive of mesh?.primitives ?? []) {
        const at = primitive.attributes
        const position =
          at.POSITION === undefined ? null : attribFrom(at.POSITION)
        if (!position || primitive.indices === undefined) {
          continue
        }
        const attribs: PrimitiveAttributes = {
          color: at.COLOR_0 === undefined ? null : attribFrom(at.COLOR_0),
          normal: at.NORMAL === undefined ? null : attribFrom(at.NORMAL),
          position,
          uv: at.TEXCOORD_0 === undefined ? null : attribFrom(at.TEXCOORD_0),
        }

        // Bounds come from the POSITION accessor's min/max, which the spec
        // makes mandatory, so the vertex data never has to be read back.
        const positionAccessor = accessors[at.POSITION!]
        if (positionAccessor.min && positionAccessor.max) {
          for (let i = 0; i < 3; i++) {
            bbMin[i] = Math.min(bbMin[i], positionAccessor.min[i])
            bbMax[i] = Math.max(bbMax[i], positionAccessor.max[i])
          }
        }

        const indexAccessor = accessors[primitive.indices]
        const material =
          primitive.material === undefined
            ? undefined
            : gltf.materials?.[primitive.material]
        const pbr = material?.pbrMetallicRoughness ?? {}
        const textureIndex = pbr.baseColorTexture?.index

        primitives.push({
          attribs,
          index: {
            buffer: getGLBuffer(
              indexAccessor.bufferView!,
              gl.ELEMENT_ARRAY_BUFFER,
            ),
            count: indexAccessor.count,
            offset: indexAccessor.byteOffset ?? 0,
            type: indexAccessor.componentType,
          },
          material: {
            baseColor: pbr.baseColorFactor ?? [1, 1, 1, 1],
            texture:
              textureIndex === undefined ? null : glTextures[textureIndex],
          },
          mode: primitive.mode ?? gl.TRIANGLES,
        })
      }
    }

    this.scene = {
      buffers: glBuffers.filter((buffer) => buffer !== null),
      primitives,
      textures,
    }
    // Framing needs the viewport's aspect ratio, which is only trustworthy
    // once the canvas has actually been laid out, so it waits for a frame.
    // No primitive carried bounds, so fall back to a unit cube.
    this.pendingFit = isFinite(bbMin[0])
      ? { max: bbMax, min: bbMin }
      : { max: [1, 1, 1], min: [-1, -1, -1] }
  }

  /**
   * Release the current model's buffers and textures
   */
  private disposeScene() {
    if (!this.scene) {
      return
    }
    for (const buffer of this.scene.buffers) {
      this.gl.deleteBuffer(buffer)
    }
    for (const texture of this.scene.textures) {
      this.gl.deleteTexture(texture)
    }
    this.scene = null
  }

  /* ── Drawing ─────────────────────────────────────────────────────── */

  /**
   * Match the drawing buffer to the canvas's on-screen size. Cheap enough to
   * run every frame, which is also how the viewer follows a resized sidebar.
   *
   * The canvas is positioned out of flow (see model.module.css) so that
   * writing these sizes cannot change the layout that produced them.
   */
  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    const bounds = this.canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(bounds.width * dpr))
    const height = Math.max(1, Math.round(bounds.height * dpr))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
  }

  private readonly frame = () => {
    if (this.disposed) {
      return
    }
    this.frameId = requestAnimationFrame(this.frame)

    const gl = this.gl
    this.resize()
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    if (!this.scene) {
      return
    }

    const aspect = this.canvas.width / this.canvas.height || 1
    // A freshly loaded model is framed here rather than at load time, because
    // this is the first point the viewport's real size is known.
    if (this.pendingFit) {
      this.frameCamera(this.pendingFit, aspect)
      this.pendingFit = null
    }
    const cam = this.camera
    const proj = M4.perspective(FOV, aspect, cam.near, cam.far)
    const sinPhi = Math.sin(cam.phi)
    const cosPhi = Math.cos(cam.phi)
    const sinTheta = Math.sin(cam.theta)
    const cosTheta = Math.cos(cam.theta)
    const eye: Vec3 = [
      cam.target[0] + cam.radius * sinPhi * sinTheta,
      cam.target[1] + cam.radius * cosPhi,
      cam.target[2] + cam.radius * sinPhi * cosTheta,
    ]
    const view = M4.lookAt(eye, cam.target, [0, 1, 0])

    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.uniforms.proj, false, proj)
    gl.uniformMatrix4fv(this.uniforms.view, false, view)
    for (const primitive of this.scene.primitives) {
      this.drawPrimitive(primitive)
    }
  }

  /**
   * @param primitive The primitive to draw
   */
  private drawPrimitive(primitive: Primitive) {
    const gl = this.gl
    const { attribs, material } = primitive

    // Bind the attributes that exist; supply constants for the rest.
    this.bindAttribute(this.attributes.position, attribs.position, null)
    this.bindAttribute(this.attributes.uv, attribs.uv, [0, 0, 0, 0])
    this.bindAttribute(this.attributes.color, attribs.color, [1, 1, 1, 1])
    this.bindAttribute(this.attributes.normal, attribs.normal, [0, 0, 1, 0])

    gl.uniform4fv(this.uniforms.baseColor, material.baseColor)
    gl.uniform1i(this.uniforms.hasColor, attribs.color ? 1 : 0)
    gl.uniform1i(this.uniforms.lit, attribs.normal && !attribs.color ? 1 : 0)

    if (material.texture) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, material.texture)
      gl.uniform1i(this.uniforms.tex, 0)
      gl.uniform1i(this.uniforms.hasTex, 1)
    } else {
      gl.uniform1i(this.uniforms.hasTex, 0)
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.index.buffer)
    gl.drawElements(
      primitive.mode,
      primitive.index.count,
      primitive.index.type,
      primitive.index.offset,
    )
  }

  /**
   * @param location Attribute location, negative if the shader optimised it out
   * @param attribute The buffer to bind, or null if the primitive lacks it
   * @param constant Value to use for every vertex when the attribute is absent
   */
  private bindAttribute(
    location: number,
    attribute: Attribute | null,
    constant: [number, number, number, number] | null,
  ) {
    const gl = this.gl
    if (location < 0) {
      return
    }
    if (attribute) {
      gl.enableVertexAttribArray(location)
      gl.bindBuffer(gl.ARRAY_BUFFER, attribute.buffer)
      gl.vertexAttribPointer(
        location,
        attribute.size,
        attribute.type,
        attribute.normalized,
        attribute.stride,
        attribute.offset,
      )
      return
    }
    gl.disableVertexAttribArray(location)
    if (constant) {
      gl.vertexAttrib4f(location, ...constant)
    }
  }

  /* ── Camera ──────────────────────────────────────────────────────── */

  /**
   * Aim the camera at the centre of the model and pull back to the closest
   * distance that still shows all of it
   *
   * Fitting the eight corners of the bounding box rather than a bounding
   * sphere matters here: most GTA map pieces are wide and flat, and a sphere
   * around one is mostly empty space, which leaves the model looking far
   * smaller than the viewport it had to spare.
   *
   * @param bounds The model's bounding box
   * @param aspect Viewport width divided by height
   */
  private frameCamera(bounds: BoundingBox, aspect: number) {
    const { max, min } = bounds
    const center: Vec3 = [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
      (min[2] + max[2]) / 2,
    ]
    // Half the box diagonal. Only used for the zoom and clip limits, which
    // want a single number for "how big is this thing".
    const size = Math.max(
      0.001,
      0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]),
    )

    // The camera basis for the angle the model opens at, matching the eye
    // position frame() derives from theta and phi, and M4.lookAt's axes.
    const sinPhi = Math.sin(START_PHI)
    const toEye: Vec3 = [
      sinPhi * Math.sin(START_THETA),
      Math.cos(START_PHI),
      sinPhi * Math.cos(START_THETA),
    ]
    const right = normalise(cross([0, 1, 0], toEye))
    const up = cross(toEye, right)

    // u_proj fixes the vertical field of view, so the horizontal one falls
    // out of the aspect ratio. A corner sits inside the frustum when its
    // offset across the screen is within the cone at its own depth, which
    // rearranges to a minimum distance per corner and per axis.
    const tanVertical = Math.tan(FOV / 2)
    const tanHorizontal = tanVertical * aspect
    let distance = 0
    for (let corner = 0; corner < 8; corner++) {
      const offset: Vec3 = [
        (corner & 1 ? max[0] : min[0]) - center[0],
        (corner & 2 ? max[1] : min[1]) - center[1],
        (corner & 4 ? max[2] : min[2]) - center[2],
      ]
      const depth = dot(offset, toEye)
      distance = Math.max(
        distance,
        depth + Math.abs(dot(offset, right)) / tanHorizontal,
        depth + Math.abs(dot(offset, up)) / tanVertical,
      )
    }

    this.camera = {
      far: size * 200,
      maxRadius: size * 40,
      minRadius: size * 0.05,
      near: Math.max(size * 0.01, 0.01),
      phi: START_PHI,
      // The margin keeps the model off the very edge of the viewport.
      radius: Math.max(distance * FIT_MARGIN, size * 0.5),
      target: center,
      theta: START_THETA,
    }
  }

  /* ── Orbit / zoom / pan controls ─────────────────────────────────── */

  private readonly onMouseDown = (event: MouseEvent) => {
    this.drag = { button: event.button, x: event.clientX, y: event.clientY }
    event.preventDefault()
  }

  private readonly onMouseMove = (event: MouseEvent) => {
    if (!this.drag) {
      return
    }
    const dx = event.clientX - this.drag.x
    const dy = event.clientY - this.drag.y
    this.drag.x = event.clientX
    this.drag.y = event.clientY

    const cam = this.camera
    if (this.drag.button === 2 || event.shiftKey) {
      const scale = cam.radius * 0.0015
      cam.target[0] -= dx * Math.cos(cam.theta) * scale
      cam.target[2] -= -dx * Math.sin(cam.theta) * scale
      cam.target[1] += dy * scale
      return
    }
    cam.theta -= dx * 0.01
    cam.phi = Math.max(0.05, Math.min(Math.PI - 0.05, cam.phi - dy * 0.01))
  }

  private readonly onMouseUp = () => {
    this.drag = null
  }

  private readonly onContextMenu = (event: MouseEvent) => {
    event.preventDefault()
  }

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const cam = this.camera
    cam.radius = Math.max(
      cam.minRadius,
      Math.min(cam.maxRadius, cam.radius * Math.exp(event.deltaY * 0.001)),
    )
  }
}
