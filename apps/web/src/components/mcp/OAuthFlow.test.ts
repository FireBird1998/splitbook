import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import OAuthFlow, {
  ApprovalHeading,
  ConsentChoice,
  ConsentGroups,
  ConsentPermissions,
  consentRequest,
} from './OAuthFlow';

/* The approval page's permissions, rendered to static markup with the details the server sends. */

const account = {
  id: 'a00000000000000000000001',
  name: 'Alex Rivera',
  email: 'alex.rivera@example.com',
};

const markup = (element: ReactElement) =>
  renderToStaticMarkup(createElement(ThemeProvider, { theme: createAppTheme('light') }, element));
const render = (element: ReactElement) => text(markup(element));

/** The member's Groups as the approval page lists them (#617). */
const groups = [
  {
    id: 'b00000000000000000000001',
    name: 'Maple House',
    theme: 'home',
    currency: 'INR',
    archived: false,
  },
  {
    id: 'b00000000000000000000002',
    name: 'Goa Friends Trip',
    theme: 'trip',
    currency: 'INR',
    archived: false,
  },
  {
    id: 'b00000000000000000000003',
    name: 'Lisbon Offsite',
    theme: 'work',
    currency: 'EUR',
    archived: true,
  },
] as const;
const groupChoice = (
  excluded: readonly string[],
  listed: readonly (typeof groups)[number][] = groups,
) =>
  markup(
    createElement(ConsentGroups, {
      name: 'Fictional Assistant',
      groups: listed,
      excluded,
      disabled: false,
      onExcludedChange: () => {},
    }),
  );

const permissions = (
  scopes: string[],
  assistant: { name: string; address: string | null } = {
    name: 'Fictional Assistant',
    address: 'assistant.example.test/client.json',
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
    const shown = render(
      createElement(ApprovalHeading, {
        details: { name: 'Fictional Assistant', address: 'assistant.example.test/client.json' },
      }),
    );
    expect(shown).toContain('Fictional Assistant wants to use your Splitbook');
    expect(shown).toContain(
      'assistant.example.test/client.json · identified by its published details',
    );
    expect(shown).not.toContain('Client identity');
    expect(shown).not.toContain('https://assistant.example.test/client.json');
  });

  it('says a registered client publishes no address (#614)', () => {
    const shown = render(
      createElement(ApprovalHeading, { details: { name: 'Synthetic MCP Client', address: null } }),
    );
    expect(shown).toContain('Synthetic MCP Client wants to use your Splitbook');
    expect(shown).not.toContain('identified by its published details');
    expect(shown).toContain('Registered by the assistant itself. Its address isn’t published.');
  });

  it('isolates the assistant’s name from the text around it wherever it appears (#614)', () => {
    const html = markup(
      createElement(ConsentPermissions, {
        details: {
          scopes: ['ledger:read'],
          name: 'Fictional Assistant',
          address: 'assistant.example.test/client.json',
        },
        drafts: false,
        busy: false,
        onDraftsChange: () => {},
      }),
    );
    expect(html.match(/<bdi>Fictional Assistant<\/bdi>/g)).toHaveLength(2);
    expect(
      markup(
        createElement(ApprovalHeading, {
          details: { name: 'Fictional Assistant', address: 'assistant.example.test/client.json' },
        }),
      ),
    ).toContain('<bdi>Fictional Assistant</bdi>');
    expect(
      markup(
        createElement(ConsentChoice, {
          name: 'Fictional Assistant',
          disabled: false,
          onAllow: () => {},
          onDeny: () => {},
        }),
      ),
    ).toContain('<bdi>Fictional Assistant</bdi>');
  });

  it('leads with the assistant’s name as the page’s heading, its address just under it (#617)', () => {
    const html = markup(
      createElement(ApprovalHeading, {
        details: { name: 'Fictional Assistant', address: 'assistant.example.test/client.json' },
      }),
    );
    expect(html).toMatch(
      /<h1[^>]*><bdi>Fictional Assistant<\/bdi> wants to use your Splitbook<\/h1>/,
    );
    // The generic title is a label above it, no longer a heading.
    expect(html).not.toMatch(/<h\d[^>]*>Connect an assistant/);
    const shown = text(html);
    expect(shown.indexOf('Connect an assistant')).toBeLessThan(shown.indexOf('wants to use'));
    expect(shown.indexOf('wants to use')).toBeLessThan(
      shown.indexOf('assistant.example.test/client.json · identified'),
    );
  });

  it('pairs an outlined Deny with Allow at equal width (#617)', () => {
    const html = markup(
      createElement(ConsentChoice, {
        name: 'Fictional Assistant',
        disabled: false,
        onAllow: () => {},
        onDeny: () => {},
      }),
    );
    const button = (label: string) =>
      new RegExp(`<button[^>]*class="([^"]*)"[^>]*>${label}`).exec(html)?.[1] ?? '';
    expect(button('Deny')).toContain('MuiButton-outlined');
    expect(button('Allow connection')).toContain('MuiButton-contained');
    for (const label of ['Deny', 'Allow connection'])
      expect(button(label), label).toContain('MuiButton-fullWidth');
  });

  it('still lets the member Deny while no Group is picked (#617)', () => {
    const html = markup(
      createElement(ConsentChoice, {
        name: 'Fictional Assistant',
        disabled: false,
        allowBlocked: true,
        onAllow: () => {},
        onDeny: () => {},
      }),
    );
    const button = (label: string) => new RegExp(`<button([^>]*)>${label}`).exec(html)?.[1] ?? '';
    expect(button('Allow connection')).toMatch(/\bdisabled=""/);
    expect(button('Deny')).not.toMatch(/\bdisabled=""/);
  });

  it.each([[['ledger:read']], [['ledger:read', MCP_DRAFT_SCOPE, 'offline_access']]])(
    'says what the assistant can’t do on every approval (#614): %j',
    (scopes) => {
      const shown = permissions(scopes);
      expect(shown).toContain('What Fictional Assistant can’t do');
      // "See Groups left out" since the server leaves them out (#617).
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

  it('lists the member’s Groups, all ticked, and warns that unticked Groups are left out (#617)', () => {
    const html = groupChoice([]);
    const shown = text(html);
    expect(shown).toContain('Which Groups');
    for (const line of [
      'Maple House',
      'Household · INR',
      'Goa Friends Trip',
      'Trip · INR',
      'Lisbon Offsite',
      'Work · EUR · Archived',
    ])
      expect(shown).toContain(line);
    expect(html.match(/<input[^>]*type="checkbox"[^>]*>/g)).toHaveLength(3);
    expect(html.match(/<input[^>]*checked=""[^>]*>/g)).toHaveLength(3);
    expect(shown).toContain('Groups you join later are included.');
    expect(shown).toContain('Groups you untick are left out of');
    expect(html).toContain(
      '<bdi>Fictional Assistant</bdi>’s answers, so its totals won’t include them.',
    );
  });

  it('asks for at least one Group when every Group is unticked (#617)', () => {
    const html = groupChoice(groups.map((group) => group.id));
    expect(html.match(/<input[^>]*checked=""[^>]*>/g)).toBeNull();
    expect(text(html)).toContain('Pick at least one Group.');
  });

  it('says Groups joined later are included when the member has none yet (#617)', () => {
    const shown = text(groupChoice([], []));
    expect(shown).toContain('Groups you join later are included.');
    expect(shown).not.toContain('Pick at least one Group.');
  });

  it('no longer says the assistant reaches every Group: the checklist decides (#617)', () => {
    const shown = render(
      createElement(OAuthFlow, { query: '', consent: true, account, groups: [...groups] }),
    );
    expect(shown).not.toContain('This connection can access all Groups');
  });

  it('sends the Groups left out with an Allow, and nothing about Groups with a Deny (#617)', () => {
    const scopes = ['ledger:read', MCP_DRAFT_SCOPE, 'offline_access'];
    const excluded = ['b00000000000000000000002'];
    expect(
      consentRequest({ query: 'signed', accept: true, scopes, drafts: false, excluded }),
    ).toEqual({
      oauth_query: 'signed',
      accept: true,
      scope: 'ledger:read offline_access',
      excluded_groups: excluded,
    });
    expect(
      consentRequest({ query: 'signed', accept: false, scopes, drafts: true, excluded }),
    ).toEqual({
      oauth_query: 'signed',
      accept: false,
      scope: `ledger:read ${MCP_DRAFT_SCOPE} offline_access`,
    });
  });

  it('says nothing about To review when the assistant asks only to read the ledger', () => {
    const shown = permissions(['ledger:read']);
    expect(shown).toContain(
      'Read only: answer questions about your Groups, balances and Expenses.',
    );
    expect(shown).not.toContain('Ledger permission');
    // Only what the tools answer: no Activity, and payments only through balances.
    expect(shown).not.toContain('recent changes');
    expect(shown).not.toContain('To review');
  });
});
