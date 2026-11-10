import inputs from './refusal-census-inputs.json';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { MoneyValidationError } from '@splitbook/shared/exact-money';
import { auth } from '@/lib/auth';
import * as response from '@/lib/utils/api-response';
import { draftError } from '@/lib/draft-response';
import { tagError, invalidTagId } from '@/lib/tag-management-http';
import { TagManagementError } from '@/lib/services/tag-management.service';
import { LeaveBlockedError, RemovalBlockedError } from '@/lib/services/group.service';
import { ExportTooLargeError } from '@/lib/services/export.service';
import {
  CurrencyInUseError,
  CurrencyNotListedError,
  CurrencyIsMainError,
} from '@/lib/group-currency-refusals';

vi.mock('@/lib/db', () => ({ default: vi.fn() }));
vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

// Inject at the session boundary to run the real exported handler and its own catch path.
// This pins how a route answers a value, independently of the stored state that produces it.
const routes = import.meta.glob('../app/api/**/route.ts');
const balances = [
  { currency: 'INR', amountMinor: -15000 },
  { currency: 'EUR', amountMinor: 1250 },
];
const recurringExpenses = [{ id: 'a00000000000000000000009', description: 'Rent' }];
const snapshot = {
  canManage: true,
  tags: [{ id: 'tag', name: 'Food', revision: 2, isArchived: false, isDeleted: false }],
};
const codePattern = /^[A-Z][A-Z_]+$/;

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory()
      ? files(path)
      : path.endsWith('.ts') && !path.includes('.test.')
        ? [path]
        : [];
  });
}
function source(path: string) {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
}
function visit(node: ts.Node, work: (node: ts.Node) => void) {
  work(node);
  node.forEachChild((child) => visit(child, work));
}
const sources = [...files(resolve('src')), ...files(resolve('../../packages/shared/src'))];
const plainCodes = new Set(inputs.plainCodes);
const moneyCases = inputs.moneyCases;
const tagCodes = [
  'TAG_PRECONDITION_REQUIRED',
  'INVALID_TAG_COMMAND',
  'TAG_ADMIN_REQUIRED',
  'TAG_TRANSACTIONS_REQUIRED',
  'TAG_CHANGED',
  'TAG_EXISTS',
  'LAST_ACTIVE_TAG',
  'REQUEST_KEY_REUSED',
  'TAG_IN_USE',
  'AMBIGUOUS_TAG',
];
const classCases = [
  new LeaveBlockedError('LAST_ADMIN'),
  new LeaveBlockedError('OPEN_BALANCE', balances),
  new LeaveBlockedError('RECURRING_EXPENSE_PROBLEM', [], recurringExpenses),
  new LeaveBlockedError('RECURRING_EXPENSE_PROBLEM', [], recurringExpenses, true),
  new RemovalBlockedError({ code: 'OPEN_BALANCE', balances }, 'Priya Shah'),
  new RemovalBlockedError({ code: 'RECURRING_EXPENSE_PROBLEM', recurringExpenses }, 'Priya Shah'),
  new ExportTooLargeError(12345, 10000),
  new CurrencyInUseError('EUR', 'Maple House', {
    expenses: { count: 2, items: [] },
    settlements: 1,
    toReview: { yours: 1, others: 0 },
  }),
  new CurrencyNotListedError('EUR'),
  new CurrencyIsMainError('INR'),
  ...tagCodes.map(
    (code) =>
      new TagManagementError(
        code,
        code === 'TAG_PRECONDITION_REQUIRED'
          ? 428
          : code === 'INVALID_TAG_COMMAND'
            ? 400
            : code === 'TAG_ADMIN_REQUIRED'
              ? 403
              : code === 'TAG_TRANSACTIONS_REQUIRED'
                ? 503
                : 409,
        snapshot,
        'existing-tag',
      ),
  ),
];
async function recorded(answer: Response) {
  const body = await answer.text();
  return { status: answer.status, body, hasCode: Object.hasOwn(JSON.parse(body), 'code') };
}
function thrown(cause: Error) {
  return { name: cause.name, message: cause.message, ...Object.fromEntries(Object.entries(cause)) };
}

vi.spyOn(console, 'error').mockImplementation(() => {});

describe('refusal census, recorded on main before the vocabulary (#1079)', () => {
  it('records each plain code through the central and private Draft answering seams', async () => {
    const census = [];
    for (const code of [...plainCodes].sort()) {
      const cause = new Error(code);
      census.push({
        thrown: thrown(cause),
        central: await recorded(response.serverError(cause)),
        draft: await recorded(draftError(cause)),
      });
    }
    expect(census).toMatchSnapshot();
  });
  it('records every literal money wording, with and without its field', async () => {
    const census = [];
    for (const { origin, code, message } of moneyCases) {
      for (const field of [undefined, ['splitBetween', 0, 'amount']]) {
        const cause = new MoneyValidationError(code, message, field);
        census.push({
          origin,
          thrown: thrown(cause),
          answer: await recorded(response.serverError(cause)),
        });
      }
    }
    expect(census).toMatchSnapshot();
  });
  it('records data-carrying classes at their existing answering seams', async () => {
    const census = [];
    for (const cause of classCases)
      census.push({
        thrown: thrown(cause),
        answer: await recorded(
          cause instanceof TagManagementError ? tagError(cause) : response.serverError(cause),
        ),
      });
    expect(census).toMatchSnapshot();
  });
  it('records direct helpers including every resource name routes use', async () => {
    const census = [
      await recorded(response.unauthorized()),
      await recorded(response.forbidden()),
      await recorded(response.notFound()),
      await recorded(invalidTagId()),
    ];
    const resources = new Set<string>();
    for (const path of sources.filter((path) => path.endsWith('/route.ts')))
      visit(source(path), (node) => {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText() === 'notFound' &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        )
          resources.add(node.arguments[0].text);
      });
    for (const resource of [...resources].sort())
      census.push(await recorded(response.notFound(resource)));
    expect(census).toMatchSnapshot();
  });
  for (const [path, load] of Object.entries(routes).sort()) {
    const text = readFileSync(resolve('src/lib', path), 'utf8');
    if (!text.includes('getAuthUser')) continue;
    const codes = inputs.routeCodes[path as keyof typeof inputs.routeCodes];
    it(`records ${path} through its exported handlers`, async () => {
      const route = (await load()) as Record<string, unknown>;
      const census = [];
      const causes = [
        ...codes.map((code) => new Error(code)),
        ...classCases.filter(
          (cause) =>
            text.includes(cause.constructor.name) ||
            (cause instanceof TagManagementError && text.includes('tagError')),
        ),
      ];
      for (const [method, handler] of Object.entries(route)) {
        if (
          !['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].includes(method) ||
          typeof handler !== 'function'
        )
          continue;
        for (const cause of causes) {
          vi.mocked(auth.api.getSession).mockRejectedValue(cause);
          const answer = await handler(new Request('http://localhost/api/census', { method }), {
            params: Promise.resolve({ id: 'a00000000000000000000001' }),
          });
          census.push({ method, thrown: thrown(cause), answer: await recorded(answer) });
        }
      }
      expect(census).toMatchSnapshot();
    });
  }
});

// Baseline inputs remain fixed while services move. New literal producers and route policies
// must already have a recorded input. Removing an old comparison or table needs no re-record.
it('covers every literal producer, route table entry and message comparison', () => {
  const covered = new Set([
    ...plainCodes,
    ...moneyCases.map(({ code }) => code),
    ...tagCodes,
    'CURRENCY_IN_USE',
    'CURRENCY_NOT_LISTED',
    'CURRENCY_IS_MAIN',
    'OPEN_BALANCE',
    'RECURRING_EXPENSE_PROBLEM',
    'EXPORT_TOO_LARGE',
    'DATABASE_UNAVAILABLE',
  ]);
  for (const path of sources) {
    visit(source(path), (node) => {
      if (
        ts.isNewExpression(node) &&
        node.arguments?.[0] &&
        [
          'Error',
          'Refusal',
          'MoneyValidationError',
          'StoredMoneyError',
          'TagManagementError',
        ].includes(node.expression.getText())
      ) {
        const [code, message] = node.arguments;
        if (
          ['MoneyValidationError', 'StoredMoneyError'].includes(node.expression.getText()) &&
          ts.isStringLiteral(code) &&
          message &&
          ts.isStringLiteral(message)
        ) {
          expect(
            moneyCases.some((row) => row.code === code.text && row.message === message.text),
            `${path} words for ${code.text}`,
          ).toBe(true);
        }
        visit(node.arguments[0], (part) => {
          if (ts.isStringLiteral(part) && codePattern.test(part.text))
            expect(covered.has(part.text), `${path} produces ${part.text}`).toBe(true);
        });
      }
    });
  }
  for (const [path, codes] of Object.entries(inputs.routeCodes)) {
    visit(source(resolve('src/lib', path)), (node) => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        codePattern.test(node.name.text)
      )
        expect(codes, path).toContain(node.name.text);
      if (
        ts.isBinaryExpression(node) &&
        /\.message|\.code/.test(node.left.getText()) &&
        ts.isStringLiteral(node.right) &&
        codePattern.test(node.right.text)
      )
        expect(codes, path).toContain(node.right.text);
    });
  }
});

it('records optional Tag payloads and ignores their internal count message', async () => {
  const census = [];
  for (const cause of [
    new TagManagementError('TAG_IN_USE', 409, snapshot, undefined, 'TAG_IN_USE:2:3'),
    new TagManagementError('INVALID_TAG_COMMAND', 400),
  ])
    census.push({ thrown: thrown(cause), answer: await recorded(tagError(cause)) });
  expect(census).toMatchSnapshot();
});

it('records the Connected assistant tools’ own words for every table entry', async () => {
  const { McpServer } = await import('@modelcontextprotocol/server');
  const { registerSplitbookTools } = await import('@/lib/mcp/tools');
  const server = new McpServer({ name: 'census', version: '1' });
  const registered = vi.spyOn(server, 'registerTool');
  const authorize = vi.fn();
  registerSplitbookTools(
    server,
    { id: 'a00000000000000000000001', authorize },
    [],
    'http://localhost',
  );
  const handler = registered.mock.calls.find(([name]) => name === 'list_groups')![2];
  const census = [];
  const text = readFileSync(resolve('src/lib/mcp/tools.ts'), 'utf8');
  const codes = new Set<string>();
  visit(ts.createSourceFile('tools.ts', text, ts.ScriptTarget.Latest, true), (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      codePattern.test(node.name.text)
    )
      codes.add(node.name.text);
  });
  for (const code of [...codes, 'BACKUP_ALL_TIME'].sort()) {
    const cause = new Error(code);
    authorize.mockRejectedValue(cause);
    census.push({ thrown: thrown(cause), answer: await handler({}, {} as never) });
  }
  expect(census).toMatchSnapshot();
});

it('records query and command refusals before any database read', async () => {
  const { groupService } = await import('@/lib/services/group.service');
  const member = vi.spyOn(groupService, 'isMember').mockResolvedValue(true);
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' },
  } as never);
  const census = [];
  const cases = [
    ['groups/[id]/insights', ''],
    ['groups/[id]/insights', '?tz=UTC&month=bad'],
    ['groups/[id]/insights', '?tz=UTC&compare=99'],
    ['groups/[id]/insights', '?tz=UTC&currency=bad'],
    ['groups/[id]/trip-summary', ''],
    ['groups/[id]/trip-summary', '?tz=UTC&currency=bad'],
    ['user/spending', ''],
    ['user/spending', '?tz=UTC&months=99'],
    ['search', '?q=' + 'x'.repeat(201)],
  ];
  for (const [path, query] of cases) {
    const route = (await routes[`../app/api/${path}/route.ts`]()) as {
      GET: (req: Request, context: unknown) => Promise<Response>;
    };
    census.push({
      path,
      query,
      answer: await recorded(
        await route.GET(new Request('http://localhost/api/' + path + query), {
          params: Promise.resolve({ id: 'a00000000000000000000001' }),
        }),
      ),
    });
  }
  member.mockRestore();
  expect(census).toMatchSnapshot();
});

it('records each per-Expense Tag refusal through the bulk HTTP response', async () => {
  const { groupService } = await import('@/lib/services/group.service');
  const { expenseService } = await import('@/lib/services/expense.service');
  const { default: Group } = await import('@/lib/models/Group');
  const { default: Expense } = await import('@/lib/models/Expense');
  const member = vi.spyOn(groupService, 'isMember').mockResolvedValue(true);
  const tagId = 'a00000000000000000000002';
  const expenseId = 'a00000000000000000000003';
  const group = vi
    .spyOn(Group, 'findOne')
    .mockResolvedValue(new Group({ tags: [{ _id: tagId, name: 'Food' }] }));
  const expense = vi
    .spyOn(Expense, 'findOne')
    .mockReturnValue({ select: () => ({ lean: async () => ({ revision: 0 }) }) } as never);
  const update = vi.spyOn(expenseService, 'update');
  const { POST } = await import('@/app/api/groups/[id]/expenses/tag-change/route');
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' },
  } as never);
  const census = [];
  for (const code of [
    'FORBIDDEN',
    'GROUP_ARCHIVED',
    'INVALID_TAG',
    'ACTIVITY_BACKLOG_FULL',
    'UNKNOWN',
  ]) {
    const cause = new Error(code);
    update.mockRejectedValue(cause);
    const answer = await POST(
      new Request('http://localhost/api/tag-change', {
        method: 'POST',
        body: JSON.stringify({ tagId, expenses: [{ id: expenseId, revision: 0 }] }),
      }),
      { params: Promise.resolve({ id: 'a00000000000000000000001' }) },
    );
    census.push({ thrown: thrown(cause), answer: await recorded(answer) });
  }
  update.mockRestore();
  expense.mockRestore();
  group.mockRestore();
  member.mockRestore();
  expect(census).toMatchSnapshot();
});

it('records stale database versions, unreachable databases and unknown thrown values', async () => {
  const { mongo } = await import('mongoose');
  const causes = [
    Object.assign(new Error('revision race'), { name: 'VersionError' }),
    new mongo.MongoNetworkError('read ECONNRESET'),
    new SyntaxError('bad JSON'),
    new Error('unknown fault'),
    null,
    undefined,
    'FORBIDDEN',
  ];
  const census = [];
  for (const cause of causes)
    census.push({
      thrown: cause instanceof Error ? thrown(cause) : { value: cause },
      answer: await recorded(response.serverError(cause)),
    });
  expect(census).toMatchSnapshot();
});

it('records Group currency fields and an already-listed currency’s separate words', async () => {
  const census = [];
  for (const [message, field] of [
    ['EUR is already one of this Group’s currencies.', ['currency']],
    ['EUR is listed twice.', ['alternateCurrencies']],
  ] as const) {
    const cause = new MoneyValidationError('INVALID_GROUP_CURRENCIES', message, field);
    census.push({ thrown: thrown(cause), answer: await recorded(response.serverError(cause)) });
  }
  expect(census).toMatchSnapshot();
});

it('records a non-Trip Group’s direct summary refusal', async () => {
  const { groupService } = await import('@/lib/services/group.service');
  const summary = await import('@/lib/services/trip-summary.service');
  const member = vi.spyOn(groupService, 'isMember').mockResolvedValue(true);
  const read = vi.spyOn(summary, 'getTripSummary').mockResolvedValue({ kind: 'not-a-trip' });
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: 'a00000000000000000000001', name: 'Alex', email: 'alex@example.test' },
  } as never);
  const { GET } = await import('@/app/api/groups/[id]/trip-summary/route');
  const answer = await GET(
    new Request('http://localhost/api/groups/a00000000000000000000001/trip-summary?tz=UTC'),
    { params: Promise.resolve({ id: 'a00000000000000000000001' }) },
  );
  expect(await recorded(answer)).toMatchSnapshot();
  read.mockRestore();
  member.mockRestore();
});
