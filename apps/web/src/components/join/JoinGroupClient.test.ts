import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';

/*
 * The invite page (board WebJoin, #646): the brand mark while the invite loads, then the Group's
 * Theme icon in a 56 px tile above a plain h1, and an icon tile above a plain h1 when the invite
 * can't be opened. Never an emoji, never a spinner, and one h1 in each state.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return { default: (props: object) => createElement('a', props) };
});
vi.mock('@/lib/auth-client', () => ({
  signInWithGoogle: vi.fn(),
  authClient: { useSession: () => ({ data: null }) },
}));
const api = vi.hoisted(() => ({ fetch: vi.fn<(path: string) => Promise<Response>>() }));
vi.mock('@/lib/utils/api-fetch', () => ({ apiFetch: api.fetch }));

const { default: JoinGroupClient } = await import('./JoinGroupClient');

let renderer: ReactTestRenderer | null = null;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('document', { querySelector: () => null });
});
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  api.fetch.mockReset();
  vi.unstubAllGlobals();
});

const textOf = (node: ReactTestInstance): string =>
  node.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

async function render(answer: Promise<Response>) {
  api.fetch.mockReturnValue(answer);
  await act(async () => {
    renderer = create(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(JoinGroupClient, { code: 'synthetic-invite', authMode: 'demo' }),
      ),
    );
  });
  return renderer!;
}

const hosts = (root: ReactTestInstance, type: string) => root.findAll((node) => node.type === type);
const h1s = (root: ReactTestInstance) => hosts(root, 'h1').map((node) => textOf(node));
const EMOJI = /\p{Extended_Pictographic}/u;
const tile = (root: ReactTestInstance) =>
  root.findAll(
    (node) => typeof node.type === 'string' && node.props['data-join-tile'] !== undefined,
  );

describe('the invite page', () => {
  it('shows the mark and “Loading…” while the invite loads, not a spinner', async () => {
    const { root } = await render(new Promise<Response>(() => {}));
    expect(h1s(root)).toEqual(['Join Group']);
    expect(root.findAll((node) => node.props.role === 'progressbar')).toHaveLength(0);
    const status = root.find(
      (node) => typeof node.type === 'string' && node.props.role === 'status',
    );
    expect(textOf(status)).toBe('Loading…');
    expect(
      hosts(status, 'img').map((node) => [node.props.src, node.props.alt, node.props.style.width]),
    ).toEqual([
      ['/brand/mark-indigo.svg', 'Splitbook', 48],
      ['/brand/mark-on-dark.svg', 'Splitbook', 48],
    ]);
  });

  it('heads the invite with the Theme icon in a 56 px tile and the Group’s name alone', async () => {
    const { root } = await render(
      Promise.resolve(
        Response.json({
          data: { name: 'Synthetic Lakeview Flat', category: 'home', memberCount: 3 },
        }),
      ),
    );
    expect(h1s(root)).toEqual(['Synthetic Lakeview Flat']);
    expect(textOf(root.findByType('main' as never))).not.toMatch(EMOJI);
    const [box] = tile(root);
    expect(box.props['data-join-tile']).toBe('home');
    expect(box.props['aria-hidden']).toBe(true);
    expect(
      box.findAll((node) => node.props['data-testid'] === 'HomeOutlinedIcon'),
    ).not.toHaveLength(0);
  });

  it('says plainly when the invite can’t be opened, under an icon tile, without an emoji', async () => {
    const { root } = await render(Promise.resolve(Response.json({}, { status: 404 })));
    expect(h1s(root)).toEqual(['Can’t open this invite']);
    const main = textOf(root.findByType('main' as never));
    expect(main).not.toMatch(EMOJI);
    expect(main).not.toContain('Oops');
    expect(main).toContain('This invite link is invalid or has expired.');
    expect(tile(root).map((node) => node.props['data-join-tile'])).toEqual(['error']);
  });
});
