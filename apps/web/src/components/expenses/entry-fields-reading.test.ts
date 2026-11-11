import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ExpenseDraft } from '@splitbook/shared/expense-draft';
import {
  entries,
  people,
  alex,
  day,
  groupId,
  tagId,
  savedFor,
} from '@splitbook/shared/test-support/expense-entry-cases';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import ExpenseFields from './ExpenseFields';

const context = {
  groupId,
  accountId: alex,
  memberIds: people.map((p) => p.id),
  currency: 'INR',
  defaultTag: tagId,
  date: day,
};
const words = (html: string) =>
  html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/[\t\r\n ]+/g, ' ')
    .trim();

// One entry per test: these real fields never need one long, slow dialog test.
for (const edit of [false, true]) {
  const recorded = JSON.parse(
    readFileSync(
      new URL(
        '../../../../../test/expense-entry-readings/recordings/web-' +
          (edit ? 'edit' : 'new') +
          '.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  it.each(entries.filter((row) => edit || !row.savedZeroPayer))(
    'shows the recorded ' + (edit ? 'edit' : 'new') + ' fields through the ExpenseEntry props: $id',
    (row) => {
      const { id, savedZeroPayer: _scenario, ...entry } = row;
      const draft = ExpenseDraft.open(context, edit ? savedFor(row) : null).change(entry);
      const shown = renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { theme: createAppTheme('light') },
          createElement(ExpenseFields, {
            entry: draft.entry,
            reading: draft.reading(),
            editEntry: () => {},
            chooseSplitMethod: () => {},
            members: people.map((p) => ({ user: { _id: p.id, name: p.name } })),
            groupTags: [{ _id: tagId, name: 'Shared', isArchived: false }],
            userId: alex,
            isEditMode: edit,
          }),
        ),
      );
      expect(words(shown)).toBe(recorded[id].shown.formContents);
    },
  );
}
