export type Vec3 = [number, number, number]

/**
 * The two column-major 4x4 matrices the renderer needs. Everything else the
 * shader would normally want (model, normal) is identity here, because the
 * extracted glTFs bake their transforms into the vertex data.
 */
export class M4 {
  /**
   * Build a perspective projection matrix
   * @param fovy Vertical field of view, in radians
   * @param aspect Viewport width divided by height
   * @param near Near clip plane distance
   * @param far Far clip plane distance
   */
  public static perspective(
    fovy: number,
    aspect: number,
    near: number,
    far: number,
  ): Float32Array {
    const f = 1 / Math.tan(fovy / 2)
    const nf = 1 / (near - far)
    // prettier-ignore
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0,
    ])
  }

  /**
   * Build a view matrix looking from eye toward center
   * @param eye Camera position in world space
   * @param center The point the camera is aimed at
   * @param up World up, used to derive the camera's right axis
   */
  public static lookAt(eye: Vec3, center: Vec3, up: Vec3): Float32Array {
    const [ex, ey, ez] = eye
    const [cx, cy, cz] = center
    const [ux, uy, uz] = up

    let zx = ex - cx
    let zy = ey - cy
    let zz = ez - cz
    // A zero-length axis means eye and center coincide. Falling back to 1
    // leaves the axis as-is rather than producing NaNs across the matrix.
    const zl = Math.hypot(zx, zy, zz) || 1
    zx /= zl
    zy /= zl
    zz /= zl

    let xx = uy * zz - uz * zy
    let xy = uz * zx - ux * zz
    let xz = ux * zy - uy * zx
    const xl = Math.hypot(xx, xy, xz) || 1
    xx /= xl
    xy /= xl
    xz /= xl

    const yx = zy * xz - zz * xy
    const yy = zz * xx - zx * xz
    const yz = zx * xy - zy * xx

    // prettier-ignore
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * ex + xy * ey + xz * ez),
      -(yx * ex + yy * ey + yz * ez),
      -(zx * ex + zy * ey + zz * ez), 1,
    ])
  }
}
