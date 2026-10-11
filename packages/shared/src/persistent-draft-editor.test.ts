import { expect, it } from 'vitest';
import {
  draftEntries,
  draftEntryChanges,
  draftFields,
  draftValues,
} from './persistent-draft-editor';

const foodId = 'a00000000000000000000001';

it('clears a named Tag when the member selects Not specified', () => {
  const entries = { ...draftEntries({ description: 'Dinner', tag: 'Food' }), tagId: '' };
  expect(draftValues(entries)).toEqual({ description: 'Dinner' });
});

it('shows the assistant-provided Tag name before editing it', () => {
  const entries = draftEntries({ tag: 'Food' });
  const field = draftFields(entries, { members: [], tags: [{ id: foodId, name: 'Food' }] }).find(
    (field) => field.key === 'tagId',
  )!;
  const selected = field.value ?? entries[field.key];
  expect(field.options?.find((option) => option.value === selected)?.label).toBe('Food');
  expect(draftValues(entries)).toEqual({ tag: 'Food' });
});

it('replaces a named Tag with the selected stable identity', () => {
  const entries = {
    ...draftEntries({ tag: 'Food' }),
    ...draftEntryChanges('tagId', foodId),
  };
  expect(entries.tag).toBe('');
  expect(draftValues(entries)).toEqual({ tagId: foodId });
});

it('preserves an unavailable Tag name until it is deliberately cleared', () => {
  const entries = draftEntries({ tag: 'Old Label' });
  const field = draftFields(entries, { members: [], tags: [] }).find(
    (field) => field.key === 'tagId',
  )!;
  expect(field.options?.find((option) => option.value === field.value)?.label).toBe(
    'Old Label (unavailable)',
  );
  expect(draftValues(entries)).toEqual({ tag: 'Old Label' });
  expect(draftValues({ ...entries, ...draftEntryChanges('tagId', '') })).toEqual({});
});

it('uses a renamed Tag identity and keeps an unavailable identity explicit', () => {
  const entries = draftEntries({ tagId: foodId, tag: 'Old name' });
  const renamed = draftFields(entries, {
    members: [],
    tags: [{ id: foodId, name: 'Meals' }],
  }).find((field) => field.key === 'tagId')!;
  expect(renamed.options?.find((option) => option.value === renamed.value)?.label).toBe('Meals');
  expect(draftValues(entries)).toEqual({ tagId: foodId });
  const unavailable = draftFields(entries, { members: [], tags: [] }).find(
    (field) => field.key === 'tagId',
  )!;
  expect(unavailable.options?.find((option) => option.value === unavailable.value)?.label).toBe(
    `Unavailable Tag (${foodId})`,
  );
  expect(draftValues(entries)).toEqual({ tagId: foodId });
});

it('does not reinterpret a hexadecimal Tag name as another Tag identity', () => {
  const entries = draftEntries({ tag: foodId });
  const field = draftFields(entries, {
    members: [],
    tags: [{ id: foodId, name: 'Meals' }],
  }).find((field) => field.key === 'tagId')!;
  expect(field.options?.find((option) => option.value === field.value)?.label).toBe(
    `${foodId} (unavailable)`,
  );
  expect(draftValues(entries)).toEqual({ tag: foodId });
});
