import { expect, it } from 'vitest';
import Group from '@/lib/models/Group';
import { DEMO_PERSONAS } from '@/lib/demo-personas';
import { readCases, readIds, type readFixture } from './fixture';
import { readGrant, mcpRead } from './mcp';
export const assistantTools = [
  { name: 'list_groups', scope: 'across', args: () => ({}) },
  {
    name: 'group_context',
    scope: 'group',
    args: ({ groupId }: { groupId: string }) => ({ groupId }),
  },
  {
    name: 'group_balances',
    scope: 'group',
    args: ({ groupId }: { groupId: string }) => ({ groupId }),
  },
  {
    name: 'group_spending',
    scope: 'group',
    args: ({ groupId }: { groupId: string }) => ({ groupId, from: '2026-11-01', to: '2026-11-30' }),
  },
  {
    name: 'list_drafts',
    scope: 'group',
    args: ({ groupId }: { groupId: string }) => ({ groupId }),
  },
  {
    name: 'create_drafts',
    scope: 'group',
    args: ({ groupId }: { groupId: string }) => ({
      groupId,
      requestKey: 'read-census-create-0001',
      drafts: [
        { description: 'Assistant-prepared item', amount: 42, currency: 'INR', date: '2026-11-05' },
      ],
    }),
  },
  {
    name: 'replace_draft',
    scope: 'group',
    args: ({ groupId, draftId }: { groupId: string; draftId: string }) => ({
      groupId,
      draftId,
      revision: 0,
      values: { description: 'Assistant-corrected item' },
    }),
  },
  {
    name: 'discard_draft',
    scope: 'group',
    args: ({ groupId, draftId }: { groupId: string; draftId: string }) => ({
      groupId,
      draftId,
      revision: 0,
    }),
  },
] as const;
export const assistantInapplicableCases = {
  list_groups: {
    missing: 'The tool has no Group selector. Its after argument is a pagination cursor.',
    malformed: 'The tool has no Group selector. Its after argument is a pagination cursor.',
  },
  connection_status:
    'This connection tool accepts no Group id and reads no Group. Group membership, archive, deletion, exclusion and Assistant rule do not apply.',
};
type Fixture = ReturnType<typeof readFixture>;
export function assistantReadCases(
  fixture: Fixture,
  tools: readonly (typeof assistantTools)[number][],
) {
  for (const tool of tools) {
    const states = [
      ...readCases.filter(
        (state) => tool.scope === 'group' || !['missing', 'malformed'].includes(state),
      ),
      'excluded',
      'not-allowed',
    ] as const;
    for (const state of states)
      it(`${tool.name} / ${state}`, async () => {
        const access = await fixture.arrange(
          state === 'excluded' || state === 'not-allowed' ? 'member' : state,
        );
        if (state === 'not-allowed')
          await Group.updateOne({ _id: readIds.group }, { $set: { assistantRule: 'not_allowed' } });
        const grant = await readGrant(access.cookie, state === 'excluded' ? [readIds.group] : []);
        const draftId = state === 'admin' ? readIds.otherDraft : readIds.draft;
        const record = await fixture.capture(() =>
          mcpRead(grant.token, tool.name, tool.args({ groupId: access.groupId, draftId })),
        );
        expect(record.addedDueExpense).toBe(false);
        expect(record.answer.status).toBe(200);
        if (state === 'member' || state === 'admin') {
          expect(record.answer).toMatchObject({ result: { content: expect.any(Array) } });
          expect(record.answer.result?.isError).not.toBe(true);
        }
        if (
          tool.scope === 'group' &&
          ['left', 'outsider', 'missing', 'deleting', 'excluded', 'not-allowed'].includes(state)
        )
          expect(record.answer.result?.isError).toBe(true);
        const text = JSON.stringify(record.answer);
        for (const persona of DEMO_PERSONAS) expect(text).not.toContain(persona.email);
        expect(text).not.toContain('https://read-fixture.example.test/photo.png');
      });
  }
}
export function connectionReadCases(fixture: Fixture) {
  for (const revoked of [false, true])
    it(`connection_status / ${revoked ? 'revoked grant' : 'member'}`, async () => {
      const access = await fixture.arrange('member');
      const grant = await readGrant(access.cookie);
      if (revoked) await grant.revoke();
      const record = await fixture.capture(() => mcpRead(grant.token, 'connection_status'));
      expect(record.addedDueExpense).toBe(false);
      expect(record.answer.status).toBe(revoked ? 403 : 200);
    });
}
