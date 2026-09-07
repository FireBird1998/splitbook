import { describe, expect, it } from 'vitest';
import { buildDuplicateCheckUrl } from './expense-duplicate-check';

describe('buildDuplicateCheckUrl', () => {
  it('builds the duplicate check route with encoded expense fields', () => {
    const url = buildDuplicateCheckUrl({
      groupId: 'group-1',
      description: 'Dinner & drinks',
      amount: 42.5,
      date: '2026-07-09',
    });

    expect(url).toBe(
      '/api/groups/group-1/expenses/check-duplicate?description=Dinner+%26+drinks&amount=42.5&date=2026-07-09',
    );
  });

  it('includes excludeId when editing an existing expense', () => {
    const url = buildDuplicateCheckUrl({
      groupId: 'group-1',
      description: 'Dinner',
      amount: 42.5,
      date: '2026-07-09',
      excludeId: 'expense-1',
    });

    expect(url).toBe(
      '/api/groups/group-1/expenses/check-duplicate?description=Dinner&amount=42.5&date=2026-07-09&excludeId=expense-1',
    );
  });
});
