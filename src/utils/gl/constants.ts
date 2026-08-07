/** Vertical field of view, in radians. */
export const FOV = Math.PI / 4

/**
 * How much further back than the exact fit the camera starts, so a freshly
 * loaded model does not touch the edges of the viewport.
 */
export const FIT_MARGIN = 1.08

/** Ceiling on the device pixel ratio the drawing buffer is scaled by. */
export const MAX_PIXEL_RATIO = 2

/** How much baked vertex lighting to apply: 0 ignores it, 1 uses it raw. */
export const PRELIT_STRENGTH = 0.55

/** The three-quarter view every model opens at. */
export const START_PHI = 1.15
export const START_THETA = 0.9

/**
 * glTF componentType (a GL enum) to the size in bytes of one component.
 */
export const COMP_BYTES: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
}

/**
 * glTF accessor type to the number of components each element holds.
 */
export const TYPE_COMPONENTS: Record<string, number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16,
}
