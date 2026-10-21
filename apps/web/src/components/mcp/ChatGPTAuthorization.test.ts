import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { MCP_DRAFT_SCOPE, MCP_LEDGER_SCOPE } from '@/lib/mcp/config';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import { AuthorizedConnections } from './ChatGPTAuthorization';

/* The Connect ChatGPT guide's authorization check once ChatGPT is authorized, as static markup. */

describe('the Connect ChatGPT authorization check', () => {
  it('names To review access, and says deleting an item there is permanent (#579)', () => {
    const shown = text(
      renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { theme: createAppTheme('light') },
          createElement(AuthorizedConnections, {
            name: 'ChatGPT',
            connections: [
              {
                id: 'c1',
                clientId: 'https://chatgpt.com/oauth/client.json',
                scopes: [MCP_LEDGER_SCOPE, MCP_DRAFT_SCOPE, 'offline_access'],
              },
            ],
          }),
        ),
      ),
    );
    expect(shown).toContain(
      'ChatGPT authorized Authorization 1 Read Groups, Balances and spending To review access, including permanent deletion Continued access between visits (refresh tokens)',
    );
    expect(shown).toContain(
      'This connection has broader access than this read-only guide. To change it, disconnect in Settings and reconnect without To review access.',
    );
    expect(shown).not.toMatch(/\bDrafts?\b/);
  });

  it('names the assistant it checks, so Claude has the same check (#619)', () => {
    const shown = text(
      renderToStaticMarkup(
        createElement(
          ThemeProvider,
          { theme: createAppTheme('light') },
          createElement(AuthorizedConnections, {
            name: 'Claude',
            connections: [
              {
                id: 'c1',
                clientId: 'https://claude.ai/oauth/mcp-oauth-client-metadata',
                scopes: [MCP_LEDGER_SCOPE, 'offline_access'],
              },
            ],
          }),
        ),
      ),
    );
    expect(shown).toContain('Claude authorized');
    expect(shown).toContain('Run the test prompt in Claude to check the connection.');
    expect(shown).not.toContain('ChatGPT');
  });
});
