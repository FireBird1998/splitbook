import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fonts } from '../ui/theme';

/** Where each of a TrueType font's tables starts, by its tag. */
function tablesOf(font: Buffer) {
  const tables = new Map<string, number>();
  for (let table = 0; table < font.readUInt16BE(4); table++) {
    const record = 12 + table * 16;
    tables.set(font.toString('ascii', record, record + 4), font.readUInt32BE(record + 8));
  }
  return tables;
}

/**
 * The glyph a TrueType font draws for each character it draws itself: what its `cmap` maps the
 * character to (format 4, the only one Outfit has). Android draws any other character from a
 * fallback font, wider than the app font measured it, so a line can draw past where it was laid
 * out (#766).
 */
function glyphsOf(font: Buffer) {
  const cmap = tablesOf(font).get('cmap')!;
  const glyphs = new Map<number, number>();
  for (let index = 0; index < font.readUInt16BE(cmap + 2); index++) {
    const at = cmap + font.readUInt32BE(cmap + 4 + index * 8 + 4);
    if (font.readUInt16BE(at) !== 4) continue;
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
        if (glyph && !glyphs.has(code)) glyphs.set(code, glyph);
      }
    }
  }
  return glyphs;
}

const require = createRequire(import.meta.url);
const fontFile = (family: string) =>
  readFileSync(
    require.resolve(`@expo-google-fonts/outfit/${family.replace('Outfit_', '')}/${family}.ttf`),
  );
/** The app's text font in each weight it loads (`fonts`). */
const outfit = Object.values(fonts)
  .filter((family) => family.startsWith('Outfit_'))
  .map((family) => glyphsOf(fontFile(family)));

/** The characters of `text` that some weight of the app's text font doesn't draw itself. */
export const missingFromAppFont = (text: string) =>
  [...new Set(text)]
    .filter((character) => outfit.some((glyphs) => !glyphs.has(character.codePointAt(0)!)))
    .map(
      (character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
    );

/** The glyphs an OpenType coverage table lists, each with its index in the table. */
function coverageOf(font: Buffer, at: number) {
  const covered = new Map<number, number>();
  const count = font.readUInt16BE(at + 2);
  for (let index = 0; index < count; index++) {
    if (font.readUInt16BE(at) === 1) covered.set(font.readUInt16BE(at + 4 + index * 2), index);
    else {
      const range = at + 4 + index * 6;
      const first = font.readUInt16BE(range);
      for (let glyph = first; glyph <= font.readUInt16BE(range + 2); glyph++)
        covered.set(glyph, font.readUInt16BE(range + 4) + glyph - first);
    }
  }
  return covered;
}

/** The class an OpenType class definition gives each glyph it names; others are class 0. */
function classesOf(font: Buffer, at: number) {
  const classes = new Map<number, number>();
  if (font.readUInt16BE(at) === 1) {
    const first = font.readUInt16BE(at + 2);
    for (let index = 0; index < font.readUInt16BE(at + 4); index++)
      classes.set(first + index, font.readUInt16BE(at + 6 + index * 2));
  } else
    for (let index = 0; index < font.readUInt16BE(at + 2); index++) {
      const range = at + 4 + index * 6;
      for (let glyph = font.readUInt16BE(range); glyph <= font.readUInt16BE(range + 2); glyph++)
        classes.set(glyph, font.readUInt16BE(range + 4));
    }
  return classes;
}

/** The bytes a GPOS value record of this format takes. */
const valueSize = (format: number) =>
  2 * [...format.toString(2)].filter((bit) => bit === '1').length;
/** A GPOS value record's horizontal advance adjustment: 0 unless its format has one. */
const xAdvance = (font: Buffer, at: number, format: number) =>
  format & 4 ? font.readInt16BE(at + (format & 1 ? 2 : 0) + (format & 2 ? 2 : 0)) : 0;

/** The kerning Outfit Regular puts between a pair of glyphs: its `kern` pair adjustments. */
function kerningOf(font: Buffer) {
  const gpos = tablesOf(font).get('GPOS')!;
  const features = gpos + font.readUInt16BE(gpos + 6);
  const lookups = gpos + font.readUInt16BE(gpos + 8);
  const pairs: ((first: number, second: number) => number | undefined)[] = [];
  for (let feature = 0; feature < font.readUInt16BE(features); feature++) {
    const record = features + 2 + feature * 6;
    if (font.toString('ascii', record, record + 4) !== 'kern') continue;
    const table = features + font.readUInt16BE(record + 4);
    for (let index = 0; index < font.readUInt16BE(table + 2); index++) {
      const lookup =
        lookups + font.readUInt16BE(lookups + 2 + font.readUInt16BE(table + 4 + index * 2) * 2);
      for (let part = 0; part < font.readUInt16BE(lookup + 4); part++) {
        let at = lookup + font.readUInt16BE(lookup + 6 + part * 2);
        // An extension subtable points on to the pair adjustment it holds.
        if (font.readUInt16BE(lookup) === 9) at += font.readUInt32BE(at + 4);
        const covered = coverageOf(font, at + font.readUInt16BE(at + 2));
        const [firstFormat, secondFormat] = [font.readUInt16BE(at + 4), font.readUInt16BE(at + 6)];
        const record = valueSize(firstFormat) + valueSize(secondFormat);
        if (font.readUInt16BE(at) === 1)
          pairs.push((first, second) => {
            const index = covered.get(first);
            if (index === undefined) return undefined;
            const set = at + font.readUInt16BE(at + 10 + index * 2);
            for (let pair = 0; pair < font.readUInt16BE(set); pair++) {
              const entry = set + 2 + pair * (2 + record);
              if (font.readUInt16BE(entry) === second)
                return xAdvance(font, entry + 2, firstFormat);
            }
            return undefined;
          });
        else {
          const firsts = classesOf(font, at + font.readUInt16BE(at + 8));
          const seconds = classesOf(font, at + font.readUInt16BE(at + 10));
          const columns = font.readUInt16BE(at + 14);
          pairs.push((first, second) => {
            if (!covered.has(first)) return undefined;
            const cell = (firsts.get(first) ?? 0) * columns + (seconds.get(second) ?? 0);
            return xAdvance(font, at + 16 + cell * record, firstFormat) || undefined;
          });
        }
      }
    }
  }
  return (first: number, second: number) => {
    for (const pair of pairs) {
      const kerning = pair(first, second);
      if (kerning !== undefined) return kerning;
    }
    return 0;
  };
}

const regular = fontFile(fonts.regular);
const regularGlyphs = glyphsOf(regular);
const regularKerning = kerningOf(regular);
const regularTables = tablesOf(regular);
const unitsPerEm = regular.readUInt16BE(regularTables.get('head')! + 18);
const longMetrics = regular.readUInt16BE(regularTables.get('hhea')! + 34);
/** Outfit Regular's advance width for a glyph, in its units (`unitsPerEm`). */
const regularAdvance = (glyph: number) =>
  regular.readUInt16BE(regularTables.get('hmtx')! + Math.min(glyph, longMetrics - 1) * 4);

/**
 * How wide `text` is in Outfit Regular, the caption face, in ems, read from the font itself: each
 * character's advance and the font's kerning between each pair, tightening or widening, as
 * Android lays it out. Its ligatures are left out; each is narrower than its letters (#770).
 */
export function outfitRegularWidth(text: string) {
  const glyphs = [...text].map((character) => regularGlyphs.get(character.codePointAt(0)!) ?? 0);
  return (
    glyphs.reduce(
      (width, glyph, index) =>
        width + regularAdvance(glyph) + (index ? regularKerning(glyphs[index - 1]!, glyph) : 0),
      0,
    ) / unitsPerEm
  );
}
