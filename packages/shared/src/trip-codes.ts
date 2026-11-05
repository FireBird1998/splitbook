/** Letters with no accent to strip, as the plain letters they are written with (#885). */
const PLAIN: Record<string, string> = {
  ł: 'l',
  Ł: 'L',
  ø: 'o',
  Ø: 'O',
  æ: 'ae',
  Æ: 'AE',
  œ: 'oe',
  Œ: 'OE',
  ß: 'ss',
  ẞ: 'SS',
  đ: 'd',
  Đ: 'D',
  ð: 'd',
  Ð: 'D',
  þ: 'th',
  Þ: 'TH',
};

/**
 * Derive boarding-pass style route codes from a trip name.
 * Deterministic and pure so the TripStrip signature is stable per trip.
 *
 * Examples:
 *   "Goa Friends Trip" → { from: "GOA", to: "TRI" }
 *   "SF Layover"       → { from: "SFL", to: "LAY" }
 *   "Weekend"          → { from: "WEE", to: "END" }
 *   "Home"             → { from: "HOM", to: "TRP" }
 *   "Kraków"           → { from: "KRA", to: "KOW" }
 *   "Wrocław"          → { from: "WRO", to: "LAW" }
 */
export function deriveTripCodes(name: string): { from: string; to: string } {
  const words = name
    .replace(/[łŁøØæÆœŒßẞđĐðÐþÞ]/g, (letter) => PLAIN[letter])
    // An accented letter reads as its plain letter (#885): "Kraków" is KRA, not KRAK and W.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return { from: 'TRP', to: 'TRP' };

  const stream = words.join('');
  const from = stream.slice(0, 3).padEnd(3, 'X');

  if (words.length === 1) {
    const word = words[0];
    const to = word.length >= 6 ? word.slice(-3) : 'TRP';
    return { from, to };
  }

  const lastWord = words[words.length - 1];
  const to = lastWord.slice(0, 3).padEnd(3, 'X');
  return { from, to };
}
