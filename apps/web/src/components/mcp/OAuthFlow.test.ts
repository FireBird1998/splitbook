import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import { ConsentPermissions } from './OAuthFlow';

/* The consent screen's permissions, rendered to static markup with the details the server sends. */

const render = (element: ReactElement) =>
  text(
    renderToStaticMarkup(createElement(ThemeProvider, { theme: createAppTheme('light') }, element)),
  );

const permissions = (scopes: string[]) =>
  render(
    createElement(ConsentPermissions, {
      details: { clientId: 'https://chatgpt.com/oauth/client.json', scopes },
      drafts: false,
      busy: false,
      onDraftsChange: () => {},
    }),
  );

describe('the consent screen', () => {
  it('says an assistant that prepares items for To review can delete them for good (ADR 0008, #579)', () => {
    const shown = permissions(['ledger:read', MCP_DRAFT_SCOPE, 'offline_access']);
    expect(shown).toContain('Also let it prepare Expenses for your To review');
    expect(shown).toContain(
      'It can add, change and permanently delete items in your To review. Only you can save them as Expenses, in Splitbook.',
    );
  });

  it('says nothing about To review when the assistant asks only to read the ledger', () => {
    const shown = permissions(['ledger:read']);
    expect(shown).toContain('Ledger permission: read Group details, Balances and spending.');
    expect(shown).not.toContain('To review');
  });
});
