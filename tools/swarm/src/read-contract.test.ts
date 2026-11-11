import { expect, it } from 'vitest';
import { checkReadSources } from './read-contract.ts';

const service = {
  path: 'apps/web/src/lib/services/group.service.ts',
  source: 'export const groupService = { async isMember(id, actor) { return true; } };',
};
const route = (source: string) => ({ path: 'apps/web/src/app/api/groups/[id]/route.ts', source });

it('refuses a route that decides membership for its own read', () => {
  expect(
    checkReadSources([
      service,
      route(`import {groupService as groups} from '@/lib/services/group.service';
        export async function GET() {
          if (!await groups.isMember(id, actor)) return forbidden();
          return success(await expenses(id));
        }`),
    ]),
  ).toMatchObject([
    { path: 'apps/web/src/app/api/groups/[id]/route.ts', within: 'GET', operation: 'membership' },
  ]);
});

it.each([
  "const filter = {'members.user': actor}; Groups.find(filter);",
  "Groups.findOne({members: {$elemMatch: {user: actor, role: 'admin'}}});",
  "db.collection('groups').findOne({'members.user': actor});",
  'group.members.some(member => member.user === actor);',
])('refuses a local membership filter or predicate (%s)', (source) => {
  expect(
    checkReadSources([
      {
        path: 'apps/web/src/lib/models/Group.ts',
        source: 'const Group = {}; export default Group;',
      },
      route(`import Groups from '@/lib/models/Group'; export async function GET() { ${source} }`),
    ]),
  ).toMatchObject([{ operation: 'membership' }]);
});

const generator = {
  path: 'apps/web/src/lib/services/recurring-expense.service.ts',
  source:
    'export const recurringExpenseService = { generateDueExpenses() {}, generateDueExpensesForGroups() {}, materializeDueExpenses() {} };',
};
it.each(['generateDueExpenses', 'generateDueExpensesForGroups', 'materializeDueExpenses'])(
  'refuses a read calling the generator through an alias (%s)',
  (method) => {
    expect(
      checkReadSources([
        generator,
        route(`
      import {recurringExpenseService as recurring} from '@/lib/services/recurring-expense.service';
      const {${method}: generate} = recurring;
      export async function GET() { await generate(id); }
    `),
      ]),
    ).toMatchObject([{ operation: 'recurring' }]);
  },
);

const insight = {
  path: 'apps/web/src/lib/services/group-insights.service.ts',
  source: 'export async function getGroupInsights(groupOrId) {}',
};
const reader = {
  path: 'apps/web/src/lib/group-ledger-read.ts',
  source: 'export async function readGroupLedger(description) {}',
};
it.each([
  'getGroupInsights(id);',
  'readGroupLedger({read: async group => getGroupInsights(id)});',
  'const read = async group => getGroupInsights(group); read({});',
])('refuses the bare-id service trap outside an admitted callback (%s)', (body) => {
  expect(
    checkReadSources([
      insight,
      reader,
      route(`
    import {getGroupInsights} from '@/lib/services/group-insights.service';
    import {readGroupLedger} from '@/lib/group-ledger-read';
    ${body}
  `),
    ]),
  ).toMatchObject([{ operation: 'unadmitted-service' }]);
});
it('allows Insights with the Group supplied by the module, including a callback alias', () => {
  expect(
    checkReadSources([
      insight,
      reader,
      route(`
    import {getGroupInsights as insights} from '@/lib/services/group-insights.service';
    import {readGroupLedger as ledger} from '@/lib/group-ledger-read';
    const query = async (group, storedGroup) => { const admitted = storedGroup; return insights(admitted); };
    ledger({read: query});
  `),
    ]),
  ).toEqual([]);
});

it('binds old service gates through method aliases and re-exports', () => {
  expect(
    checkReadSources([
      service,
      {
        path: 'apps/web/src/lib/groups.ts',
        source: "export {groupService as groups} from './services/group.service';",
      },
      route(
        "import {groups} from '@/lib/groups'; const gate = groups.isMember; export const GET = async () => gate(id, actor);",
      ),
    ]),
  ).toMatchObject([{ operation: 'membership', within: 'GET' }]);
});
it('checks Trip summary by the same admitted-Group rule', () => {
  expect(
    checkReadSources([
      {
        path: 'apps/web/src/lib/services/trip-summary.service.ts',
        source: 'export async function getTripSummary(group) {}',
      },
      route(
        "import {getTripSummary as summary} from '@/lib/services/trip-summary.service'; summary(id);",
      ),
    ]),
  ).toMatchObject([{ operation: 'unadmitted-service' }]);
});
it('pins exceptions to one site and owner, and refuses changed, duplicated or missing sites', () => {
  const input = [
    service,
    route(
      "import {groupService} from '@/lib/services/group.service'; export async function POST() { return groupService.isMember(id, actor); }",
    ),
  ] as const;
  const [finding] = checkReadSources(input);
  const exception = { ...finding!, reason: 'Membership checked for the write.' };
  expect(checkReadSources(input, [exception])).toEqual([]);
  expect(checkReadSources([], [exception])).toMatchObject([
    { message: expect.stringContaining('Unused') },
  ]);
  expect(checkReadSources(input, [exception, exception])).toHaveLength(1);
  expect(
    checkReadSources([service, route(input[1].source.replace('POST()', 'GET()'))], [exception]),
  ).toHaveLength(2);
  expect(
    checkReadSources(
      [service, route(input[1].source.replace('id, actor', 'other, actor'))],
      [exception],
    ),
  ).toHaveLength(2);
});
it('permits the module, tests and fixtures, and ignores population rather than treating it as access', () => {
  expect(
    checkReadSources([
      generator,
      ...['group-ledger-read.ts', 'example.test.ts', 'test-utils/example.ts'].map((name) => ({
        path: 'apps/web/src/lib/' + name,
        source:
          "import {recurringExpenseService} from './services/recurring-expense.service'; recurringExpenseService.generateDueExpenses(id);",
      })),
      route("Group.populate(group, {path: 'members.user'}); unrelated.isMember();"),
    ]),
  ).toEqual([]);
});
