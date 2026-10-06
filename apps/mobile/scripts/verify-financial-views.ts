/**
 * Ticket #51: native controller → real HTTP → isolated fictional ledger.
 * --seed-fixtures PATH retains a native-QA manifest, never credentials.
 * --cleanup-fixtures PATH archives only Groups verified against that run identity.
 * A normal run creates and archives its own fixtures; it never resets a database.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createMobileController, type MobileController, type MobileFetch } from '../src/data';
import { decodeStoredSession } from '../src/data/cookies';
import type { HomeCurrencyBalance } from '../src/data/types';
import {
  alexId,
  samId,
  FixtureActor,
  archiveFinancialFixtures,
  createFinancialFixtures,
  fixtureManifestSchema,
  homeResponse,
  type FinancialFixtures,
} from './financial-view-fixtures';
import { localOrigin } from './verification-origin';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function assertCleared(controller: MobileController) {
  const state = controller.getSnapshot();
  assert.ok(
    state.auth.status === 'signed-out' && state.auth.user === null,
    'Sign-out retained an account.',
  );
  assert.ok(
    state.home.data === null &&
      state.financial.groupId === null &&
      state.financial.expenses.data.length === 0 &&
      state.financial.balances.data === null,
    'Sign-out or a late response retained financial content.',
  );
}

async function verifyController(
  fixtures: FinancialFixtures,
  baseline: ReturnType<typeof homeResponse.parse>['data'],
  observer: FixtureActor,
) {
  const origin = localOrigin();
  let cookie: string | null = null;
  const ownedCookies = new Set<string>();
  let holdExpenseRead = false;
  const held = deferred<AbortSignal>();
  const release = deferred<void>();
  const transport: MobileFetch = async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, origin, 'A controller request attempted a nonlocal target.');
    assert.ok(
      !init.method ||
        init.method === 'GET' ||
        (init.method === 'POST' &&
          ['/api/auth/demo-persona/sign-in', '/api/auth/sign-out'].includes(target.pathname)),
      'The financial read verifier attempted a ledger write.',
    );
    const delaying =
      holdExpenseRead && target.pathname === `/api/groups/${fixtures.groups.household}/expenses`;
    if (delaying) holdExpenseRead = false;
    const response = await fetch(url, { ...init, redirect: 'error' });
    if (!delaying) return response;
    assert.ok(
      response.ok && init.signal,
      'The real delayed expense response was not successful or cancellable.',
    );
    const completed = new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: response.headers,
    });
    held.resolve(init.signal);
    await release.promise;
    return completed;
  };
  const credentials = {
    load: async () => cookie,
    save: async (value: string) => {
      cookie = value;
      // The saved session is the cookie and, once verified, its account (#200).
      ownedCookies.add(decodeStoredSession(value, origin.startsWith('https:'))?.cookie ?? value);
    },
    clear: async () => {
      cookie = null;
    },
  };
  const build = () =>
    createMobileController(
      { apiBaseUrl: origin, authOrigin: origin, developmentPersonaEnabled: true },
      { fetch: transport, credentials },
    );
  let controller = build();
  try {
    await controller.signIn('sam');
    assert.equal(
      controller.getSnapshot().auth.user?.id,
      samId,
      'Sam did not authenticate through the controller.',
    );
    await controller.refreshHome();
    const home = controller.getSnapshot().home;
    assert.ok(home.status === 'ready' && home.data, 'The controller did not load Home balances.');
    for (const [currency, payable, receivable] of [
      ['INR', 30, 50],
      ['EUR', 12.34, 5.67],
    ] as const) {
      const before = baseline.buckets.find((bucket) => bucket.currency === currency);
      const bucket: HomeCurrencyBalance | undefined = home.data.find(
        (item) => item.currency === currency,
      );
      assert.ok(bucket, 'Home omitted a fixture currency.');
      assert.equal(
        bucket.youOwe,
        Number(((before?.youOwe ?? 0) + payable).toFixed(2)),
        'Home payable obligations were netted away or converted.',
      );
      assert.equal(
        bucket.youAreOwed,
        Number(((before?.youAreOwed ?? 0) + receivable).toFixed(2)),
        'Home receivable obligations were netted away or converted.',
      );
    }
    const observed = homeResponse.parse(await observer.request('/api/user/balances')).data;
    for (const [groupId, currency, amount] of [
      [fixtures.groups.household, 'INR', -30],
      [fixtures.groups.inrReceivable, 'INR', 50],
      [fixtures.groups.eurPayable, 'EUR', -12.34],
      [fixtures.groups.eurReceivable, 'EUR', 5.67],
    ] as const) {
      const group = observed.groups.find((item) => item.groupId === groupId);
      assert.ok(
        group?.balances.length === 1 &&
          group.balances[0].currency === currency &&
          group.balances[0].balance === amount,
        'A fixture Group did not produce its literal expected obligation.',
      );
    }

    await controller.openGroup(fixtures.groups.household);
    const household = controller.getSnapshot().detail.data;
    assert.ok(
      household?.category === 'home' && household.startDate === null && household.endDate === null,
      'Household acquired Trip dates or the wrong theme.',
    );
    const balance = controller.getSnapshot().financial.balances;
    assert.ok(balance.status === 'ready' && balance.data, 'Running balances did not load.');
    const inr = balance.data.find((bucket) => bucket.currency === 'INR');
    assert.ok(
      inr?.balances.find((row) => row.user.id === samId)?.balance === -30 &&
        inr.debts.some(
          (debt) => debt.from.id === samId && debt.to.id === alexId && debt.amount === 30,
        ),
      'The Household running balance did not match the entire ledger.',
    );
    const running = JSON.stringify(balance.data);

    await controller.selectMonth(fixtures.month);
    let expenses = controller.getSnapshot().financial.expenses;
    assert.ok(
      expenses.status === 'ready' &&
        expenses.pagination?.total === 22 &&
        expenses.pagination.totalPages === 2 &&
        expenses.data.length === 20,
      'The selected local Month did not paginate its 22 matching expenses.',
    );
    assert.ok(
      expenses.summary?.count === 22 &&
        expenses.summary.totalsByCurrency.length === 1 &&
        expenses.summary.totalsByCurrency[0].currency === 'INR' &&
        expenses.summary.totalsByCurrency[0].totalAmount === 25 &&
        expenses.summary.userOwes === 25 &&
        expenses.summary.userGetsBack === 0,
      'The Month summary did not describe the full expense window separately from running debt.',
    );
    await controller.loadMoreExpenses();
    expenses = controller.getSnapshot().financial.expenses;
    const expected = [fixtures.expenses.start, ...fixtures.expenses.middle, fixtures.expenses.end];
    assert.ok(
      expenses.data.length === 22 &&
        new Set(expenses.data.map((expense) => expense.id)).size === 22 &&
        expected.every((expenseId) => expenses.data.some((expense) => expense.id === expenseId)) &&
        !expenses.data.some((expense) =>
          [fixtures.expenses.before, fixtures.expenses.after].includes(expense.id),
        ),
      'Pagination duplicated rows or local Month boundaries included the wrong records.',
    );
    assert.ok(
      expenses.data.every(
        (expense, index, rows) =>
          expense.groupId === fixtures.groups.household &&
          expense.currency === 'INR' &&
          expense.amountMinor === expense.amount * 100 &&
          expense.date instanceof Date &&
          expense.tag === 'QA51 month boundary' &&
          expense.tagId &&
          expense.paidBy[0]?.user.id === alexId &&
          expense.paidBy[0]?.user.name === 'Alex Rivera' &&
          expense.splitBetween[0]?.user.id === samId &&
          expense.splitBetween[0]?.user.name === 'Sam Chen' &&
          (index === 0 || rows[index - 1].date.getTime() >= expense.date.getTime()),
      ),
      'Expense money, Tag identity, member attribution, dates, or order did not survive the wire boundary.',
    );
    assert.equal(
      JSON.stringify(controller.getSnapshot().financial.balances.data),
      running,
      'Selecting a Month changed running balances.',
    );

    await controller.selectMonth('2000-01');
    expenses = controller.getSnapshot().financial.expenses;
    assert.ok(
      expenses.status === 'ready' &&
        expenses.data.length === 0 &&
        expenses.summary?.count === 0 &&
        expenses.summary.totalsByCurrency.length === 0 &&
        expenses.summary.userOwes === 0,
      'An empty past Month was not an understandable empty result.',
    );
    assert.equal(
      JSON.stringify(controller.getSnapshot().financial.balances.data),
      running,
      'An empty Month reset running balances.',
    );
    await controller.selectMonth(null);
    assert.equal(
      controller.getSnapshot().financial.expenses.pagination?.total,
      24,
      'All time did not restore the full expense count.',
    );
    await controller.loadMoreExpenses();
    assert.equal(
      controller.getSnapshot().financial.expenses.data.length,
      24,
      'All-time pagination lost records.',
    );
    // A refresh reads the loaded pages again, and keeps them (#219, M1-3).
    await controller.refreshExpenses();
    assert.ok(
      controller.getSnapshot().financial.expenses.data.length === 24 &&
        controller.getSnapshot().financial.expenses.pagination?.page === 2,
      'Refresh did not read the loaded pages again.',
    );
    await controller.refreshBalances();
    assert.equal(
      JSON.stringify(controller.getSnapshot().financial.balances.data),
      running,
      'Month reads changed the backend running balance.',
    );

    await controller.openGroup(fixtures.groups.inrReceivable);
    const trip = controller.getSnapshot().detail.data;
    assert.ok(
      trip?.category === 'trip' &&
        trip.startDate instanceof Date &&
        trip.endDate instanceof Date &&
        controller.getSnapshot().financial.month === null,
      'Trip itinerary dates or all-time expense mode were lost.',
    );
    await controller.openGroup(fixtures.groups.eurPayable);
    assert.ok(
      controller.getSnapshot().financial.expenses.data[0]?.amountMinor === 1234 &&
        controller.getSnapshot().financial.expenses.data[0]?.currency === 'EUR',
      'EUR exact money was not read independently.',
    );

    // Existing isolated private Group: a real denied read must clear the prior ledger.
    await controller.openGroup('a00000000000000000000030');
    assert.ok(
      controller.getSnapshot().detail.status === 'denied' &&
        controller.getSnapshot().financial.expenses.data.length === 0 &&
        controller.getSnapshot().financial.balances.data === null,
      'Denied Group access retained previous financial data.',
    );
    await controller.openGroup(fixtures.groups.household);
    holdExpenseRead = true;
    const pending = controller.refreshExpenses();
    const signal = await Promise.race([
      held.promise,
      new Promise<never>((_, reject) => {
        const timeout = setTimeout(() => reject(new Error('Held expense read timed out.')), 30_000);
        timeout.unref();
      }),
    ]);
    await controller.signOut();
    assert.ok(signal.aborted, 'Sign-out did not abort the pending expense request.');
    assertCleared(controller);
    release.resolve();
    await pending;
    assertCleared(controller);
    controller.dispose();
    controller = build();
    await controller.restore();
    assertCleared(controller);
    await controller.signIn('alex');
    assert.equal(
      controller.getSnapshot().auth.user?.id,
      alexId,
      'The next account did not authenticate.',
    );
    assert.ok(
      controller.getSnapshot().financial.groupId === null &&
        controller.getSnapshot().financial.expenses.data.length === 0,
      'The next account received the prior account’s open ledger.',
    );
    console.log(
      'PASS: separate INR/EUR Home obligations, exact expense reads, local Month boundaries, pagination, empty Month, unchanged running balances, Trip dates, refresh, denied access, late-response logout, restart, and account isolation.',
    );
  } finally {
    release.resolve();
    await controller.signOut();
    controller.dispose();
    for (const ownedCookie of ownedCookies) {
      const response = await fetch(`${origin}/api/auth/sign-out`, {
        method: 'POST',
        headers: { Cookie: ownedCookie, Origin: origin, 'Content-Type': 'application/json' },
        body: '{}',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      assert.ok(response.ok, 'Could not revoke a verifier-owned session.');
    }
  }
}

async function main() {
  const [mode, manifestPath, ...extra] = process.argv.slice(2);
  assert.ok(
    !mode ||
      (['--seed-fixtures', '--keep-fixtures', '--cleanup-fixtures'].includes(mode) &&
        manifestPath &&
        isAbsolute(manifestPath) &&
        extra.length === 0),
    'Use no arguments, or --seed-fixtures/--keep-fixtures/--cleanup-fixtures with an absolute manifest path.',
  );
  const alex = new FixtureActor();
  const sam = new FixtureActor();
  let fixtures: FinancialFixtures | undefined;
  let retained = false;
  try {
    await alex.signIn('alex');
    if (mode === '--cleanup-fixtures') {
      const manifest = fixtureManifestSchema.parse(
        JSON.parse(await readFile(manifestPath, 'utf8')),
      );
      await archiveFinancialFixtures(alex, manifest);
      console.log(
        'PASS: archived the four verified QA51 fictional Groups; all other Groups were untouched.',
      );
      return;
    }
    await sam.signIn('sam');
    const baseline = homeResponse.parse(await sam.request('/api/user/balances')).data;
    fixtures = await createFinancialFixtures(alex, sam);
    if (mode !== '--seed-fixtures') await verifyController(fixtures, baseline, sam);
    if (mode === '--seed-fixtures' || mode === '--keep-fixtures') {
      await writeFile(manifestPath, `${JSON.stringify(fixtures, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      retained = true;
      console.log(`QA51 fictional fixtures retained. Manifest: ${manifestPath}`);
      console.log(
        `Sign in as Sam: ${fixtures.month} has 22 Household expenses / INR 25; running INR 30 owed. Added Home obligations: INR 30 owed / 50 receivable; EUR 12.34 owed / 5.67 receivable. Emulator timezone: Asia/Kolkata.`,
      );
    }
  } finally {
    try {
      if (fixtures && !retained) await archiveFinancialFixtures(alex, fixtures);
    } finally {
      const cleanup = await Promise.allSettled([alex.close(), sam.close()]);
      assert.ok(
        cleanup.every((result) => result.status === 'fulfilled'),
        'Could not revoke every fixture-owned session.',
      );
    }
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof assert.AssertionError
      ? `FAIL: ${error.message}`
      : 'FAIL: financial verification could not complete. Check the isolated backend and fixture manifest; no credentials or responses were logged.',
  );
  process.exitCode = 1;
});
