import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fonts } from '../ui/theme';

/**
 * The characters a TrueType font draws itself: those its `cmap` maps to a glyph (format 4, the
 * only one Outfit has). Android draws any other character from a fallback font, wider than the
 * app font measured it, so a line can draw past where it was laid out (#766).
 */
function drawnCharacters(file: string): Set<number> {
  const font = readFileSync(file);
  let cmap = -1;
  for (let table = 0; table < font.readUInt16BE(4); table++) {
    const record = 12 + table * 16;
    if (font.toString('ascii', record, record + 4) === 'cmap') cmap = font.readUInt32BE(record + 8);
  }
  const drawn = new Set<number>();
  for (let index = 0; index < font.readUInt16BE(cmap + 2); index++) {
    const at = cmap + font.readUInt32BE(cmap + 4 + index * 8 + 4);
    const format = font.readUInt16BE(at);
    if (format === 4) {
      const width = font.readUInt16BE(at + 6);
      const ends = at + 14;
      const starts = ends + width + 2;
      const deltas = starts + width;
      const ranges = deltas + width;
      for (let segment = 0; segment < width / 2; segment++) {
        const start = font.readUInt16BE(starts + segment * 2);
        const end = font.readUInt16BE(ends + segment * 2);
        const delta = font.readInt16BE(deltas + segment * 2);
        const range = font.readUInt16BE(ranges + segment * 2);
        for (let code = start; code <= end && code !== 0xffff; code++) {
          let glyph = (code + delta) & 0xffff;
          if (range) {
            glyph = font.readUInt16BE(ranges + segment * 2 + range + (code - start) * 2);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) drawn.add(code);
        }
      }
    }
  }
  return drawn;
}

const require = createRequire(import.meta.url);
/** The app's text font in each weight it loads (`fonts`). */
const outfit = Object.values(fonts)
  .filter((family) => family.startsWith('Outfit_'))
  .map((family) =>
    drawnCharacters(
      require.resolve(`@expo-google-fonts/outfit/${family.replace('Outfit_', '')}/${family}.ttf`),
    ),
  );

/** The characters of `text` that some weight of the app's text font doesn't draw itself. */
export const missingFromAppFont = (text: string) =>
  [...new Set(text)]
    .filter((character) => outfit.some((drawn) => !drawn.has(character.codePointAt(0)!)))
    .map(
      (character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
    );
