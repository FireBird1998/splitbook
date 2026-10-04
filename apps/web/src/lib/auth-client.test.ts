import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordSettlement, type AttemptStorage } from '@/lib/settlement-attempts';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('better-auth/react', () => ({ createAuthClient: () => ({ signOut }) }));

const SAM = 'a00000000000000000000002';
const PRIYA = 'a00000000000000000000003';
const GROUP = 'b00000000000000000000001';
const PREFIX = 'splitbook:settlement-attempt:';

function memoryStorage(): AttemptStorage & { keys(): string[] } {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    keys: () => [...items.keys()],
  };
}

let storage: ReturnType<typeof memoryStorage>;
let assign: ReturnType<typeof vi.fn>;
const attemptsKept = () => storage.keys().filter((key) => key.startsWith(PREFIX)).length;

beforeEach(async () => {
  vi.resetModules();
  signOut.mockReset();
  storage = memoryStorage();
  assign = vi.fn();
  vi.stubGlobal('window', { localStorage: storage, location: { assign, reload: vi.fn() } });
  // Sam's payment whose reply was lost.
  await recordSettlement({
    storage,
    accountId: SAM,
    groupId: GROUP,
    newKey: () => 'key-00000001',
    post: () => Promise.reject(new TypeError('Failed to fetch')),
    payment: {
      paidBy: SAM,
      paidTo: PRIYA,
      amount: 250.25,
      currency: 'INR',
      note: '',
      paidByName: 'Sam Chen',
      paidToName: 'Priya Shah',
    },
  });
  expect(attemptsKept()).toBe(1);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('signOutToHome', () => {
  it('forgets stored payments once the session has ended, before leaving the page', async () => {
    let keptDuringSignOut = -1;
    signOut.mockImplementation(async () => {
      keptDuringSignOut = attemptsKept();
      return { data: { success: true }, error: null };
    });
    let keptOnLeaving = -1;
    assign.mockImplementation(() => (keptOnLeaving = attemptsKept()));
    const { signOutToHome } = await import('./auth-client');

    await signOutToHome();

    expect(keptDuringSignOut).toBe(1);
    expect(keptOnLeaving).toBe(0);
    expect(assign).toHaveBeenCalledWith('/');
  });

  it('keeps them when the sign-out is refused, since the member is still signed in', async () => {
    signOut.mockResolvedValue({ data: null, error: { status: 500, statusText: 'Server error' } });
    const { signOutToHome } = await import('./auth-client');

    await signOutToHome();

    expect(attemptsKept()).toBe(1);
  });

  it('keeps them when the sign-out cannot reach the server', async () => {
    signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    const { signOutToHome } = await import('./auth-client');

    await expect(signOutToHome()).rejects.toThrow('Failed to fetch');

    expect(attemptsKept()).toBe(1);
    expect(assign).not.toHaveBeenCalled();
  });
});
