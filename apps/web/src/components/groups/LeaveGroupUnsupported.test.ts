import { createElement, type ReactNode } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import LeaveGroupSection from './LeaveGroupSection';

/*
 * #812: the Leave Group dialog, when the Group holds money in a currency Splitbook no longer
 * supports that involves this member. That money isn't in Balances, so leaving is allowed and
 * the dialog says leaving doesn't settle it; otherwise the dialog is as it was. The Balances read
 * is a stand-in; MUI's dialog renders inline, since its portal needs a browser.
 */

vi.mock('@mui/material/Dialog', () => ({
  default: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', { role: 'dialog' }, children) : null,
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) =>
    createElement('a', { href }, children),
}));
vi.mock('@/components/to-review/use-to-review', () => ({
  useToReview: () => ({ read: { status: 'loading' } }),
}));
const balances = vi.hoisted(() => ({ read: {} as Record<string, unknown> }));
vi.mock('@/lib/web-read', () => ({
  fetchWebBalances: async () => ({
    status: 200,
    data: { balances: [], debts: [], byCurrency: [], ...balances.read },
  }),
}));

const GROUP = 'b00000000000000000000001';
let renderer: ReactTestRenderer;
const textOf = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : ` ${textOf(child)} `))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
const dialog = () => renderer.root.find((node) => node.props.role === 'dialog');
const buttons = (scope: ReactTestInstance) =>
  scope.findAll((node) => node.type === 'button').map(textOf);

async function openDialog() {
  await act(async () => {
    renderer = create(
      createElement(
        SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        createElement(
          ThemeProvider,
          { theme: createAppTheme('light') },
          createElement(LeaveGroupSection, {
            groupId: GROUP,
            groupName: 'Berlin & Paris',
            memberCount: 3,
          }),
        ),
      ),
      { createNodeMock: () => ({ focus() {} }) },
    );
  });
  const leave = renderer.root
    .findAll((node) => node.type === 'button')
    .find((node) => textOf(node) === 'Leave Group')!;
  await act(async () => leave.props.onClick());
  // The Balances read answers.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', { querySelector: () => null });
  balances.read = {};
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('Leave Group with money in a currency Splitbook no longer supports (#812)', () => {
  it('says leaving doesn’t settle it, and still offers Leave Group', async () => {
    balances.read = { unsupportedCurrencies: ['DEM'] };
    await openDialog();
    expect(textOf(dialog())).toContain(
      'Some of this Group’s money is in DEM, a currency Splitbook no longer supports. It isn’t in Balances, so leaving doesn’t settle it.',
    );
    // A warning, never an error: leaving is allowed.
    const note = dialog().find(
      (node) => typeof node.type !== 'string' && node.props.severity === 'warning',
    );
    expect(textOf(note)).toContain('in DEM, a currency');
    expect(buttons(dialog())).toEqual(['Cancel', 'Leave Group']);
  });

  it('names each such currency', async () => {
    balances.read = { unsupportedCurrencies: ['DEM', 'FRF'] };
    await openDialog();
    expect(textOf(dialog())).toContain(
      'is in DEM and FRF, currencies Splitbook no longer supports',
    );
  });

  it('is as it was when no such money involves the member', async () => {
    await openDialog();
    expect(textOf(dialog())).not.toContain('no longer supports');
    expect(textOf(dialog())).toBe(
      'Leave “Berlin & Paris”? You won’t see this Group or its balances any more. Its history stays for the remaining members. Cancel Leave Group',
    );
  });
});
