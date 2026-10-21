import { describe, expect, it } from 'vitest';
import { createGroupSchema, updateGroupSchema } from './group';

// Lisbon & Tokyo, a fictional Trip in rupees.
const trip = { name: 'Lisbon & Tokyo', category: 'trip', defaultCurrency: 'INR' };
const refusal = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? null : result.error!.issues.map((issue) => issue.message);

describe("a Group's extra currencies when it is created or updated (#719)", () => {
  it('take up to 4 supported, distinct codes besides the main currency', () => {
    const created = createGroupSchema.safeParse({
      ...trip,
      alternateCurrencies: ['EUR', 'JPY', 'USD', 'GBP'],
    });
    expect(created.success && created.data.alternateCurrencies).toEqual([
      'EUR',
      'JPY',
      'USD',
      'GBP',
    ]);
    expect(updateGroupSchema.safeParse({ alternateCurrencies: ['EUR', 'JPY'] }).success).toBe(true);
  });

  it('refuse a fifth, an unsupported code, a repeat or the main currency', () => {
    expect(
      refusal(
        createGroupSchema.safeParse({
          ...trip,
          alternateCurrencies: ['EUR', 'JPY', 'USD', 'GBP', 'AUD'],
        }),
      ),
    ).toEqual(['A Group can have at most 4 extra currencies.']);
    expect(refusal(createGroupSchema.safeParse({ ...trip, alternateCurrencies: ['XYZ'] }))).toEqual(
      ['XYZ isn’t a supported currency.'],
    );
    expect(refusal(updateGroupSchema.safeParse({ alternateCurrencies: ['EUR', 'EUR'] }))).toEqual([
      'EUR is listed twice.',
    ]);
    expect(
      refusal(
        updateGroupSchema.safeParse({ defaultCurrency: 'EUR', alternateCurrencies: ['EUR'] }),
      ),
    ).toEqual(['EUR is the main currency, so it can’t also be an extra currency.']);
    expect(refusal(createGroupSchema.safeParse({ ...trip, alternateCurrencies: ['INR'] }))).toEqual(
      ['INR is the main currency, so it can’t also be an extra currency.'],
    );
  });
});
