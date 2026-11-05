import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RefusalAlert, { refusalFrom } from './RefusalAlert';
import { groupTabHref } from './group-tabs';
import { anchors, text } from '@/lib/test-utils/markup';

/*
 * Why a member can't leave the Group, or be removed from it, yet, as Group settings shows it:
 * in the server's words, on the page until it's dismissed, never as a generic failure.
 */

const GROUP = 'b00000000000000000000010';

describe('a refusal from the server', () => {
  it('keeps its words and its code', () => {
    expect(
      refusalFrom(
        {
          error: 'Priya Shah owes ₹300.00 in this Group. Settle up before removing them.',
          status: 409,
          code: 'OPEN_BALANCE',
          balances: [{ currency: 'INR', amount: -300 }],
        },
        'Action failed',
      ),
    ).toEqual({
      message: 'Priya Shah owes ₹300.00 in this Group. Settle up before removing them.',
      code: 'OPEN_BALANCE',
    });
  });

  it.each([null, {}, { error: '' }, { error: 42, code: 7 }, 'Bad gateway'])(
    'falls back to its own words when the server says nothing readable: %j',
    (body) => {
      expect(refusalFrom(body, 'Action failed')).toEqual({ message: 'Action failed' });
    },
  );
});

describe('the refusal on Group settings', () => {
  const shown = (refusal: { message: string; code?: string }, onClose?: () => void) =>
    renderToStaticMarkup(createElement(RefusalAlert, { groupId: GROUP, refusal, onClose }));

  it('says what a member still owes and is owed, and offers Balances (#875)', () => {
    const html = shown({
      message:
        'Priya Shah owes €12.50 and is owed ₹600.00 in this Group. Settle up before removing them.',
      code: 'OPEN_BALANCE',
    });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(
      'Priya Shah owes €12.50 and is owed ₹600.00 in this Group. Settle up before removing them.',
    );
    expect(anchors(html)).toEqual([
      { href: groupTabHref(GROUP, 'balances'), current: null, text: 'Go to Balances' },
    ]);
  });

  it('can be dismissed beside Go to Balances where the page lets it', () => {
    const refusal = { message: 'Priya Shah owes ₹300.00 in this Group.', code: 'OPEN_BALANCE' };
    expect(shown(refusal)).not.toContain('aria-label="Close"');
    const html = shown(refusal, () => {});
    expect(html).toContain('aria-label="Close"');
    expect(anchors(html).map((link) => link.text)).toEqual(['Go to Balances']);
  });

  it('shows any other refusal in its words alone', () => {
    const html = shown({ message: 'Cannot remove the last admin.' });
    expect(text(html)).toContain('Cannot remove the last admin.');
    expect(anchors(html)).toEqual([]);
  });
});
