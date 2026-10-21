import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_CANNOT } from '@/lib/mcp/assistant-limits';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import ConnectAssistant from './ConnectAssistant';
import ConnectionsSetting from './ConnectionsSetting';

/* Connect (#619): a picker of assistants, each opening its setup, and what any assistant can
 * and can't do, rendered to static markup with the deployment's own server address. */

const resource = 'https://splitbook.example/api/mcp';
const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(ThemeProvider, { theme: createAppTheme('light') }, element));
const connect = (assistant?: string, server: string | null = resource) =>
  markup(createElement(ConnectAssistant, { resource: server, assistant }));

describe('Connect an assistant', () => {
  it('offers Claude, ChatGPT, Claude Code and Other MCP client, each linking to its setup (#619)', () => {
    const html = connect();
    for (const [label, id] of [
      ['Claude', 'claude'],
      ['ChatGPT', 'chatgpt'],
      ['Claude Code', 'claude-code'],
      ['Other MCP client', 'other'],
    ])
      expect(html, label).toMatch(
        new RegExp(`<a[^>]*href="/connect\\?assistant=${id}"[^>]*>(?:<[^>]+>)*${label}<`),
      );
    // Claude is chosen until the member picks another.
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/connect\?assistant=claude"/);
  });

  it.each([
    ['claude', 'Add Splitbook to Claude as a custom connector'],
    ['chatgpt', 'Open ChatGPT Plugins'],
    ['claude-code', 'Add Splitbook to Claude Code'],
    ['other', 'Add Splitbook to your MCP client'],
  ])('opens the %s setup with its first step (#619)', (assistant, step) => {
    expect(text(connect(assistant))).toContain(step);
  });

  it('gives Claude the server address, the permissions to grant, a test prompt and a live check (#619)', () => {
    const shown = text(connect('claude'));
    expect(shown).toContain(resource);
    expect(shown).toContain('Copy server address');
    expect(shown).toContain('leave To review access off');
    expect(shown).toContain('Untick any Group you want to leave out.');
    expect(shown).toContain('Copy test prompt');
    expect(shown).toContain('Check your authorization');
  });

  it('gives Claude Code the command that adds this server (#619)', () => {
    const shown = text(connect('claude-code'));
    expect(shown).toContain(`claude mcp add --transport http splitbook ${resource}`);
    expect(shown).toContain('Copy command');
  });

  it('gives any other client the address and the standard steps (#619)', () => {
    const shown = text(connect('other'));
    expect(shown).toContain(resource);
    expect(shown).toContain('streamable HTTP');
    expect(shown).toContain('Client ID Metadata Document');
  });

  it('shows the deployment’s own server address, never a hard-coded one (#619)', () => {
    const other = 'https://mcp.other.example/api/mcp';
    for (const assistant of ['claude', 'claude-code', 'other']) {
      const shown = text(connect(assistant, other));
      expect(shown, assistant).toContain(other);
      expect(shown, assistant).not.toContain(resource);
      expect(shown, assistant).not.toContain('vercel.app');
    }
  });

  it('says setup is unavailable where the server is off (#619)', () => {
    const shown = text(connect('claude', null));
    expect(shown).toContain('Not available in this environment');
    expect(shown).not.toContain('Copy server address');
  });

  it('says what an assistant can and can’t do, in the approval page’s words (#619)', () => {
    const shown = text(connect('other'));
    expect(shown).toContain('What an assistant can do');
    expect(shown).toContain('Answer questions about your Groups, balances and Expenses');
    expect(shown).toContain('Prepare Expenses for your To review, if you allow it');
    expect(shown).toContain('Only you save them.');
    for (const limit of ASSISTANT_CANNOT) expect(shown).toContain(limit);
  });

  it('opens the picker from Settings’ Connect link (#619)', () => {
    const html = markup(
      createElement(ConnectionsSetting, { accountId: 'a00000000000000000000001' }),
    );
    expect(html).toMatch(/<a[^>]*href="\/connect"[^>]*>Connect an assistant</);
    expect(html).not.toContain('href="/connect/chatgpt"');
  });
});
