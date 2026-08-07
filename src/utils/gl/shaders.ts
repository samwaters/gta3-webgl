/**
 * GLSL ES 1.00 sources — valid under both WebGL1 and WebGL2 — plus the
 * compile/link plumbing the renderer needs to turn them into a program.
 */

export const VERT_SRC = `
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
}`

export const FRAG_SRC = `
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
}`

/**
 * Compile one shader stage, throwing with the driver's log on failure
 * @param gl The rendering context
 * @param type gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
 * @param source GLSL source text
 */
const compileShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader => {
  const shader = gl.createShader(type)
  if (!shader) {
    throw new Error("Shader create: context returned null")
  }
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Shader compile: ${log}`)
  }
  return shader
}

/**
 * Compile and link the vertex and fragment stages into a program
 * @param gl The rendering context
 * @param vert Vertex shader source
 * @param frag Fragment shader source
 */
export const createProgram = (
  gl: WebGLRenderingContext,
  vert: string,
  frag: string,
): WebGLProgram => {
  const program = gl.createProgram()
  if (!program) {
    throw new Error("Program create: context returned null")
  }
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vert)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, frag)
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  // The program keeps its own reference until it is deleted, so the shader
  // objects can go now rather than leaking one pair per loaded model.
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program)
    gl.deleteProgram(program)
    throw new Error(`Program link: ${log}`)
  }
  return program
}
