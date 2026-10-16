import { expect, it } from 'vitest';
import { draftEntries, draftValues } from './persistent-draft-editor';

const foodId = 'a00000000000000000000001';

it('clears a named Tag when the member selects Not specified', () => {
  const entries = { ...draftEntries({ description: 'Dinner', tag: 'Food' }), tagId: '' };
  expect(draftValues(entries)).toEqual({ description: 'Dinner' });
});

it('keeps an assistant-provided Tag name until it is replaced', () => {
  expect(draftValues(draftEntries({ tag: 'Food' }))).toEqual({ tag: 'Food' });
});

it('replaces a named Tag with the selected stable identity', () => {
  const entries = { ...draftEntries({ tag: 'Food' }), tag: '', tagId: foodId };
  expect(draftValues(entries)).toEqual({ tagId: foodId });
});

it('preserves an unavailable Tag name until it is deliberately cleared', () => {
  const entries = draftEntries({ tag: 'Old Label' });
  expect(draftValues(entries)).toEqual({ tag: 'Old Label' });
  expect(draftValues({ ...entries, tag: '', tagId: '' })).toEqual({});
});

it('keeps a Tag identity over its older name', () => {
  expect(draftValues(draftEntries({ tagId: foodId, tag: 'Old name' }))).toEqual({ tagId: foodId });
});

it('does not reinterpret a hexadecimal Tag name as another Tag identity', () => {
  expect(draftValues(draftEntries({ tag: foodId }))).toEqual({ tag: foodId });
});
