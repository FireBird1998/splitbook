import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import type { DraftEntries } from '@splitbook/shared/persistent-draft-editor';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import ReviewExpenseFields from './ReviewExpenseFields';

/*
 * The To review editor's payer and split pickers (#591), rendered to static markup: the viewer
 * is "You", matched by member id, so two members with the same name can be told apart, and
 * nothing is filled in that the item doesn't have.
 */

const viewer = 'a00000000000000000000001';
const namesake = 'a00000000000000000000002';
const sam = 'a00000000000000000000003';

/** The editor's markup, without the `<style>` elements MUI writes between its elements. */
function render(entries: DraftEntries) {
  return renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ReviewExpenseFields, {
        entries,
        context: {
          currency: 'INR',
          viewerId: viewer,
          members: [
            { id: viewer, name: 'Ankit Das' },
            { id: namesake, name: 'Ankit Das' },
            { id: sam, name: 'Sam' },
          ],
          tags: [],
        },
        onChange: () => {},
      }),
    ),
  ).replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
}

/** The Paid by field: the member it shows, and the member id it holds. */
function paidBy(html: string) {
  const field =
    />Paid by<\/label><div[^>]*><div[^>]*role="combobox"[^>]*>([\s\S]*?)<\/div><input[^>]*value="([^"]*)"/.exec(
      html,
    );
  if (!field) throw new Error('No Paid by field');
  // An empty Select shows a zero-width space, so it keeps its height.
  return { shows: text(field[1]).replace(/\u200b/g, ''), holds: field[2] };
}

/** Every accessible name given with aria-label, in order, as a screen reader reads it. */
function ariaLabels(html: string) {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map(([, label]) => text(label));
}

const dinner = { description: 'Dinner', amount: '100' };

describe('the payer and split pickers in the web To review editor (#591)', () => {
  it('call only the viewer You, by member id, beside a member with the same name', () => {
    const html = render({
      ...dinner,
      [`paidBy.${viewer}`]: 'yes',
      splitMethod: 'unequal',
      [`splitBetween.${viewer}`]: 'yes',
      [`splitBetween.${namesake}`]: 'yes',
    });

    expect(paidBy(html)).toEqual({ shows: 'You', holds: viewer });
    const labels = ariaLabels(html);
    expect(labels.filter((label) => label.startsWith('Share with '))).toEqual([
      'Share with You',
      'Share with Ankit Das',
      'Share with Sam',
    ]);
    expect(labels.filter((label) => label.endsWith(' share'))).toEqual([
      'Your share',
      "Ankit Das's share",
    ]);
  });

  it('name the other Ankit Das when they paid', () => {
    const html = render({ ...dinner, [`paidBy.${namesake}`]: 'yes' });

    expect(paidBy(html)).toEqual({ shows: 'Ankit Das', holds: namesake });
  });

  it('leave an item without a payer without one: the viewer is not filled in', () => {
    expect(paidBy(render(dinner))).toEqual({ shows: '', holds: '' });
  });
});
