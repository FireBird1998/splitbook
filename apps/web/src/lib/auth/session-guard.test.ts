import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ALEX = 'a00000000000000000000001';
const SAM = 'a00000000000000000000002';

const settled = (userId: string | null) => ({
  data: userId ? { user: { id: userId } } : null,
  isPending: false,
  error: null,
});

describe('guardSession', () => {
  let reload: ReturnType<typeof vi.fn>;
  let guardSession: typeof import('./session-guard').guardSession;
  let leaveExpectedAccount: typeof import('@/lib/utils/api-fetch').leaveExpectedAccount;

  beforeEach(async () => {
    vi.resetModules();
    reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    ({ guardSession } = await import('./session-guard'));
    ({ leaveExpectedAccount } = await import('@/lib/utils/api-fetch'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing while the session matches the page’s account', () => {
    guardSession(ALEX, settled(ALEX));
    guardSession(ALEX, { ...settled(ALEX), isRefetching: true });
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads when the session belongs to another account', () => {
    guardSession(ALEX, settled(SAM));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when the session is gone', () => {
    guardSession(ALEX, settled(null));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when the session check answers 401', () => {
    guardSession(ALEX, { data: null, isPending: false, error: { status: 401 } });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for an answer: a pending check or a failed request proves nothing', () => {
    guardSession(ALEX, { data: null, isPending: true, error: null });
    guardSession(ALEX, { data: null, isPending: false, error: { status: 503 } });
    guardSession(ALEX, { data: null, isPending: false, error: new Error('offline') });
    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves an intentional sign-out in this tab to its own navigation', () => {
    leaveExpectedAccount();
    guardSession(ALEX, settled(null));
    expect(reload).not.toHaveBeenCalled();
  });
});
