import { describe, expect, it } from 'vitest';
import { outfitRegularWidth } from '../../test-utils/app-font';
import { outfitAdvance, outfitWidening } from './outfit-metrics';

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
