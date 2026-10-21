/**
 * Outfit Regular's widths, for a line the app cuts itself (`middleCut`): each printable ASCII
 * character's advance, the no-break space's and the "…"'s, in thousandths of an em, and the
 * kerning pairs among them that widen a pair. The pairs that tighten one, and the font's ligatures,
 * each narrower than its letters, are left out, so a width worked out from these is never less
 * than the one Android draws (#770). From Outfit_400Regular.ttf; a test checks them against it.
 */
const asciiAdvances = [
  208, 261, 400, 640, 588, 660, 659, 237, 303, 302, 490, 542, 275, 461, 290, 390, 656, 347, 541,
  538, 598, 541, 564, 525, 550, 564, 271, 269, 542, 542, 542, 505, 750, 696, 623, 688, 740, 590,
  566, 773, 706, 258, 495, 666, 552, 839, 710, 794, 606, 817, 630, 555, 625, 683, 688, 981, 691,
  665, 583, 338, 390, 338, 453, 505, 281, 582, 582, 489, 582, 536, 399, 579, 548, 224, 230, 498,
  222, 855, 548, 566, 582, 583, 419, 427, 368, 516, 511, 750, 504, 514, 447, 323, 278, 323, 542,
];
const otherAdvances: Record<string, number> = { '\u00a0': 208, '…': 750 };
const wideningPairs: Record<string, number> = {
  '"7': 23,
  '"T': 25,
  '"f': 8,
  '"t': 8,
  "'7": 23,
  "'T": 25,
  "'f": 8,
  "'t": 8,
  '(j': 98,
  ',j': 36,
  '-@': 16,
  '-C': 13,
  '-G': 13,
  '-O': 13,
  '-Q': 13,
  '-a': 16,
  '-c': 16,
  '-d': 16,
  '-e': 16,
  '-g': 16,
  '-o': 16,
  '-q': 16,
  '.j': 36,
  '/B': 14,
  '/D': 14,
  '/E': 14,
  '/F': 14,
  '/H': 14,
  '/I': 14,
  '/K': 14,
  '/L': 14,
  '/M': 14,
  '/N': 14,
  '/P': 14,
  '/R': 14,
  '/|': 14,
  '7"': 23,
  "7'": 23,
  '@-': 16,
  'C}': 23,
  'E)': 25,
  'E]': 26,
  'E}': 26,
  'F)': 28,
  'F]': 26,
  'F}': 26,
  GC: 6,
  GG: 6,
  GO: 6,
  GQ: 6,
  'G}': 11,
  'H/': 14,
  'I/': 14,
  'M/': 14,
  'N/': 14,
  'O-': 13,
  OC: 6,
  OG: 6,
  OO: 6,
  OQ: 6,
  Oj: 24,
  'Q/': 17,
  'Q}': 18,
  'S-': 12,
  SC: 3,
  SG: 3,
  SO: 3,
  SQ: 3,
  SU: 12,
  'T"': 25,
  "T'": 25,
  'T?': 10,
  'V?': 6,
  'W?': 6,
  'Z?': 6,
  '[j': 82,
  'b-': 16,
  'e-': 16,
  'f"': 63,
  "f'": 63,
  'f)': 56,
  'f*': 18,
  'f?': 44,
  'f]': 56,
  fb: 24,
  fh: 24,
  fk: 24,
  fl: 24,
  'f}': 54,
  gj: 52,
  jj: 63,
  'o-': 16,
  'p-': 16,
  qj: 82,
  'z/': 18,
  '{j': 98,
  '|/': 14,
};

/** A character's advance in Outfit Regular, in ems; undefined when it isn't known here. */
export function outfitAdvance(character: string): number | undefined {
  const code = character.codePointAt(0)!;
  const advance =
    code >= 0x20 && code <= 0x7e ? asciiAdvances[code - 0x20] : otherAdvances[character];
  return advance === undefined ? undefined : advance / 1000;
}

/** How much Outfit Regular's kerning widens a pair of characters, in ems. */
export const outfitWidening = (pair: string) => (wideningPairs[pair] ?? 0) / 1000;

/**
 * Each character's width in `text`, in ems, with the kerning that widens it after the one before
 * it: a run's width is the sum of its characters', never less than Android draws it. Null when a
 * character's width isn't known here, as for anything outside ASCII.
 */
export function outfitSteps(text: string): number[] | null {
  const characters = [...text];
  const steps: number[] = [];
  for (const [index, character] of characters.entries()) {
    const advance = outfitAdvance(character);
    if (advance === undefined) return null;
    steps.push(advance + (index ? outfitWidening(characters[index - 1]! + character) : 0));
  }
  return steps;
}

/** How wide `text` is in Outfit Regular, in ems (`outfitSteps`); null when it isn't known here. */
export const outfitWidth = (text: string) =>
  outfitSteps(text)?.reduce((width, step) => width + step, 0) ?? null;
