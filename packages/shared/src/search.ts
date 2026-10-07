/**
 * Search across the member's Groups (#321): how a query is read, what it matches and how many
 * results each section holds. The search read matches with these rules and the web's dialog
 * highlights with them, so both agree on what a match is.
 *
 * A query matches by word prefix: each of its words must start a word of the text, ignoring
 * case. "din" finds "Dinner — Kerala sadya" and "kerala din" finds it too, but "ner" does
 * not, so a short query never surfaces every word that merely contains it. A word starts at
 * the start of the text or after anything that is not a letter, combining mark, digit or
 * apostrophe (so "s" never starts a word inside "Cook’s"), in any script.
 */
import { escapeRegex } from './escape-regex';

/** The longest query the search read takes, in UTF-16 code units, after normalizing. */
export const SEARCH_QUERY_MAX_LENGTH = 100;

/** The most results each section of the search read returns. */
export const SEARCH_LIMITS = { groups: 5, people: 5, expenses: 8 } as const;

/** The query as it is searched: trimmed, with each run of whitespace read as one space. */
export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** The query's words. Each must start a word of the text; a repeated word counts once. */
export function searchTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of normalizeSearchQuery(query).split(' ')) {
    const key = term.toLowerCase();
    if (term === '' || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

/** What continues a word: a letter, a combining mark (as in Devanagari), a digit or an apostrophe. */
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}'’]/u;

/**
 * A MongoDB `$regex` source, used with the `i` option, matching `term` where it starts a word.
 * MongoDB's PCRE2 reads `\p{…}` and lookbehind, and folds case beyond ASCII in UTF mode.
 */
export function wordStartPattern(term: string): string {
  return `(?<![\\p{L}\\p{M}\\p{N}'’])${escapeRegex(term)}`;
}

/** Where `term` starts a word of `text`, ignoring case, as [start, end) ranges. */
function wordStarts(text: string, term: string): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(new RegExp(escapeRegex(term), 'giu'))) {
    const start = match.index;
    // The code point before the match, a surrogate pair included.
    const before = Array.from(text.slice(Math.max(0, start - 2), start)).pop();
    if (before === undefined || !WORD_CHARACTER.test(before))
      ranges.push([start, start + match[0].length]);
  }
  return ranges;
}

/** Whether every term starts a word of `text`. A query without words matches nothing. */
export function matchesSearch(text: string, terms: readonly string[]): boolean {
  return terms.length > 0 && terms.every((term) => wordStarts(text, term).length > 0);
}

/**
 * Which results come first: 0 when the text starts with the whole query, ignoring case, and 1
 * when the query's words only start words further in. Ties keep their order.
 */
export function searchRank(text: string, query: string): 0 | 1 {
  return text.toLowerCase().startsWith(normalizeSearchQuery(query).toLowerCase()) ? 0 : 1;
}

export interface SearchTextPart {
  text: string;
  /** Whether a term matched this part. */
  match: boolean;
}

/** `text` in parts, with each word start a term matched marked, for highlighting. */
export function highlightSearch(text: string, terms: readonly string[]): SearchTextPart[] {
  const ranges = terms
    .flatMap((term) => wordStarts(text, term))
    .sort(([a], [b]) => a - b)
    .reduce<[number, number][]>((merged, range) => {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
      return merged;
    }, []);
  const parts: SearchTextPart[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push({ text: text.slice(at, start), match: false });
    parts.push({ text: text.slice(start, end), match: true });
    at = end;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts;
}
