/** Public-HTTP fictional fixtures. No database access, reset, or persisted credentials. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readSessionCookie } from '../src/data/cookies';
import { localOrigin } from './verification-origin';

export const alexId = 'a00000000000000000000001';
export const samId = 'a00000000000000000000002';
const id = z.string().regex(/^[a-f\d]{24}$/);
const keys = ['household', 'inrReceivable', 'eurPayable', 'eurReceivable'] as const;
type GroupKey = (typeof keys)[number];
const definitions = {
  household: { label: 'Household INR', category: 'home', currency: 'INR' },
  inrReceivable: { label: 'Trip INR receivable', category: 'trip', currency: 'INR' },
  eurPayable: { label: 'EUR payable', category: 'other', currency: 'EUR' },
  eurReceivable: { label: 'EUR receivable', category: 'other', currency: 'EUR' },
} as const;

export const fixtureManifestSchema = z.object({
  kind: z.literal('splitbook-native-51-fictional-v1'),
  runId: z.uuid(),
  origin: z.string(),
  timezone: z.literal('Asia/Kolkata'),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  groups: z.object({ household: id, inrReceivable: id, eurPayable: id, eurReceivable: id }),
  expenses: z.object({ before: id, start: id, middle: z.array(id).length(20), end: id, after: id }),
});
export type FinancialFixtures = z.infer<typeof fixtureManifestSchema>;

export const homeResponse = z.object({
  data: z.object({
    buckets: z.array(
      z.object({ currency: z.string(), youOwe: z.number(), youAreOwed: z.number() }),
    ),
    groups: z.array(
      z.object({
        groupId: id,
        balances: z.array(z.object({ currency: z.string(), balance: z.number() })),
      }),
    ),
  }),
});
const groupResponse = z.object({
  data: z.object({
    _id: id,
    name: z.string(),
    description: z.string(),
    createdBy: id,
    category: z.string(),
    defaultCurrency: z.string(),
    isArchived: z.boolean(),
    members: z.array(z.object({ user: z.object({ _id: id }), role: z.string() })),
    tags: z.array(z.object({ _id: id, name: z.string() })),
  }),
});
const objectResponse = z.object({ data: z.object({ _id: id }) });

/** A fresh synthetic persona session owned only by this invocation. */
export class FixtureActor {
  private cookie: string | null = null;
  private readonly cookies = new Set<string>();

  constructor(readonly origin = localOrigin()) {
    assert.equal(
      origin,
      localOrigin(),
      'The fixture origin does not match the guarded loopback origin.',
    );
  }

  async request(
    path: string,
    method = 'GET',
    body?: unknown,
    expectedStatus = 200,
  ): Promise<unknown> {
    assert.ok(
      path.startsWith('/api/') && !path.includes('://'),
      'Only local API paths are allowed.',
    );
    const response = await fetch(`${this.origin}${path}`, {
      method,
      headers: {
        Origin: this.origin,
        Accept: 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(method === 'POST' && path.endsWith('/expenses')
          ? { 'Idempotency-Key': randomUUID() }
          : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    const next = readSessionCookie(response.headers, false, Date.now());
    if (next !== undefined) this.cookie = next;
    if (next) this.cookies.add(next);
    assert.ok(
      response.status === expectedStatus,
      `A fictional-fixture ${method} request returned an unexpected status.`,
    );
    return response.json();
  }

  async signIn(persona: 'alex' | 'sam') {
    await this.request('/api/auth/demo-persona/sign-in', 'POST', { personaId: persona });
    const session = z
      .object({ user: z.object({ id }) })
      .parse(await this.request('/api/auth/get-session'));
    assert.equal(
      session.user.id,
      persona === 'alex' ? alexId : samId,
      'The synthetic persona identity did not match.',
    );
  }

  async close() {
    for (const cookie of this.cookies) {
      const response = await fetch(`${this.origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: { Origin: this.origin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      assert.ok(response.ok, 'Could not revoke a fixture-owned authentication session.');
    }
    this.cookie = null;
    this.cookies.clear();
  }
}

const groupName = (runId: string, key: GroupKey) => `QA51 ${runId} ${definitions[key].label}`;
const groupDescription = (runId: string) =>
  `Fictional native ticket 51 verification. Run ${runId}.`;

async function archiveOwnedGroups(
  actor: FixtureActor,
  runId: string,
  groups: Partial<Record<GroupKey, string>>,
) {
  // Preflight every target before changing any of them. A manifest can never
  // turn an arbitrary Group ID into authority to archive that Group.
  const targets = await Promise.all(
    keys.flatMap((key) => {
      const groupId = groups[key];
      return groupId
        ? [
            (async () => {
              const group = groupResponse.parse(await actor.request(`/api/groups/${groupId}`)).data;
              assert.ok(
                group._id === groupId &&
                  group.name === groupName(runId, key) &&
                  group.description === groupDescription(runId) &&
                  group.createdBy === alexId &&
                  group.category === definitions[key].category &&
                  group.defaultCurrency === definitions[key].currency &&
                  group.members.some(
                    (member) => member.user._id === alexId && member.role === 'admin',
                  ),
                'Cleanup refused a Group without this fictional run identity and owner.',
              );
              return group;
            })(),
          ]
        : [];
    }),
  );
  for (const group of targets) {
    if (!group.isArchived) await actor.request(`/api/groups/${group._id}`, 'DELETE');
  }
}

export async function archiveFinancialFixtures(actor: FixtureActor, manifest: FinancialFixtures) {
  assert.equal(manifest.origin, actor.origin, 'Cleanup refused a different fixture origin.');
  await archiveOwnedGroups(actor, manifest.runId, manifest.groups);
}

export async function createFinancialFixtures(
  alex: FixtureActor,
  sam: FixtureActor,
): Promise<FinancialFixtures> {
  assert.ok(process.env.TZ === 'Asia/Kolkata', 'Run this fixture command with TZ=Asia/Kolkata.');
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  const end = new Date(next.getTime() - 1);
  assert.equal(
    start.getTimezoneOffset(),
    -330,
    'The fixture runtime did not apply the non-UTC timezone.',
  );
  const month = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const runId = randomUUID();
  const groups: Partial<Record<GroupKey, string>> = {};
  try {
    for (const key of keys) {
      const definition = definitions[key];
      const group = groupResponse.parse(
        await alex.request(
          '/api/groups',
          'POST',
          {
            name: groupName(runId, key),
            description: groupDescription(runId),
            category: definition.category,
            defaultCurrency: definition.currency,
            alternateCurrencies: [],
            ...(definition.category === 'trip'
              ? { startDate: start.toISOString(), endDate: end.toISOString() }
              : {}),
          },
          201,
        ),
      ).data;
      groups[key] = group._id;
      const invite = z
        .object({ data: z.object({ inviteCode: z.string().regex(/^[a-f\d]{8}$/) }) })
        .parse(await alex.request(`/api/groups/${group._id}/invite-link`, 'POST', {}, 201));
      await sam.request(`/api/join/${invite.data.inviteCode}`, 'POST', undefined, 201);
    }
    const groupIds = fixtureManifestSchema.shape.groups.parse(groups);
    const tagged = groupResponse.parse(
      await alex.request(`/api/groups/${groupIds.household}/tags`, 'POST', {
        name: 'QA51 month boundary',
      }),
    ).data;
    const boundaryTag = tagged.tags.find((tag) => tag.name === 'QA51 month boundary');
    assert.ok(boundaryTag, 'The public Tag request did not create the fictional Tag.');

    const expense = async (
      key: GroupKey,
      description: string,
      amount: number,
      date: Date,
      payer: 'alex' | 'sam',
    ) => {
      const actor = payer === 'alex' ? alex : sam;
      const paidBy = payer === 'alex' ? alexId : samId;
      const owedBy = payer === 'alex' ? samId : alexId;
      return objectResponse.parse(
        await actor.request(
          `/api/groups/${groupIds[key]}/expenses`,
          'POST',
          {
            description,
            amount,
            currency: definitions[key].currency,
            category: 'other',
            ...(key === 'household' ? { tagId: boundaryTag._id } : { tag: 'General' }),
            date: date.toISOString(),
            paidBy: [{ user: paidBy, amount }],
            splitMethod: 'equal',
            splitBetween: [{ user: owedBy }],
          },
          201,
        ),
      ).data._id;
    };
    const before = await expense(
      'household',
      'Just before Month: excluded',
      1,
      new Date(start.getTime() - 1),
      'alex',
    );
    const first = await expense('household', 'At local Month start: included', 2, start, 'alex');
    const middle: string[] = [];
    for (let index = 0; index < 20; index += 1) {
      middle.push(
        await expense(
          'household',
          `Monthly groceries ${String(index + 1).padStart(2, '0')}`,
          1,
          new Date(start.getFullYear(), start.getMonth(), 15, 12, index),
          'alex',
        ),
      );
    }
    const last = await expense('household', 'At local Month end: included', 3, end, 'alex');
    const after = await expense('household', 'At next Month start: excluded', 4, next, 'alex');
    await expense('inrReceivable', 'Trip booking paid by Sam', 50, start, 'sam');
    await expense('eurPayable', 'Museum tickets paid by Alex', 12.34, start, 'alex');
    await expense('eurReceivable', 'Cafe paid by Sam', 5.67, start, 'sam');
    return {
      kind: 'splitbook-native-51-fictional-v1',
      runId,
      origin: alex.origin,
      timezone: 'Asia/Kolkata',
      month,
      groups: groupIds,
      expenses: { before, start: first, middle, end: last, after },
    };
  } catch (error) {
    await archiveOwnedGroups(alex, runId, groups);
    throw error;
  }
}
