import type { Vec3 } from "./M4"

/* ── glTF 2.0 ────────────────────────────────────────────────────────────
   Only the slice of the schema that gta_to_gltf.py emits and the renderer
   reads. Anything optional in the spec is optional here too, because a
   hand-written exporter is exactly the kind of thing that omits fields.     */

export interface GlTFBuffer {
  byteLength: number
  uri?: string
}

export interface GlTFBufferView {
  buffer: number
  byteLength: number
  byteOffset?: number
  byteStride?: number
  target?: number
}

export interface GlTFAccessor {
  bufferView?: number
  byteOffset?: number
  componentType: number
  count: number
  max?: number[]
  min?: number[]
  normalized?: boolean
  type: string
}

export interface GlTFImage {
  mimeType?: string
  uri?: string
}

export interface GlTFTexture {
  sampler?: number
  source?: number
}

export interface GlTFTextureRef {
  index: number
  texCoord?: number
}

export interface GlTFPbrMetallicRoughness {
  baseColorFactor?: number[]
  baseColorTexture?: GlTFTextureRef
  metallicFactor?: number
  roughnessFactor?: number
}

export interface GlTFMaterial {
  doubleSided?: boolean
  name?: string
  pbrMetallicRoughness?: GlTFPbrMetallicRoughness
}

export interface GlTFPrimitive {
  attributes: Record<string, number | undefined>
  indices?: number
  material?: number
  mode?: number
}

export interface GlTFMesh {
  name?: string
  primitives: GlTFPrimitive[]
}

export interface GlTFNode {
  children?: number[]
  mesh?: number
  name?: string
}

export interface GlTFScene {
  nodes?: number[]
}

export interface GlTF {
  accessors?: GlTFAccessor[]
  bufferViews?: GlTFBufferView[]
  buffers?: GlTFBuffer[]
  images?: GlTFImage[]
  materials?: GlTFMaterial[]
  meshes?: GlTFMesh[]
  nodes?: GlTFNode[]
  scene?: number
  scenes?: GlTFScene[]
  textures?: GlTFTexture[]
}

/* ── Renderer internals ────────────────────────────────────────────────── */

/** A vertex attribute resolved down to the arguments vertexAttribPointer wants. */
export interface Attribute {
  buffer: WebGLBuffer
  normalized: boolean
  offset: number
  size: number
  stride: number
  type: number
}

export interface PrimitiveAttributes {
  color: Attribute | null
  normal: Attribute | null
  position: Attribute
  uv: Attribute | null
}

export interface PrimitiveIndex {
  buffer: WebGLBuffer
  count: number
  offset: number
  type: number
}

export interface PrimitiveMaterial {
  baseColor: number[]
  texture: WebGLTexture | null
}

export interface Primitive {
  attribs: PrimitiveAttributes
  index: PrimitiveIndex
  material: PrimitiveMaterial
  mode: number
}

/** Everything a loaded model owns on the GPU, so it can all be released together. */
export interface Scene {
  buffers: WebGLBuffer[]
  primitives: Primitive[]
  textures: WebGLTexture[]
}

/** What the camera is framed against when a model finishes loading. */
export interface BoundingBox {
  max: Vec3
  min: Vec3
}

export interface Camera {
  far: number
  maxRadius: number
  minRadius: number
  near: number
  phi: number
  radius: number
  target: Vec3
  theta: number
}

export interface AttributeLocations {
  color: number
  normal: number
  position: number
  uv: number
}

export interface UniformLocations {
  baseColor: WebGLUniformLocation | null
  hasColor: WebGLUniformLocation | null
  hasTex: WebGLUniformLocation | null
  lit: WebGLUniformLocation | null
  prelitStrength: WebGLUniformLocation | null
  proj: WebGLUniformLocation | null
  tex: WebGLUniformLocation | null
  view: WebGLUniformLocation | null
}

export interface Drag {
  button: number
  x: number
  y: number
}
