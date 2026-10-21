import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import OAuthFlow, { ConsentChoice, ConsentPermissions } from './OAuthFlow';

/* The approval page's permissions, rendered to static markup with the details the server sends. */

const account = {
  id: 'a00000000000000000000001',
  name: 'Alex Rivera',
  email: 'alex.rivera@example.com',
};

const render = (element: ReactElement) =>
  text(
    renderToStaticMarkup(createElement(ThemeProvider, { theme: createAppTheme('light') }, element)),
  );

const permissions = (
  scopes: string[],
  assistant: { name: string; address: string | null } = {
    name: 'Fictional Assistant',
    address: 'assistant.example.test',
  },
) =>
  render(
    createElement(ConsentPermissions, {
      details: { scopes, ...assistant },
      drafts: false,
      busy: false,
      onDraftsChange: () => {},
    }),
  );

describe('the sign-in step before consent', () => {
  it('asks the member to continue connecting to Splitbook (#595)', () => {
    const shown = render(
      createElement(OAuthFlow, {
        query: '',
        consent: false,
        account,
      }),
    );
    expect(shown).toContain('Continue connecting to Splitbook');
  });
});

describe('the consent screen', () => {
  it('says an assistant that prepares items for To review can delete them for good (ADR 0008, #579)', () => {
    const shown = permissions(['ledger:read', MCP_DRAFT_SCOPE, 'offline_access']);
    expect(shown).toContain('Also let it prepare Expenses for your To review');
    expect(shown).toContain(
      'It can add, change and permanently delete items in your To review. Only you can save them as Expenses, in Splitbook.',
    );
  });

  it('says prepared items don’t change Balances until the member saves them (#683)', () => {
    const shown = render(
      createElement(OAuthFlow, {
        query: '',
        consent: true,
        account,
      }),
    );
    expect(shown).toContain('Prepared items don’t change Balances until you save them.');
  });

  it('names the assistant, with its address in small text, never as a raw client identity (#614)', () => {
    const shown = permissions(['ledger:read']);
    expect(shown).toContain('Fictional Assistant wants to use your Splitbook');
    expect(shown).toContain('assistant.example.test · identified by its published details');
    expect(shown).not.toContain('Client identity');
    expect(shown).not.toContain('https://assistant.example.test/client.json');
  });

  it('shows no address for a registered client, which publishes no details (#614)', () => {
    const shown = permissions(['ledger:read'], { name: 'Synthetic MCP Client', address: null });
    expect(shown).toContain('Synthetic MCP Client wants to use your Splitbook');
    expect(shown).not.toContain('identified by its published details');
  });

  it.each([[['ledger:read']], [['ledger:read', MCP_DRAFT_SCOPE, 'offline_access']]])(
    'says what the assistant can’t do on every approval (#614): %j',
    (scopes) => {
      const shown = permissions(scopes);
      expect(shown).toContain('What Fictional Assistant can’t do');
      for (const limit of [
        'Save Expenses or payments',
        'Change anything in a Group',
        'See Groups left out',
        'See anyone’s email',
      ])
        expect(shown).toContain(limit);
    },
  );

  it('shows who is signed in, by name and email, on every approval (#614)', () => {
    const shown = render(createElement(OAuthFlow, { query: '', consent: true, account }));
    expect(shown).toContain('Signed in as');
    expect(shown).toContain('Alex Rivera');
    expect(shown).toContain('alex.rivera@example.com');
    expect(shown).not.toContain('Not you?');
  });

  it('says Splitbook checks the member’s access on every request (#614)', () => {
    const shown = render(createElement(OAuthFlow, { query: '', consent: true, account }));
    expect(shown).toContain('Splitbook checks your access on every request.');
  });

  it('asks the member to allow only an assistant they asked to connect just now, by its name (#614)', () => {
    const shown = render(
      createElement(ConsentChoice, {
        name: 'Fictional Assistant',
        disabled: false,
        onAllow: () => {},
        onDeny: () => {},
      }),
    );
    expect(shown).toContain('Allow connection');
    expect(shown).toContain('Deny');
    expect(shown).toContain(
      'Only allow this if you asked Fictional Assistant to connect just now.',
    );
  });

  it('says nothing about To review when the assistant asks only to read the ledger', () => {
    const shown = permissions(['ledger:read']);
    expect(shown).toContain('Ledger permission: read Group details, Balances and spending.');
    expect(shown).not.toContain('To review');
  });
});
