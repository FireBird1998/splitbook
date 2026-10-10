import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import LeaveGroupSection from './LeaveGroupSection';
import { text } from '@/lib/test-utils/markup';

describe('the web last-member warning', () => {
  it('explains permanent deletion before the sole member opens confirmation', () => {
    const html = renderToStaticMarkup(
      createElement(LeaveGroupSection, {
        groupId: 'b00000000000000000000001',
        groupName: 'Fictional final Trip',
        memberCount: 1,
      }),
    );
    expect(text(html)).toContain('Leaving will permanently delete this Group and its history.');
    expect(text(html)).toContain('Expenses, Settlements and Activity');
  });
});
