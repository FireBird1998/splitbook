import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';

/*
 * #442: the Group's Activity tab as the server renders it, with the viewer beside a member of
 * the same name. The page read is a stand-in.
 */

const page = vi.hoisted(() => ({ activities: [] as unknown[] }));
vi.mock('swr/infinite', async (original) => {
  const actual = await original<typeof import('swr/infinite')>();
  return {
    ...actual,
    default: () => ({
      data: [
        {
          status: 200,
          data: { activities: page.activities, pagination: { page: 1, totalPages: 1 } },
        },
      ],
      isLoading: false,
      error: undefined,
    }),
  };
});

const { default: ActivityView } = await import('./ActivityView');

const VIEWER = 'a00000000000000000000001';
const NAMESAKE = 'a00000000000000000000009';

const payment = (id: string, paidBy: string, paidTo: string, amount: number) => ({
  _id: id,
  group: 'c00000000000000000000001',
  type: 'settlement_recorded',
  createdAt: '2026-10-17T10:00:00.000Z',
  actor: { _id: paidBy, name: 'Ankit Das' },
  metadata: {
    paidBy,
    paidTo,
    paidByName: 'Ankit Das',
    paidToName: 'Ankit Das',
    amount,
    currency: 'INR',
  },
});

const render = () =>
  text(
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(ActivityView, { groupId: 'c00000000000000000000001', viewerId: VIEWER }),
      ),
    ),
  );

describe('the Group Activity tab (#442)', () => {
  it('calls the viewer "You" in payments they made and received, beside a namesake', () => {
    page.activities = [payment('p1', VIEWER, NAMESAKE, 600), payment('p2', NAMESAKE, VIEWER, 200)];
    const activity = render();
    expect(activity).toContain('You recorded ₹600.00 You → Ankit Das');
    expect(activity).toContain('Ankit Das recorded ₹200.00 Ankit Das → You');
  });
});
