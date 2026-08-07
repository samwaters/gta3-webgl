import type { GlTF, GlTFNode } from "./renderer.types"

/**
 * Resolve a glTF-relative uri against the directory its glTF lives in, and
 * flatten it to the slash-separated path OPFS stores it under
 * @param baseDir Directory of the glTF, "" for the OPFS root
 * @param uri The uri as written in the glTF, percent-encoded per the spec
 */
export const resolvePath = (baseDir: string, uri: string): string => {
  const segments: string[] = []
  for (const segment of `${baseDir}${decodeURIComponent(uri)}`.split("/")) {
    if (segment === "" || segment === ".") {
      continue
    }
    if (segment === "..") {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join("/")
}

/**
 * Walk a glTF's scene graph. The extracted models are a single flat node per
 * mesh, but the traversal costs nothing and keeps the loader honest for any
 * exporter that nests.
 * @param gltf The parsed glTF
 */
export function* iterSceneNodes(gltf: GlTF): Generator<GlTFNode> {
  const nodes = gltf.nodes ?? []
  const scene = gltf.scenes?.[gltf.scene ?? 0]
  const stack = [...(scene?.nodes ?? nodes.map((_, index) => index))]
  while (stack.length) {
    const node = nodes[stack.pop()!]
    if (!node) {
      continue
    }
    yield node
    if (node.children) {
      stack.push(...node.children)
    }
  }
}

/**
 * Decode PNG bytes into something texImage2D accepts. Missing or corrupt
 * images resolve to null so the model still draws with its base colour.
 * @param bytes The file contents, or null if OPFS had no such file
 */
export const decodeImage = async (
  bytes: Uint8Array<ArrayBuffer> | null,
): Promise<ImageBitmap | null> => {
  if (!bytes) {
    return null
  }
  try {
    return await createImageBitmap(new Blob([bytes]))
  } catch {
    return null
  }
}
