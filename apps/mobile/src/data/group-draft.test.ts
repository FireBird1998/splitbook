import { describe, expect, it } from 'vitest';
import { parseGroupCreation } from './group-draft';

/*
 * #723: a new Trip offers extra currencies, and its stored Group submission keeps them. A
 * submission stored on the phone before that release has no extraCurrencies; it still reopens,
 * as a Trip that chose none.
 */

const accountId = 'a00000000000000000000001';
const stored = (draft: Record<string, unknown>) => ({
  version: 1,
  accountId,
  key: 'group-create-0001',
  body: JSON.stringify({ name: 'Goa', category: 'trip', defaultCurrency: 'INR' }),
  draft: {
    name: 'Goa',
    description: '',
    category: 'trip',
    defaultCurrency: 'INR',
    startDate: '',
    endDate: '',
    ...draft,
  },
});

describe('a Group submission stored on this phone (#723)', () => {
  it('reopens one stored before a Trip offered extra currencies as choosing none', () => {
    expect(parseGroupCreation(stored({}), accountId).draft.extraCurrencies).toEqual([]);
  });

  it('keeps the extra currencies a Trip chose', () => {
    expect(
      parseGroupCreation(stored({ extraCurrencies: ['EUR', 'JPY'] }), accountId).draft
        .extraCurrencies,
    ).toEqual(['EUR', 'JPY']);
  });
});
