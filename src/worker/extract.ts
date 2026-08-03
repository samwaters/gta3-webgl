import {
  WorkerMessageTypesEnum,
  type WorkerMessageTypes,
} from "./messagetypes.ts"

const BLOCK_SIZE = 512

// Field offsets within a 512-byte USTAR header block.
const FIELD_NAME = 0
const FIELD_SIZE = 124
const FIELD_CHECKSUM = 148
const FIELD_TYPE = 156
const FIELD_MAGIC = 257
const FIELD_PREFIX = 345

// Type flags we care about. Anything else (links, devices, FIFOs) is skipped.
const TYPE_FILE = "0"
const TYPE_FILE_OLD = "\0"
const TYPE_DIRECTORY = "5"
const TYPE_PAX_NEXT = "x" // extended header describing the following entry
const TYPE_PAX_GLOBAL = "g" // extended header describing the whole archive
const TYPE_GNU_LONG_NAME = "L" // name too long for the 100-byte field

const decoder = new TextDecoder()

interface TarHeader {
  name: string
  size: number
  type: string
}

/**
 * Read a NUL-padded text field out of a header block
 * @param bytes The whole archive
 * @param offset Absolute offset of the field
 * @param length Field width in bytes
 */
const readString = (
  bytes: Uint8Array,
  offset: number,
  length: number,
): string => {
  const field = bytes.subarray(offset, offset + length)
  const end = field.indexOf(0)
  return decoder.decode(end === -1 ? field : field.subarray(0, end))
}

/**
 * Read a numeric header field. Tar stores these as octal text, padded with
 * spaces or NULs rather than zeroes.
 * @param bytes The whole archive
 * @param offset Absolute offset of the field
 * @param length Field width in bytes
 */
const readOctal = (
  bytes: Uint8Array,
  offset: number,
  length: number,
): number => {
  const raw = readString(bytes, offset, length).trim()
  if (raw === "") {
    return 0
  }
  const value = parseInt(raw, 8)
  return Number.isNaN(value) ? 0 : value
}

/**
 * Round a file size up to the next 512-byte block boundary. Tar pads every
 * entry's data so the following header starts on a block.
 * @param size Unpadded size in bytes
 */
const padToBlock = (size: number): number =>
  Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE

/**
 * True if the block is entirely zeroes. Two of these in a row mark the end of
 * the archive, so a single one is enough to stop reading.
 * @param bytes The whole archive
 * @param offset Absolute offset of the block
 */
const isZeroBlock = (bytes: Uint8Array, offset: number): boolean => {
  for (let i = 0; i < BLOCK_SIZE; i++) {
    if (bytes[offset + i] !== 0) {
      return false
    }
  }
  return true
}

/**
 * Verify a header's own checksum. Catches a truncated or corrupted download
 * at the point of failure rather than as garbled output later.
 * @param bytes The whole archive
 * @param offset Absolute offset of the header block
 */
const isChecksumValid = (bytes: Uint8Array, offset: number): boolean => {
  const expected = readOctal(bytes, offset + FIELD_CHECKSUM, 8)
  let sum = 0
  for (let i = 0; i < BLOCK_SIZE; i++) {
    // The checksum field is treated as spaces while summing, otherwise it
    // would have to contain its own total.
    const inChecksumField = i >= FIELD_CHECKSUM && i < FIELD_CHECKSUM + 8
    sum += inChecksumField ? 0x20 : bytes[offset + i]
  }
  return sum === expected
}

/**
 * Parse one 512-byte header block
 * @param bytes The whole archive
 * @param offset Absolute offset of the header block
 */
const parseHeader = (bytes: Uint8Array, offset: number): TarHeader => {
  const name = readString(bytes, offset + FIELD_NAME, 100)
  const type = String.fromCharCode(bytes[offset + FIELD_TYPE])

  // The 155-byte prefix only exists in USTAR archives; older tars have
  // vendor junk in those bytes, so only trust it when the magic is present.
  const isUstar = readString(bytes, offset + FIELD_MAGIC, 5) === "ustar"
  const prefix = isUstar ? readString(bytes, offset + FIELD_PREFIX, 155) : ""

  return {
    name: prefix === "" ? name : `${prefix}/${name}`,
    size: readOctal(bytes, offset + FIELD_SIZE, 12),
    type: type === TYPE_FILE_OLD ? TYPE_FILE : type,
  }
}

/**
 * Parse the body of a pax extended header into its key/value records. Each
 * record is "<byteLength> <key>=<value>\n", where byteLength covers the whole
 * record including its own digits.
 * @param data The extended header's data blocks
 */
const parsePaxRecords = (data: Uint8Array): Map<string, string> => {
  const records = new Map<string, string>()
  let position = 0
  while (position < data.length) {
    let space = position
    while (space < data.length && data[space] !== 0x20) {
      space++
    }
    if (space >= data.length) {
      break
    }
    const length = parseInt(decoder.decode(data.subarray(position, space)), 10)
    if (!Number.isFinite(length) || length <= 0) {
      break
    }
    // Slice by byte length, not string length, so multi-byte values stay intact.
    const record = decoder.decode(
      data.subarray(space + 1, position + length - 1),
    )
    const separator = record.indexOf("=")
    if (separator !== -1) {
      records.set(record.slice(0, separator), record.slice(separator + 1))
    }
    position += length
  }
  return records
}

/**
 * Split an archive path into OPFS-safe segments, or null if it should be
 * skipped. Rejects traversal so a hostile archive cannot escape the root.
 * @param name The raw name from the tar header
 */
const toSegments = (name: string): string[] | null => {
  const segments = name
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
  if (segments.length === 0 || segments.includes("..")) {
    return null
  }
  return segments
}

/**
 * Resolve a chain of directory handles, creating them as needed. Handles are
 * cached because thousands of files share a few hundred directories, and each
 * miss is an async round trip.
 * @param root The OPFS root
 * @param segments Directory names, outermost first
 * @param cache Path string to directory handle
 */
const ensureDirectory = async (
  root: FileSystemDirectoryHandle,
  segments: string[],
  cache: Map<string, FileSystemDirectoryHandle>,
): Promise<FileSystemDirectoryHandle> => {
  let directory = root
  let path = ""
  for (const segment of segments) {
    path = path === "" ? segment : `${path}/${segment}`
    const cached = cache.get(path)
    if (cached) {
      directory = cached
      continue
    }
    directory = await directory.getDirectoryHandle(segment, { create: true })
    cache.set(path, directory)
  }
  return directory
}

/**
 * Write one file into OPFS, replacing whatever was there
 * @param directory The parent directory handle
 * @param name The file name
 * @param data The file contents, a view into the archive
 */
const writeFile = async (
  directory: FileSystemDirectoryHandle,
  name: string,
  data: Uint8Array,
): Promise<void> => {
  const handle = await directory.getFileHandle(name, { create: true })
  const accessHandle = await handle.createSyncAccessHandle()
  try {
    accessHandle.truncate(0)
    accessHandle.write(data, { at: 0 })
    accessHandle.flush()
  } finally {
    // Skipping this leaves the file locked for the rest of the session.
    accessHandle.close()
  }
}

/**
 * Read assets.tar out of OPFS and unpack every file back into OPFS, mirroring
 * the directory structure held in the archive
 * @param onProgress Called with percent complete, at most once per percent
 */
const unpack = async (
  onProgress: (percent: number) => void,
): Promise<number> => {
  const root = await navigator.storage.getDirectory()
  const archive = await root.getFileHandle("assets.tar")
  const file = await archive.getFile()
  const bytes = await file.bytes()

  const directories = new Map<string, FileSystemDirectoryHandle>()
  const globalPax = new Map<string, string>()
  let pendingPax: Map<string, string> | null = null
  let pendingName: string | null = null
  let extracted = 0
  let lastPercent = -1
  let offset = 0
  let sawEndOfArchive = false

  while (offset + BLOCK_SIZE <= bytes.length) {
    if (isZeroBlock(bytes, offset)) {
      sawEndOfArchive = true
      break
    }
    if (!isChecksumValid(bytes, offset)) {
      throw new Error(`Corrupt tar header at byte ${offset}`)
    }

    const header = parseHeader(bytes, offset)
    const dataOffset = offset + BLOCK_SIZE

    // Metadata-only records carry no file of their own; they annotate what
    // comes next, so consume them and move on.
    if (header.type === TYPE_PAX_NEXT || header.type === TYPE_PAX_GLOBAL) {
      const records = parsePaxRecords(
        bytes.subarray(dataOffset, dataOffset + header.size),
      )
      if (header.type === TYPE_PAX_NEXT) {
        pendingPax = records
      } else {
        for (const [key, value] of records) {
          globalPax.set(key, value)
        }
      }
      offset = dataOffset + padToBlock(header.size)
      continue
    }
    if (header.type === TYPE_GNU_LONG_NAME) {
      pendingName = readString(bytes, dataOffset, header.size)
      offset = dataOffset + padToBlock(header.size)
      continue
    }

    // A pax path/size overrides the header, which is how tar represents
    // names past 100 bytes and sizes past 8GB.
    const name =
      pendingPax?.get("path") ??
      pendingName ??
      globalPax.get("path") ??
      header.name
    const paxSize = pendingPax?.get("size")
    const size = paxSize === undefined ? header.size : Number(paxSize)
    pendingPax = null
    pendingName = null

    if (dataOffset + size > bytes.length) {
      throw new Error(`Truncated tar: ${name} runs past the end of the archive`)
    }

    const segments = toSegments(name)
    if (segments) {
      if (header.type === TYPE_DIRECTORY) {
        await ensureDirectory(root, segments, directories)
      } else if (header.type === TYPE_FILE) {
        const fileName = segments[segments.length - 1]
        const directory = await ensureDirectory(
          root,
          segments.slice(0, -1),
          directories,
        )
        // A subarray is a view, so this costs nothing on top of the
        // archive already in memory.
        await writeFile(
          directory,
          fileName,
          bytes.subarray(dataOffset, dataOffset + size),
        )
        extracted++
      }
    }

    offset = dataOffset + padToBlock(size)

    const percent = Math.floor((offset / bytes.length) * 100)
    if (percent !== lastPercent) {
      lastPercent = percent
      onProgress(percent)
    }
  }

  // Every entry is block-aligned, so a truncated archive can end exactly on
  // an entry boundary. The loop then just runs out of blocks and looks like
  // a clean finish, silently extracting only part of the tree. The trailing
  // zero blocks are the only proof the archive was complete.
  if (!sawEndOfArchive) {
    throw new Error("Truncated tar: no end-of-archive marker")
  }

  // The loop stops on the end-of-archive marker, so the trailing zero blocks
  // are never counted and the last percent reported is 99. Close the gap.
  if (lastPercent !== 100) {
    onProgress(100)
  }

  return extracted
}

/**
 * Unpack assets.tar into OPFS, reporting progress and completion back to the
 * main thread
 * @param workerData The worker's id and queue id
 */
export const extractArchive = async (workerData: {
  id: string
  queueId: string
}) => {
  const sendMessage = (payload: unknown, type: WorkerMessageTypes) => {
    postMessage({
      payload,
      type,
      queueId: workerData.queueId,
      workerId: workerData.id,
    })
  }

  try {
    await unpack((percent) =>
      sendMessage(percent, WorkerMessageTypesEnum.PROGRESS),
    )
    sendMessage(true, WorkerMessageTypesEnum.COMPLETE)
  } catch (e: unknown) {
    // The likeliest cause is a corrupt archive, so drop the half-written
    // output *and* assets.tar to force a clean re-download. Otherwise the
    // next boot can find gta3.json among the partial files and conclude
    // extraction already succeeded. remove() on the root clears OPFS in a
    // single call and leaves it usable, unlike walking removeEntry over
    // thousands of top-level entries.
    const root = await navigator.storage.getDirectory()
    await root.remove({ recursive: true }).catch(() => {})
    sendMessage(e, WorkerMessageTypesEnum.ERROR)
  }
}
