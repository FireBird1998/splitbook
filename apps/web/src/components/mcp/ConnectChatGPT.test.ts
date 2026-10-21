import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it } from 'vitest';
import { createAppTheme } from '@/lib/theme/createAppTheme';
import { text } from '@/lib/test-utils/markup';
import ConnectChatGPT from './ConnectChatGPT';

/* The Connect ChatGPT guide, rendered to static markup. */

const guide = (canPrepare = true) =>
  text(
    renderToStaticMarkup(
      createElement(
        ThemeProvider,
        { theme: createAppTheme('light') },
        createElement(ConnectChatGPT, { resource: 'https://splitbook.example/mcp', canPrepare }),
      ),
    ),
  );

describe('the Connect ChatGPT guide', () => {
  it('names the product Splitbook throughout (#595)', () => {
    const shown = guide();
    expect(shown).toContain('Splitbook home');
    expect(shown).toContain('Give it the name Splitbook and a description');
    expect(shown).toContain('Sign in to Splitbook when prompted.');
    expect(shown).toContain('select your Splitbook plugin');
    expect(shown).toContain('Use your invited Splitbook beta account.');
    expect(shown).not.toContain('SplitBook');
  });

  it('says read-only access can’t see To review, in the Glossary’s words (#579)', () => {
    const shown = guide();
    expect(shown).toContain(
      'You choose which Groups ChatGPT reaches when you approve, and Groups you join later are included. Read-only ledger access cannot save Expenses or see what’s in your To review.',
    );
    expect(shown).not.toMatch(/private Drafts?/i);
    // Members choose the Groups since Excluded Groups (#617).
    expect(shown).not.toContain('All current and future Groups');
  });

  it('calls it To review access where it is offered, in the Glossary’s words (#619)', () => {
    expect(guide()).toContain('leave To review access off');
    expect(guide()).not.toMatch(/Draft access/);
    expect(guide(false)).not.toContain('To review access');
  });
});
