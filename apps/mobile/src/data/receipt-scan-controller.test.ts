import { describe, expect, it } from 'vitest';
import { createMobileController } from './mobile-controller';
import type { ReceiptScanner } from './receipt-scan';
import type { RecognizedReceipt } from './receipt-total';
import type { MobileFetch } from './types';

const memberIds = ['a00000000000000000000001', 'a00000000000000000000002'];
const inrGroupId = 'a00000000000000000000010';
const eurGroupId = 'a00000000000000000000011';
const tagId = 'a00000000000000000000020';
const iso = '2026-09-28T10:00:00.000Z';
const people = memberIds.map((id, i) => ({
  id,
  name: ['Alex', 'Sam'][i],
  email: `person${i}@example.test`,
  image: null,
}));
const group = (id: string, defaultCurrency: string) => ({
  _id: id,
  createdBy: memberIds[0],
  name: defaultCurrency === 'INR' ? 'Flat' : 'Berlin trip',
  description: '',
  category: 'home',
  defaultCurrency,
  members: people.map(({ id: user, ...rest }) => ({
    user: { _id: user, ...rest },
    role: 'member',
    joinedAt: iso,
  })),
  tags: [{ _id: tagId, name: 'Groceries', isArchived: false, createdAt: iso }],
  createdAt: iso,
  updatedAt: iso,
});
const json = (data: unknown, status = 200, cookie?: string) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });

function receipt(...rows: string[][]): RecognizedReceipt {
  return {
    width: 1080,
    height: 2400,
    lines: rows.flatMap((cells, row) =>
      cells.map((text, column) => ({
        text,
        frame: {
          left: 40 + column * 600,
          top: 200 + row * 80,
          right: 400 + column * 600,
          bottom: 250 + row * 80,
        },
      })),
    ),
  };
}
const toPay = receipt(['Item total', '₹310.00'], ['To Pay', '₹289.86']);

/** A scanner whose result the test releases, to exercise late and cancelled results. */
function controllableScanner() {
  const pending: Array<(result: RecognizedReceipt | null | Error) => void> = [];
  const scanner: ReceiptScanner = {
    scan: () =>
      new Promise((resolve, reject) => {
        pending.push((result) => (result instanceof Error ? reject(result) : resolve(result)));
      }),
  };
  return {
    scanner,
    get calls() {
      return pending.length;
    },
    release: async (result: RecognizedReceipt | null | Error, index = pending.length - 1) => {
      pending[index](result);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

function setup({
  scanner = controllableScanner().scanner,
  enabled = true,
}: { scanner?: ReceiptScanner; enabled?: boolean } = {}) {
  let cookie: string | null = null;
  let account: string | null = null;
  let cleanup = false;
  let signedIn = people[0];
  const records = new Map<string, unknown>();
  const writes: string[] = [];
  const drafts = {
    load: async (accountId: string, id: string) =>
      structuredClone(records.get(`${accountId}:${id}`) ?? null),
    save: async (accountId: string, id: string, value: unknown) => {
      records.set(`${accountId}:${id}`, structuredClone(value));
    },
    remove: async (accountId: string, id: string) => {
      records.delete(`${accountId}:${id}`);
    },
    clear: async () => {
      records.clear();
    },
  };
  const fetch: MobileFetch = async (url, init) => {
    const path = new URL(url).pathname;
    if (init.method && init.method !== 'GET' && !path.startsWith('/api/auth'))
      writes.push(`${init.method} ${path}`);
    if (path.endsWith('/demo-persona/sign-in')) {
      signedIn = people[JSON.parse(String(init.body)).personaId === 'sam' ? 1 : 0];
      return json(
        { user: signedIn },
        200,
        `better-auth.session_token=${signedIn.id}.sig; Max-Age=60`,
      );
    }
    if (path.endsWith('/get-session'))
      return json({
        user: signedIn,
        session: { userId: signedIn.id, expiresAt: '2030-01-01T00:00:00Z' },
      });
    if (path.endsWith('/sign-out')) return json({ success: true });
    if (path === '/api/groups')
      return json({ data: [group(inrGroupId, 'INR'), group(eurGroupId, 'EUR')], status: 200 });
    if (path === `/api/groups/${inrGroupId}`)
      return json({ data: group(inrGroupId, 'INR'), status: 200 });
    if (path === `/api/groups/${eurGroupId}`)
      return json({ data: group(eurGroupId, 'EUR'), status: 200 });
    return json({ error: 'Unavailable', status: 404 }, 404);
  };
  const controller = createMobileController(
    {
      apiBaseUrl: 'http://localhost:4138',
      authOrigin: 'http://localhost:4138',
      developmentPersonaEnabled: true,
      receiptScanEnabled: enabled,
    },
    {
      fetch,
      credentials: {
        load: async () => cookie,
        save: async (value) => {
          cookie = value;
        },
        clear: async () => {
          cookie = null;
        },
      },
      expenseDrafts: drafts,
      accountLocal: {
        owner: {
          load: async () => account,
          save: async (value) => {
            account = value;
          },
          clear: async () => {
            account = null;
          },
        },
        cleanupMarker: {
          load: async () => cleanup,
          mark: async () => {
            cleanup = true;
          },
          clear: async () => {
            cleanup = false;
          },
        },
        stores: [drafts],
      },
      now: () => Date.parse(iso),
      newSubmissionKey: () => 'native-expense-test-0001',
      receiptScanner: scanner,
    },
  );
  const stored = (accountId: string, groupId: string) =>
    (records.get(`${accountId}:${groupId}`) as { draft: Record<string, unknown> } | undefined)
      ?.draft;
  return { controller, writes, stored };
}

async function openNewDraft(
  controller: ReturnType<typeof setup>['controller'],
  groupId = inrGroupId,
) {
  await controller.signIn('alex');
  await controller.openExpense(groupId);
  await controller.updateExpenseDraft({ description: 'Groceries', splitMethod: 'unequal', tagId });
  await controller.updateExpenseDraft({
    splitValues: { [memberIds[0]]: '100', [memberIds[1]]: '50' },
  });
}

describe('receipt scanning into a new Expense draft', () => {
  it('reviews a recognized total and applies only the amount after explicit confirmation', async () => {
    const scan = controllableScanner();
    const { controller, writes, stored } = setup({ scanner: scan.scanner });
    await openNewDraft(controller);
    const before = controller.getSnapshot().expense.draft!;

    const scanning = controller.scanReceipt();
    expect(controller.getSnapshot().expense.receiptScan.status).toBe('scanning');
    await scan.release(toPay);
    await scanning;

    const review = controller.getSnapshot().expense.receiptScan;
    expect(review).toMatchObject({
      status: 'review',
      amount: '289.86',
      amountMinor: 28986,
      label: 'to pay',
      evidence: ['To Pay ₹289.86'],
    });
    expect(controller.getSnapshot().expense.draft).toEqual(before);

    await controller.applyReceiptScan();
    const editor = controller.getSnapshot().expense;
    expect(editor.receiptScan.status).toBe('idle');
    expect(editor.draft).toEqual({ ...before, amount: '289.86' });
    expect(stored(memberIds[0], inrGroupId)).toMatchObject({
      amount: '289.86',
      payerId: memberIds[0],
      splitMethod: 'unequal',
      splitValues: { [memberIds[0]]: '100', [memberIds[1]]: '50' },
      currency: 'INR',
      tagId,
    });
    // The unchanged split no longer adds up, so existing validation rejects the allocation.
    expect(editor.preview).toBeNull();
    expect(editor.status).toBe('editing');
    expect(writes).toEqual([]);
  });

  it('keeps the draft unchanged when recognition finds no single total', async () => {
    const scan = controllableScanner();
    const { controller, writes } = setup({ scanner: scan.scanner });
    await openNewDraft(controller);
    const before = controller.getSnapshot().expense.draft;

    const scanning = controller.scanReceipt();
    await scan.release(receipt(['Bill total', '₹350'], ['To pay', '₹320']));
    await scanning;

    expect(controller.getSnapshot().expense.receiptScan).toEqual({
      status: 'no-result',
      message: expect.stringContaining('more than one possible total'),
    });
    expect(controller.getSnapshot().expense.draft).toBe(before);
    await controller.applyReceiptScan();
    expect(controller.getSnapshot().expense.draft).toBe(before);
    controller.dismissReceiptScan();
    expect(controller.getSnapshot().expense.receiptScan.status).toBe('idle');
    expect(writes).toEqual([]);
  });

  it('treats a cancelled choice and a recognition failure as no change', async () => {
    const scan = controllableScanner();
    const { controller } = setup({ scanner: scan.scanner });
    await openNewDraft(controller);
    const before = controller.getSnapshot().expense.draft;

    let scanning = controller.scanReceipt();
    await scan.release(null);
    await scanning;
    expect(controller.getSnapshot().expense.receiptScan).toEqual({ status: 'idle', message: null });

    scanning = controller.scanReceipt();
    await scan.release(new Error('decode failed for /data/user/0/cache/ImagePicker/receipt.jpg'));
    await scanning;
    const failed = controller.getSnapshot().expense.receiptScan;
    expect(failed).toEqual({
      status: 'no-result',
      message: 'Couldn’t read that image on this device. Your draft hasn’t changed.',
    });
    expect(JSON.stringify(failed)).not.toContain('ImagePicker');
    expect(controller.getSnapshot().expense.draft).toBe(before);

    // An interpretation failure must end the scan too, never leave it reading forever.
    scanning = controller.scanReceipt();
    await scan.release({ width: 1, height: 1, lines: null } as unknown as RecognizedReceipt);
    await scanning;
    expect(controller.getSnapshot().expense.receiptScan).toEqual(failed);
    expect(controller.getSnapshot().expense.draft).toBe(before);
  });

  it('never overwrites an amount edited after the scan started', async () => {
    const scan = controllableScanner();
    const { controller, stored } = setup({ scanner: scan.scanner });
    await openNewDraft(controller);

    const scanning = controller.scanReceipt();
    await controller.updateExpenseDraft({ amount: '150' });
    await scan.release(toPay);
    await scanning;
    expect(controller.getSnapshot().expense.receiptScan.status).toBe('review');

    await controller.applyReceiptScan();
    expect(controller.getSnapshot().expense.draft?.amount).toBe('150');
    expect(stored(memberIds[0], inrGroupId)?.amount).toBe('150');
    expect(controller.getSnapshot().expense.receiptScan).toMatchObject({
      status: 'no-result',
      message: expect.stringContaining('amount changed after this scan'),
    });
  });

  it('drops a result that arrives after the person dismissed or started another scan', async () => {
    const scan = controllableScanner();
    const { controller } = setup({ scanner: scan.scanner });
    await openNewDraft(controller);

    const first = controller.scanReceipt();
    controller.dismissReceiptScan();
    const second = controller.scanReceipt();
    await scan.release(receipt(['Grand total', '₹999.00']), 0);
    await first;
    expect(controller.getSnapshot().expense.receiptScan.status).toBe('scanning');
    await scan.release(toPay, 1);
    await second;
    expect(controller.getSnapshot().expense.receiptScan).toMatchObject({ amountMinor: 28986 });
  });

  it('drops a result after the editor moves to another Group or account', async () => {
    const scan = controllableScanner();
    const { controller, stored } = setup({ scanner: scan.scanner });
    await openNewDraft(controller);
    const scanning = controller.scanReceipt();
    await controller.openExpense(eurGroupId);
    await scan.release(toPay);
    await scanning;
    expect(controller.getSnapshot().expense.groupId).toBe(eurGroupId);
    expect(controller.getSnapshot().expense.receiptScan.status).toBe('idle');

    await controller.openExpense(inrGroupId);
    controller.resumeExpenseDraft();
    const late = controller.scanReceipt();
    await controller.signOut();
    await controller.signIn('sam');
    await controller.openExpense(inrGroupId);
    await scan.release(toPay);
    await late;
    expect(controller.getSnapshot().auth.user?.id).toBe(memberIds[1]);
    expect(controller.getSnapshot().expense.receiptScan.status).toBe('idle');
    expect(controller.getSnapshot().expense.draft?.amount).toBe('');
    expect(stored(memberIds[1], inrGroupId)).toBeUndefined();
  });

  it('offers scanning only for new drafts in INR Groups while the experiment is enabled', async () => {
    const scan = controllableScanner();
    const { controller } = setup({ scanner: scan.scanner });
    await controller.signIn('alex');
    await controller.openExpense(eurGroupId);
    await controller.scanReceipt();
    expect(scan.calls).toBe(0);
    expect(controller.getSnapshot().expense.receiptScan.status).toBe('idle');

    const disabled = controllableScanner();
    const off = setup({ scanner: disabled.scanner, enabled: false });
    expect(off.controller.receiptScanEnabled).toBe(false);
    await openNewDraft(off.controller);
    await off.controller.scanReceipt();
    expect(disabled.calls).toBe(0);
  });
});
