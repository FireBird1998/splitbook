import { describe, expect, it } from 'vitest';
import { displayTagReference, resolveTagReference } from './tag-identity';

const tags = [
  { _id: 'food', name: 'Meals', isArchived: false },
  { _id: 'rent', name: 'Rent', isArchived: true },
  { _id: 'old', name: 'Deleted', isArchived: true, isDeleted: true },
];

describe('Tag identity', () => {
  it('uses identity for current display and ignores an obsolete supplied name', () => {
    expect(resolveTagReference(tags, { tagId: 'food', tag: 'Food' })).toEqual({
      tagId: 'food',
      tag: 'Meals',
    });
    expect(displayTagReference(tags, { tagId: 'food', tag: 'Food' })).toEqual({
      tagId: 'food',
      tag: 'Meals',
    });
  });

  it('preserves an unchanged archived or deleted reference but rejects new assignment', () => {
    for (const tagId of ['rent', 'old']) {
      expect(() => resolveTagReference(tags, { tagId })).toThrow('INVALID_TAG');
      expect(resolveTagReference(tags, { tagId }, { tagId, tag: 'Old display' }).tagId).toBe(tagId);
    }
  });

  it('rejects foreign IDs and ambiguous names, including tombstone name reuse', () => {
    expect(() => resolveTagReference(tags, { tagId: 'foreign', tag: 'Meals' })).toThrow(
      'INVALID_TAG',
    );
    expect(() =>
      resolveTagReference([...tags, { _id: 'new', name: 'Deleted', isArchived: false }], {
        tag: 'Deleted',
      }),
    ).toThrow('INVALID_TAG');
  });

  it('allows unchanged unmapped legacy text without guessing a Tag', () => {
    expect(resolveTagReference(tags, {}, { tag: 'Old unknown name' })).toEqual({
      tag: 'Old unknown name',
    });
    expect(() => resolveTagReference(tags, { tag: 'Old unknown name' })).toThrow('INVALID_TAG');
  });

  it('does not transfer a legacy unchanged-name edit to a newly reused name', () => {
    const reused = [...tags, { _id: 'another', name: 'Food', isArchived: false }];
    expect(resolveTagReference(reused, { tag: 'Food' }, { tagId: 'food', tag: 'Food' })).toEqual({
      tagId: 'food',
      tag: 'Meals',
    });
  });
});
