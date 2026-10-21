import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PreparedBy from './PreparedBy';

/*
 * #751: an assistant's credit, which the Expense card, the Expense table, Activity and Expense
 * details all show through PreparedBy. A host with no hyphens can't wrap at its dots, so the
 * credit wraps anywhere, and its end, where the domain is, stays inside its box.
 */

const host = 'chatgpt.com.secureassistantconnectorportal.evil.example';
const credit = (inline: boolean) =>
  renderToStaticMarkup(
    createElement(PreparedBy, { value: { kind: 'assistant', name: host }, inline }),
  );

describe('an assistant’s credit (#751)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('wraps a long host anywhere, inline after the payer or on its own line', () => {
    vi.stubEnv('NEXT_PUBLIC_PERSISTENT_DRAFTS_ENABLED', 'true');
    for (const inline of [true, false]) {
      const html = credit(inline);
      expect(html, String(inline)).toContain(`<bdi style="overflow-wrap:anywhere">${host}</bdi>`);
    }
    expect(credit(true)).toContain(' · prepared by ');
    expect(credit(false)).toContain('Prepared by ');
  });
});
