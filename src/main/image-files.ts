import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import { MAX_FILE_BYTES, validateDimensions, type OpenImage } from '../shared/image'
import { MAX_EXPORT_BYTES, type OutputOptions } from '../shared/output'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

export function inspectImage(bytes: Uint8Array, maximumBytes = MAX_FILE_BYTES): OpenImage['mime'] {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new Error(`Use an image within the ${maximumBytes / 1024 / 1024} MiB size limit.`)
  }
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (data.length < 33 || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') {
      throw new Error('This PNG is damaged. Try another image.')
    }
    validateDimensions(data.readUInt32BE(16), data.readUInt32BE(20))
    return 'image/png'
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2
    while (offset < data.length) {
      if (data[offset] !== 0xff) break
      while (data[offset] === 0xff) offset += 1
      const marker = data[offset]
      offset += 1
      if (marker === undefined || marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (offset + 2 > data.length) break
      const length = data.readUInt16BE(offset)
      if (length < 2 || offset + length > data.length) break
      if (JPEG_FRAME_MARKERS.has(marker)) {
        if (length < 8) break
        validateDimensions(data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3))
        return 'image/jpeg'
      }
      offset += length
    }
    throw new Error('This JPEG is damaged. Try another image.')
  }
  throw new Error('Choose a PNG or JPEG image. Other formats are not supported yet.')
}

export async function readImage(path: string): Promise<OpenImage> {
  const file = await open(path, 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_FILE_BYTES) {
      throw new Error('Choose an image file smaller than 64 MiB.')
    }
    const bytes = new Uint8Array(stat.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
      if (bytesRead === 0) throw new Error('The image changed while opening. Try again.')
      offset += bytesRead
    }
    const afterRead = await file.stat()
    if (afterRead.size !== stat.size || afterRead.mtimeMs !== stat.mtimeMs) {
      throw new Error('The image changed while opening. Try again.')
    }
    return { name: basename(path), mime: inspectImage(bytes), bytes }
  } finally {
    await file.close()
  }
}

export async function writeImageExclusive(path: string, bytes: Uint8Array, format: OutputOptions['format']): Promise<void> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_EXPORT_BYTES) throw new Error('Use an output within the 128 MiB size limit.')
  if (format === 'webp') {
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (data.length < 20 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WEBP' || data.readUInt32LE(4) + 8 !== data.length) {
      throw new Error('Export requires a complete WebP image.')
    }
  } else if (inspectImage(bytes, MAX_EXPORT_BYTES) !== (format === 'png' ? 'image/png' : 'image/jpeg')) {
    throw new Error(`Export requires a ${format === 'png' ? 'PNG' : 'JPEG'} image.`)
  }
  let file
  try {
    file = await open(path, 'wx')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new Error('That file already exists. Choose a new name to keep the original safe.')
    }
    throw error
  }
  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
}
