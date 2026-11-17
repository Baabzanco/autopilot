import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * Extracts pixel width and height directly from PNG, JPEG, or WebP buffers.
 */
export function parseImageDimensionsFromBuffer(buf: Buffer): ImageDimensions | null {
  if (buf.length < 24) return null;

  // PNG signature: 89 50 4E 47 0D 0A 1A 0A, IHDR at offset 16..23
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
  }

  // JPEG signature: FF D8
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const segmentLen = buf.readUInt16BE(offset + 2);
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        if (width > 0 && height > 0) return { width, height };
      }
      if (segmentLen < 2) break;
      offset += 2 + segmentLen;
    }
  }

  // RIFF....WEBP
  if (
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP' &&
    buf.length >= 30
  ) {
    const chunkHeader = buf.toString('ascii', 12, 16);
    if (chunkHeader === 'VP8 ' && buf.length >= 30) {
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
    }
    if (chunkHeader === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      if (width > 0 && height > 0) return { width, height };
    }
    if (chunkHeader === 'VP8X' && buf.length >= 30) {
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      if (width > 0 && height > 0) return { width, height };
    }
  }

  return null;
}

export async function detectImageDimensions(buf: Buffer, extHint = 'png'): Promise<ImageDimensions> {
  const fast = parseImageDimensionsFromBuffer(buf);
  if (fast) return fast;

  const tmpFile = path.join(os.tmpdir(), `img-dim-${Date.now()}-${Math.random().toString(36).slice(2)}.${extHint}`);
  try {
    fs.writeFileSync(tmpFile, buf);
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=s=x:p=0',
      tmpFile,
    ]);
    const [wRaw, hRaw] = stdout.trim().split('x');
    const width = Number(wRaw);
    const height = Number(hRaw);
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return { width, height };
    }
  } catch {
    // fallback if ffprobe cannot parse
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }

  return { width: 1024, height: 1024 };
}
