import { describe, expect, it } from 'vitest';
import { outfitRegularWidth, outfitSemiboldAdvance } from '../../test-utils/app-font';
import {
  outfitAdvance,
  outfitSemiboldAdvance as semiboldAdvance,
  outfitWidening,
} from './outfit-metrics';

// #770: the widths the app cuts a line by are Outfit Regular's own, read from the font file.
describe('Outfit Regular’s widths for a line the app cuts (#770)', () => {
  const characters = [
    ...Array.from({ length: 0x7f - 0x20 }, (_, index) => String.fromCharCode(0x20 + index)),
    '\u00a0',
    '…',
  ];
  const thousandths = (ems: number) => Math.round(ems * 1000);

  it('has each character’s advance', () => {
    for (const character of characters)
      expect(outfitAdvance(character), character).toBe(outfitRegularWidth(character));
  });

  it('has every kerning pair that widens a pair, and none that tightens one', () => {
    for (const first of characters)
      for (const second of characters) {
        const kerning = thousandths(
          outfitRegularWidth(first + second) -
            outfitRegularWidth(first) -
            outfitRegularWidth(second),
        );
        expect(thousandths(outfitWidening(first + second)), first + second).toBe(
          Math.max(0, kerning),
        );
      }
  });
});

// #921: a sheet's title keeps room for its widest word, measured in Outfit SemiBold's own widths.
describe('Outfit SemiBold’s advances for a title’s widest word (#921)', () => {
  it('has each printable ASCII character’s advance', () => {
    for (let code = 0x20; code < 0x7f; code++) {
      const character = String.fromCharCode(code);
      expect(semiboldAdvance(character), character).toBe(outfitSemiboldAdvance(character));
    }
  });
});
