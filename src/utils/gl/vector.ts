import type { Vec3 } from "./M4"

/**
 * The vector perpendicular to both inputs
 * @param a Left operand
 * @param b Right operand
 */
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/**
 * The projection of one vector onto another, scaled by its length
 * @param a Left operand
 * @param b Right operand
 */
export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * Scale a vector to unit length. A zero-length input is returned unchanged
 * rather than as NaNs.
 * @param v The vector to normalise
 */
export const normalise = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}
