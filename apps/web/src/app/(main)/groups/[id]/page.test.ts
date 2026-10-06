import { describe, expect, it, vi } from 'vitest';

// #305: the Group's own address, and the old links to it, land on a tab. Next's redirect()
// ends rendering by throwing; the stand-in does the same, with the address it was given.
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { url });
  }),
);
vi.mock('next/navigation', () => ({ redirect }));

const { default: GroupPage } = await import('./page');

const GROUP = 'c00000000000000000000001';

async function landing(searchParams: Record<string, string | string[] | undefined>) {
  const rendered = GroupPage({
    params: Promise.resolve({ id: GROUP }),
    searchParams: Promise.resolve(searchParams),
  });
  await expect(rendered).rejects.toThrow('NEXT_REDIRECT');
  return redirect.mock.lastCall?.[0];
}

describe('the Group’s own address', () => {
  it('lands on the Expenses tab', async () => {
    expect(await landing({})).toBe(`/groups/${GROUP}/expenses`);
  });

  it('sends the old ?tab=balances link to the Balances tab', async () => {
    expect(await landing({ tab: 'balances' })).toBe(`/groups/${GROUP}/balances`);
  });

  it('sends the old ?action=add-expense link, Month included, to Expenses to open the form', async () => {
    expect(await landing({ action: 'add-expense' })).toBe(
      `/groups/${GROUP}/expenses?action=add-expense`,
    );
    expect(await landing({ month: '2026-08', action: 'add-expense' })).toBe(
      `/groups/${GROUP}/expenses?month=2026-08&action=add-expense`,
    );
  });
});
