/**
 * Derive boarding-pass style route codes from a trip name.
 * Deterministic and pure so the TripStrip signature is stable per trip.
 *
 * Examples:
 *   "Goa Friends Trip" → { from: "GOA", to: "TRI" }
 *   "SF Layover"       → { from: "SFL", to: "LAY" }
 *   "Weekend"          → { from: "WEE", to: "END" }
 *   "Home"             → { from: "HOM", to: "TRP" }
 */
export function deriveTripCodes(name: string): { from: string; to: string } {
  const words = name
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
