import { describe, expect, it } from 'vitest';
import {
  highlightSearch,
  matchesSearch,
  normalizeSearchQuery,
  searchRank,
  searchTerms,
  wordStartPattern,
} from './search';

describe('reading a query', () => {
  it('trims it and reads each run of whitespace as one space', () => {
    expect(normalizeSearchQuery('  Kerala \t  sadya \n')).toBe('Kerala sadya');
    expect(normalizeSearchQuery('   ')).toBe('');
  });

  it('splits it into words, each counted once whatever its case', () => {
    expect(searchTerms(' Dinner  dinner KERALA ')).toEqual(['Dinner', 'KERALA']);
    expect(searchTerms('')).toEqual([]);
  });
});

describe('matching by word prefix', () => {
  const match = (text: string, query: string) => matchesSearch(text, searchTerms(query));

  it('matches the start of any word, ignoring case', () => {
    expect(match('Dinner — Kerala sadya', 'din')).toBe(true);
    expect(match('Dinner — Kerala sadya', 'KER')).toBe(true);
    expect(match('Dinner — Kerala sadya', 'sadya')).toBe(true);
  });

  it('never matches inside a word', () => {
    expect(match('Dinner — Kerala sadya', 'ner')).toBe(false);
    expect(match('Electricity bill', 'ill')).toBe(false);
  });

  it('needs every word of the query, in any order', () => {
    expect(match('Dinner — Kerala sadya', 'kerala din')).toBe(true);
    expect(match('Dinner — Kerala sadya', 'kerala lunch')).toBe(false);
  });

  it('starts a word after punctuation and digits that end one', () => {
    expect(match('Train to Kochi (3 × AC 2-tier)', 'tier')).toBe(true);
    expect(match('Train to Kochi (3 × AC 2-tier)', '3')).toBe(true);
    expect(match('Broadband (300 Mbps)', 'mbps')).toBe(true);
    expect(match('Cook’s monthly salary', 'cook’s')).toBe(true);
  });

  it('keeps an apostrophe inside its word', () => {
    expect(match('Cook’s', 's')).toBe(false);
    expect(match("Priya's share", 's')).toBe(true);
    expect(match("Priya's", 's')).toBe(false);
  });

  it('reads words in any script, accents and combining marks included', () => {
    expect(match('Électricité bill', 'élec')).toBe(true);
    expect(match('électricité', 'ÉLEC')).toBe(true);
    expect(match('किराया Rent', 'कि')).toBe(true);
    // ि is a combining mark: रा continues the word किराया, so it never starts one.
    expect(match('किराया', 'रा')).toBe(false);
  });

  it('treats the query as text, never as a pattern', () => {
    expect(match('Rent (May)', '(may')).toBe(true);
    expect(match('Rent', '.*')).toBe(false);
    expect(match('a+b', 'a+b')).toBe(true);
  });

  it('matches nothing for a query without words', () => {
    expect(matchesSearch('Dinner', [])).toBe(false);
  });
});

describe('the database pattern', () => {
  it('escapes the term and looks behind for a word character', () => {
    expect(wordStartPattern('din')).toBe("(?<![\\p{L}\\p{M}\\p{N}'’])din");
    expect(wordStartPattern('(3 ×')).toBe("(?<![\\p{L}\\p{M}\\p{N}'’])\\(3 ×");
  });

  it('matches what the matcher here matches', () => {
    // Node's own regex engine stands in for PCRE2; both read \p{…} and lookbehind.
    const pattern = (term: string) => new RegExp(wordStartPattern(term), 'iu');
    for (const [text, term] of [
      ['Dinner — Kerala sadya', 'ker'],
      ['Dinner — Kerala sadya', 'ner'],
      ['Train to Kochi (3 × AC 2-tier)', 'tier'],
      ['किराया', 'रा'],
      ['Électricité', 'élec'],
      ['Cook’s', 's'],
      ["O'Brien", 'brien'],
    ])
      expect(pattern(term).test(text)).toBe(matchesSearch(text, [term]));
  });
});

describe('ranking', () => {
  it('puts a text that starts with the whole query first', () => {
    expect(searchRank('Goa Friends Trip', 'goa fr')).toBe(0);
    expect(searchRank('Friends in Goa', 'goa')).toBe(1);
  });
});

describe('highlighting', () => {
  it('marks each word start a term matched, merging overlaps', () => {
    expect(highlightSearch('Dinner — Kerala sadya', ['ker', 'din', 'di'])).toEqual([
      { text: 'Din', match: true },
      { text: 'ner — ', match: false },
      { text: 'Ker', match: true },
      { text: 'ala sadya', match: false },
    ]);
  });

  it('leaves text without a match whole', () => {
    expect(highlightSearch('Flat rent', ['ent'])).toEqual([{ text: 'Flat rent', match: false }]);
    expect(highlightSearch('', ['a'])).toEqual([]);
  });

  it('marks every occurrence that starts a word', () => {
    expect(highlightSearch('Rent and rental', ['rent'])).toEqual([
      { text: 'Rent', match: true },
      { text: ' and ', match: false },
      { text: 'rent', match: true },
      { text: 'al', match: false },
    ]);
  });
});
