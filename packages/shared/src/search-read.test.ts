import { describe, expect, it } from 'vitest';
import { parseSearchResponse, SearchReadError } from './search-read';

// Fictional Groups, people and Expenses, shaped like the search read's answer.
const goa = 'b00000000000000000000001';
const sam = 'a00000000000000000000002';
const response = {
  status: 200,
  data: {
    query: 'goa',
    groups: [{ id: goa, name: 'Goa Friends Trip', category: 'trip', memberCount: 3 }],
    people: [
      { id: sam, name: 'Sam Chen', groupId: goa, groupName: 'Goa Friends Trip', groupCount: 2 },
    ],
    expenses: [
      {
        id: 'c00000000000000000000001',
        groupId: goa,
        groupName: 'Goa Friends Trip',
        description: 'Goa beach shack dinner',
        amountMinor: 240000,
        currency: 'INR',
        date: '2026-09-12T00:00:00.000Z',
      },
    ],
    more: { groups: false, people: false, expenses: true },
  },
};

/** A copy of the response with `change` applied to its data. */
function changed(change: (data: Record<string, unknown>) => void) {
  const body = JSON.parse(JSON.stringify(response));
  change(body.data);
  return body;
}

describe("the search read's contract", () => {
  it('returns the wire shape, with the fields it does not declare', () => {
    const body = changed((data) => {
      data.extra = 1;
      (data.groups as Record<string, unknown>[])[0].kept = true;
    });
    expect(parseSearchResponse(body)).toStrictEqual(body.data);
  });

  it('accepts empty sections and an Expense whose amount could not be read', () => {
    const body = changed((data) => {
      data.groups = [];
      data.people = [];
      (data.expenses as Record<string, unknown>[])[0].amountMinor = null;
    });
    expect(parseSearchResponse(body)).toStrictEqual(body.data);
  });

  it.each([
    ['a status other than 200', (body: Record<string, unknown>) => (body.status = 201)],
    ['no data', (body: Record<string, unknown>) => delete body.data],
    [
      'a Group id that is not an id',
      (body: { data: typeof response.data }) => {
        (body.data.groups[0] as Record<string, unknown>).id = 'goa';
      },
    ],
    [
      'a person without a Group',
      (body: { data: typeof response.data }) => {
        delete (body.data.people[0] as Record<string, unknown>).groupId;
      },
    ],
    [
      'a person in no Group',
      (body: { data: typeof response.data }) => {
        body.data.people[0].groupCount = 0;
      },
    ],
    [
      'an amount in major units',
      (body: { data: typeof response.data }) => {
        body.data.expenses[0].amountMinor = 2400.5;
      },
    ],
    [
      'an Expense date that is not a time',
      (body: { data: typeof response.data }) => {
        body.data.expenses[0].date = 'yesterday';
      },
    ],
    [
      'no word on whether more matched',
      (body: Record<string, unknown>) => {
        delete (body.data as Record<string, unknown>).more;
      },
    ],
  ] as [string, (body: never) => void][])('rejects %s', (_label, change) => {
    const body = JSON.parse(JSON.stringify(response));
    change(body as never);
    expect(() => parseSearchResponse(body)).toThrow(SearchReadError);
  });

  it('never repeats what it rejected in its message', () => {
    const body = changed((data) => (data.query = 42));
    expect(() => parseSearchResponse(body)).toThrow('Search could not be loaded. Please retry.');
  });
});
