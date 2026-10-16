// Just enough PNG to read a still's size and to keep a note of what it was drawn from.
import { crc32 } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The signature and the header chunk, which holds the width and height. */
const HEADER_END = 8 + 12 + 13;

export const isPng = (png: Buffer) =>
  png.length >= HEADER_END && png.subarray(0, 8).equals(SIGNATURE);

export const pngSize = (png: Buffer) => ({
  width: png.readUInt32BE(16),
  height: png.readUInt32BE(20),
});

/** The PNG's text chunks (tEXt), keyword → text. */
export function pngText(png: Buffer): Map<string, string> {
  const text = new Map<string, string>();
  for (let at = 8; at + 12 <= png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    if (type === 'IEND') break;
    if (type === 'tEXt') {
      const data = png.subarray(at + 8, at + 8 + length);
      const nul = data.indexOf(0);
      text.set(data.toString('latin1', 0, nul), data.toString('latin1', nul + 1));
    }
    at += 12 + length;
  }
  return text;
}

/** The PNG with a text chunk added straight after its header. */
export function withPngText(png: Buffer, keyword: string, value: string): Buffer {
  const data = Buffer.from(`${keyword}\0${value}`, 'latin1');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write('tEXt', 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return Buffer.concat([png.subarray(0, HEADER_END), chunk, png.subarray(HEADER_END)]);
}
