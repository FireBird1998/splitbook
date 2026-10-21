import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SWRConfig } from 'swr';
import { describe, expect, it } from 'vitest';
import type { AssistantRule } from '@splitbook/shared/assistant-rule';
import AssistantRuleSection, { assistantRuleChange } from './AssistantRuleSection';

/*
 * #621: a Group's Assistant rule in its settings. Everyone sees the rule; admins change it and see
 * whose assistants reach the Group. Rendered as the server renders it, with the reach read
 * answered from SWR's cache.
 */

const GROUP = 'b00000000000000000000010';
const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const MEMBERS = [
  { user: { _id: ALEX, name: 'Alex Rivera' }, role: 'admin' as const },
  { user: { _id: SAM, name: 'Sam Chen' }, role: 'member' as const },
  { user: { _id: PRIYA, name: 'Priya Shah' }, role: 'admin' as const },
];
const REACH = `/api/groups/${GROUP}/assistant-reach`;

function section(viewerId: string, rule: AssistantRule, reach: unknown[] = []) {
  return renderToStaticMarkup(
    createElement(
      SWRConfig,
      { value: { fallback: { [REACH]: { reach } }, provider: () => new Map() } },
      createElement(AssistantRuleSection, {
        groupId: GROUP,
        groupName: 'Maple House',
        rule,
        members: MEMBERS,
        viewerId,
        onSaved: () => {},
        onNotify: () => {},
      }),
    ),
  );
}

const text = (html: string) =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, '’')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('a Group’s Assistant rule in its settings (#621)', () => {
  it('lets an admin choose the rule, naming who else may change it', () => {
    const html = section(ALEX, 'allowed');
    expect(text(html)).toContain('Only admins can change this: you and Priya Shah.');
    const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(
      radios.map((radio) => [/value="(\w+)"/.exec(radio)?.[1], radio.includes('checked')]),
    ).toEqual([
      ['allowed', true],
      ['not_allowed', false],
    ]);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Save changes<\/button>/);
  });

  it('shows an admin each member’s assistants that reach the Group, and members without one', () => {
    const page = text(
      section(ALEX, 'allowed', [
        {
          member: { id: SAM, name: 'Sam Chen' },
          assistant: 'Fictional Helper',
          lastUsedAt: null,
        },
      ]),
    );
    expect(page).toContain('Who’s connected here');
    expect(page).toMatch(/Sam Chen Member Fictional Helper · Not used yet/);
    expect(page).toMatch(/Priya Shah Admin No assistant connected/);
  });

  it('tells an admin no assistant reaches a Not allowed Group', () => {
    const page = text(section(PRIYA, 'not_allowed'));
    expect(page).toContain('No assistant can reach Maple House while assistants are Not allowed.');
    expect(page).not.toContain('No assistant connected');
  });

  it('shows a member only the rule and who sets it', () => {
    for (const rule of ['allowed', 'not_allowed'] as const) {
      const html = section(SAM, rule);
      const page = text(html);
      expect(page).toContain(rule === 'allowed' ? 'Allowed' : 'Not allowed');
      expect(page).toContain('Only admins can change this: Alex Rivera and Priya Shah.');
      expect(html).not.toContain('type="radio"');
      expect(page).not.toContain('Save changes');
      expect(page).not.toContain('Who’s connected here');
    }
  });

  it('says what saving a new rule does before the admin saves it', () => {
    expect(assistantRuleChange('Maple House', 'allowed', 'not_allowed')).toBe(
      'If you save, every member’s assistant loses Maple House at once. Drafts members already have stay in their To review.',
    );
    expect(assistantRuleChange('Maple House', 'not_allowed', 'allowed')).toBe(
      'If you save, members’ assistants can reach Maple House again, except where a member left it out.',
    );
    expect(assistantRuleChange('Maple House', 'allowed', 'allowed')).toBeNull();
  });
});
