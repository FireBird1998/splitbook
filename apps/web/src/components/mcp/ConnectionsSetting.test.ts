import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { listItems, text } from '@/lib/test-utils/markup';
import { ConnectionsList } from './ConnectionsSetting';

/* Settings' Connected assistants once loaded, rendered to static markup. */

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

const markup = (connections: Listed[] = [CHATGPT, SYNTHETIC]) =>
  renderToStaticMarkup(
    createElement(
      ThemeProvider,
      { theme: createAppTheme('light') },
      createElement(ConnectionsList, {
        data: { resource: 'https://splitbook.example/mcp', connections, nextOffset: null },
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
      [rows[0], 'ChatGPT'],
      [rows[1], 'Synthetic Assistant'],
    ] as const) {
      const disconnect = /<button\b[^>]*>/.exec(row.html)![0];
      expect(disconnect).toContain(`aria-label="Disconnect ${name}"`);
      expect(disconnect).toContain('MuiButton-outlined');
      expect(disconnect).toContain('MuiButton-colorError');
      expect(disconnect).toContain('MuiButton-sizeSmall');
      expect(disconnect).not.toContain('MuiButton-fullWidth');
    }
  });
});
