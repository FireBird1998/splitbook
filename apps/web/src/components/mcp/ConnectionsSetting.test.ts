import { createElement, type ComponentType, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider as EmotionThemeProvider } from '@emotion/react';
import { THEME_ID, ThemeProvider } from '@mui/material/styles';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { listItems, text } from '@/lib/test-utils/markup';
import ConnectionsSetting, { ConnectionsList } from './ConnectionsSetting';

/*
 * Settings' Connected assistants: once loaded, rendered to static markup; and Disconnect, rendered
 * with only the server behind `fetch` a stand-in. Without a document, the confirmation dialog
 * renders in place and Next's Link as a plain link.
 */

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return { default: (props: object) => createElement('a', props) };
});
vi.mock('@mui/material/Dialog', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? createElement('div', { role: 'dialog' }, children) : null,
  };
});

type Listed = Parameters<typeof ConnectionsList>[0]['data']['connections'][number];

const CHATGPT: Listed = {
  id: 'c1',
  clientId: 'https://chatgpt.com/oauth/client.json',
  name: 'ChatGPT',
  lastUsedAt: new Date(2026, 7, 29, 10, 41).toISOString(),
  scopes: ['ledger:read', MCP_DRAFT_SCOPE],
  access: 'Ledger + To review',
};
const SYNTHETIC: Listed = {
  id: 'c2',
  clientId: 'https://assistant.example.test/client.json',
  name: 'Synthetic Assistant',
  lastUsedAt: null,
  scopes: ['ledger:read'],
  access: 'Ledger',
};

const markup = (
  connections: Listed[] = [CHATGPT, SYNTHETIC],
  groups?: Parameters<typeof ConnectionsList>[0]['groups'],
) =>
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ConnectionsList, {
        data: { resource: 'https://splitbook.example/mcp', connections, nextOffset: null },
        groups,
        busy: null,
        onRevoke: () => {},
        onLoadMore: () => {},
      }),
    ),
  );
const render = (connections?: Listed[]) => text(markup(connections));

describe('Settings → Connected assistants', () => {
  it('shows the address below each name and uses day-first last use with a year only when needed', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 21));
      const shown = render();
      expect(shown).toContain('Last used 29 Aug');
      expect(shown).toContain('ChatGPT chatgpt.com/oauth/client.json');
      expect(shown).not.toContain('29 Aug 2026');
      vi.setSystemTime(new Date(2027, 9, 21));
      expect(render()).toContain('Last used 29 Aug 2026');
    } finally {
      vi.useRealTimers();
    }
  });

  it('names To review, not Drafts, and says deleting an item there is permanent (#579)', () => {
    const shown = render();
    expect(shown).toContain(
      'Assistants can answer questions about your Groups, balances and Expenses. If you also let one prepare Expenses, it can add, change and permanently delete items in your To review. Only you can save Expenses in Splitbook.',
    );
    expect(shown).toContain(
      'Disconnecting blocks further requests and keeps what’s in your To review. Previously shared information may remain in your assistant.',
    );
    expect(shown).not.toMatch(/\bDrafts?\b/);
  });

  it('words each assistant’s access as the approval page does: Read only, or Read only + To review', () => {
    const shown = render();
    expect(shown).toContain('chatgpt.com/oauth/client.json Read only + To review');
    expect(shown).toContain('assistant.example.test/client.json Read only Not used yet');
    expect(shown).not.toMatch(/\bLedger\b/);
  });

  it('gives an address only to an https metadata document, as the approval page does', () => {
    const shown = render([
      { ...SYNTHETIC, id: 'c3', clientId: 'http://plain.example.test/client.json' },
      { ...SYNTHETIC, id: 'c4', clientId: 'registered-client-id', name: 'Registered Helper' },
    ]);
    expect(shown).not.toContain('plain.example.test');
    expect(shown).not.toContain('registered-client-id');
    expect(shown).toContain('Synthetic Assistant Read only');
    expect(shown).toContain('Registered Helper Read only');
  });

  it('lists each assistant in its own row, with its own compact red Disconnect', () => {
    const rows = listItems(markup(), 'Connected assistants');
    expect(rows.map((row) => text(row.html))).toEqual([
      expect.stringMatching(/^ChatGPT chatgpt\.com\/oauth\/client\.json Read only \+ To review /),
      expect.stringMatching(
        /^Synthetic Assistant assistant\.example\.test\/client\.json Read only /,
      ),
    ]);
    for (const [row, name] of [
      [rows[0], 'ChatGPT, chatgpt.com/oauth/client.json'],
      [rows[1], 'Synthetic Assistant, assistant.example.test/client.json'],
    ] as const) {
      const disconnect = /<button\b[^>]*>/.exec(row.html)![0];
      expect(disconnect).toContain(`aria-label="Disconnect ${name}"`);
      expect(disconnect).toContain('MuiButton-outlined');
      expect(disconnect).toContain('MuiButton-colorError');
      expect(disconnect).toContain('MuiButton-sizeSmall');
      expect(disconnect).not.toContain('MuiButton-fullWidth');
    }
  });

  it('shows how many of the member’s Groups each assistant reaches, and links to its page (#620)', () => {
    const groups = [
      { id: 'b00000000000000000000001', rule: 'allowed' },
      { id: 'b00000000000000000000002', rule: 'allowed' },
      { id: 'b00000000000000000000003', rule: 'not_allowed' },
    ] as const;
    const html = markup(
      [{ ...CHATGPT, excludedGroupIds: ['b00000000000000000000002'] }, SYNTHETIC],
      groups,
    );
    const rows = listItems(html, 'Connected assistants').map((row) => row.html);
    expect(text(rows[0])).toContain('1 of 3 Groups');
    expect(text(rows[1])).toContain('2 of 3 Groups');
    expect(rows[0]).toMatch(/<a[^>]*href="\/settings\/assistants\/c1"[^>]*>Manage<\/a>/);
    expect(rows[1]).toMatch(/<a[^>]*href="\/settings\/assistants\/c2"[^>]*>Manage<\/a>/);
    // Before the member's Groups load, no count is guessed.
    expect(render()).not.toMatch(/of \d+ Groups/);
  });

  it('names each Disconnect apart, even for two assistants with one name', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 21));
      const labels = [
        ...markup([
          CHATGPT,
          { ...SYNTHETIC, id: 'c3', clientId: 'registered-one', name: 'Assistant' },
          {
            ...CHATGPT,
            id: 'c4',
            clientId: 'registered-two',
            name: 'Assistant',
          },
        ]).matchAll(/<button\b[^>]*aria-label="(Disconnect [^"]*)"/g),
      ].map(([, label]) => label);
      expect(labels).toEqual([
        'Disconnect ChatGPT, chatgpt.com/oauth/client.json',
        'Disconnect Assistant, Not used yet',
        'Disconnect Assistant, Last used 29 Aug',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Disconnect in Settings', () => {
  let renderer: ReactTestRenderer | undefined;
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  /** MUI's own provider reads the document on mount; Emotion's carries the theme without one. */
  const AppTheme = EmotionThemeProvider as ComponentType<{ theme: object; children?: ReactNode }>;
  const textOf = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(textOf).join('');
  const press = async (button: ReactTestInstance) => {
    await act(async () => {
      button.props.onClick({ preventDefault() {}, stopPropagation() {} });
    });
  };

  it('loads the member’s Groups and shows how many each assistant reaches (#620)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/user/assistant-groups'
          ? Response.json({
              data: {
                groups: [
                  { id: 'b00000000000000000000001', rule: 'allowed' },
                  { id: 'b00000000000000000000002', rule: 'allowed' },
                ],
              },
              status: 200,
            })
          : Response.json({
              resource: 'https://splitbook.example/mcp',
              connections: [{ ...CHATGPT, excludedGroupIds: ['b00000000000000000000002'] }],
              nextOffset: null,
            }),
      ),
    );
    await act(async () => {
      renderer = create(
        createElement(
          AppTheme,
          { theme: { [THEME_ID]: createAppTheme('light') } },
          createElement(ConnectionsSetting, { accountId: 'fictional-account' }),
        ),
      );
    });
    expect(textOf(renderer!.root)).toContain('1 of 2 Groups');
  });

  it('revokes the assistant whose Disconnect was pressed, not the first one listed', async () => {
    const revoked: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/auth/mcp/revoke') {
          revoked.push(JSON.parse(String(init?.body)));
          return Response.json({ disconnected: true });
        }
        return Response.json({
          resource: 'https://splitbook.example/mcp',
          connections: [CHATGPT, SYNTHETIC],
          nextOffset: null,
        });
      }),
    );
    await act(async () => {
      renderer = create(
        createElement(
          AppTheme,
          { theme: { [THEME_ID]: createAppTheme('light') } },
          createElement(ConnectionsSetting, { accountId: 'fictional-account' }),
        ),
      );
    });
    await press(
      renderer!.root.find(
        (node) =>
          node.type === 'button' &&
          node.props['aria-label'] ===
            'Disconnect Synthetic Assistant, assistant.example.test/client.json',
      ),
    );
    const dialog = renderer!.root.find((node) => node.props.role === 'dialog');
    expect(textOf(dialog)).toContain('Disconnect Synthetic Assistant?');
    await press(
      dialog.find((node) => node.type === 'button' && textOf(node).trim() === 'Disconnect'),
    );
    expect(revoked).toEqual([{ id: 'c2' }]);
    expect(textOf(renderer!.root)).toContain('ChatGPT');
    expect(textOf(renderer!.root)).not.toContain('Synthetic Assistant');
  });
});
