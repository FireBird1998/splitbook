import {
  test as base,
  expect,
  request,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import { DEMO_PERSONA_IDS, type DemoPersonaKey } from '../src/lib/demo-personas';

export async function dataOf(response: APIResponse, status = 200) {
  expect(response.status(), await response.text()).toBe(status);
  return (await response.json()).data;
}

async function login(baseURL: string, persona: DemoPersonaKey) {
  const context = await request.newContext({ baseURL });
  const { csrfToken } = await (await context.get('/api/auth/csrf')).json();
  await context.post('/api/auth/callback/demo', {
    form: { csrfToken, personaId: persona, callbackUrl: `${baseURL}/dashboard` },
    maxRedirects: 0,
  });
  const session = await (await context.get('/api/auth/session')).json();
  expect(session.user.id).toBe(DEMO_PERSONA_IDS[persona]);
  return context;
}

export async function joinGroup(
  owner: APIRequestContext,
  member: APIRequestContext,
  groupId: string,
) {
  const invite = await dataOf(
    await owner.post(`/api/groups/${groupId}/invite-link`, { data: {} }),
    201,
  );
  await dataOf(await member.post(`/api/join/${invite.inviteCode}`), 201);
}

export const expensePath = (group: string, expense: string) =>
  `/api/groups/${group}/expenses/${expense}`;

export type Ledger = {
  alex: APIRequestContext;
  sam: APIRequestContext;
  priya: APIRequestContext;
  anonymous: APIRequestContext;
  groupA: string;
  groupB: string;
  expenseA: string;
  expenseB: string;
};

export const test = base.extend<{ ledger: Ledger }>({
  ledger: async ({}, provideLedger) => {
    const baseURL = process.env.EXPENSE_ACCESS_BASE_URL;
    if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL))
      throw new Error('Run with isolated expense-access config');
    const alex = await login(baseURL, 'alex');
    const sam = await login(baseURL, 'sam');
    const priya = await login(baseURL, 'priya');
    const anonymous = await request.newContext({ baseURL });
    try {
      const groupBody = {
        name: 'Synthetic access household',
        category: 'home',
        defaultCurrency: 'INR',
        alternateCurrencies: [],
      };
      const groupA = (await dataOf(await alex.post('/api/groups', { data: groupBody }), 201))._id;
      const groupB = (await dataOf(await priya.post('/api/groups', { data: groupBody }), 201))._id;
      await joinGroup(priya, sam, groupB);
      const create = async (owner: APIRequestContext, group: string, payer: string) =>
        dataOf(
          await owner.post(`/api/groups/${group}/expenses`, {
            data: {
              description: 'Private rent',
              amount: 1200,
              currency: 'INR',
              category: 'housing',
              tag: 'Rent',
              date: new Date().toISOString(),
              paidBy: [{ user: payer, amount: 1200 }],
              splitMethod: 'equal',
              splitBetween: [{ user: payer }],
            },
          }),
          201,
        );
      const expenseA = (await create(alex, groupA, DEMO_PERSONA_IDS.alex))._id;
      const expenseB = (await create(priya, groupB, DEMO_PERSONA_IDS.priya))._id;
      await provideLedger({ alex, sam, priya, anonymous, groupA, groupB, expenseA, expenseB });
    } finally {
      await Promise.all([alex, sam, priya, anonymous].map((context) => context.dispose()));
    }
  },
});

export { expect };

/** Generate through the existing template request, rather than faking origin metadata. */
export async function generatedExpense(ledger: Ledger): Promise<string> {
  const now = new Date();
  const startsOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const template = await dataOf(
    await ledger.priya.post(`/api/groups/${ledger.groupB}/recurring`, {
      data: {
        description: 'Generated rent',
        amount: 1200,
        currency: 'INR',
        category: 'housing',
        tag: 'Rent',
        paidBy: [{ user: DEMO_PERSONA_IDS.priya, amount: 1200 }],
        splitMethod: 'equal',
        splitBetween: [{ user: DEMO_PERSONA_IDS.priya }],
        dayOfMonth: 1,
        startsOn,
      },
    }),
    201,
  );
  const list = await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/expenses`));
  const expense = list.expenses.find(
    (item: { recurringExpense: string }) => item.recurringExpense === template._id,
  );
  expect(expense).toMatchObject({ description: 'Generated rent', amount: 1200, isDeleted: false });
  return expense._id;
}

export async function observeLedger(ledger: Ledger, expense: string) {
  return {
    expense: await dataOf(await ledger.priya.get(expensePath(ledger.groupB, expense))),
    activityA: await dataOf(await ledger.alex.get(`/api/groups/${ledger.groupA}/activity`)),
    activityB: await dataOf(await ledger.priya.get(`/api/groups/${ledger.groupB}/activity`)),
  };
}
