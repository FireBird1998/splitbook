import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect, dataOf, observeLedger } from './fixtures';

const statementOf = (group: string) => `/groups/${group}/statement?tz=UTC`;
test('statement: a current member can read named contributions', async ({ ledger }) => {
  const response = await ledger.sam.get(statementOf(ledger.groupB), { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  const text = await response.text();
  expect(text).toContain('Private rent');
  expect(text).toContain('Paid, Share and Net');
});
for (const scenario of ['outsider', 'removed', 'missing', 'anonymous'] as const) {
  test(`statement denies ${scenario} without ledger side effects`, async ({ ledger }) => {
    let actor = ledger.alex;
    let target = ledger.groupB;
    if (scenario === 'removed') {
      await dataOf(await ledger.sam.get(`/api/groups/${target}`));
      await dataOf(
        await ledger.priya.delete(`/api/groups/${target}/members/${DEMO_PERSONA_IDS.sam}`),
      );
      actor = ledger.sam;
    } else if (scenario === 'missing') target = 'f00000000000000000000000';
    else if (scenario === 'anonymous') actor = ledger.anonymous;
    const before = await observeLedger(ledger, ledger.expenseB);
    const response = await actor.get(statementOf(target), { maxRedirects: 0 });
    expect(response.status()).toBe(scenario === 'anonymous' ? 307 : 403);
    if (scenario !== 'anonymous') {
      const text = await response.text();
      expect(text).not.toContain('Private rent');
      expect(text).not.toContain('Shared rental');
    }
    expect(await observeLedger(ledger, ledger.expenseB)).toEqual(before);
  });
}
