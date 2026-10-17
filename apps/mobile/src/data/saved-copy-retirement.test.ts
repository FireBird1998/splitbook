import { describe, expect, it } from 'vitest';
import { savedCopyRetirement } from './saved-copy-retirement';
import { Superseded } from './transport';
import type { AccountStorageLease } from './types';

// The Tag path's guards, at this module's seam: the controller's Tag client checks the same
// guards just before and just after calling it, so no controller journey can tell them apart.
// Every other retirement rule is tested through the controller (saved-copies-controller.test.ts).

const groupId = 'b00000000000000000000001';

/** A retirement whose removals and sends are recorded, in order, for one account. */
function retirementWith(options: { removal?: Error } = {}) {
  const steps: string[] = [];
  const lease: AccountStorageLease = {
    accountId: 'a00000000000000000000001',
    write: async (operation) => {
      steps.push('remove');
      if (options.removal) throw options.removal;
      return operation();
    },
    writeSavedCopy: (operation) => operation(),
  };
  const forget = async () => undefined;
  const retirement = savedCopyRetirement({
    lease: () => lease,
    current: () => true,
    now: () => 0,
    invalidate: () => undefined,
    group: { forget, changed: () => 1 },
    expense: { forget },
    activity: { forget },
    home: { forget },
    untrusted: { mark: () => undefined },
  });
  const send = async () => {
    steps.push('send');
    return 'sent';
  };
  return { retirement, lease, steps, send };
}

describe('a Tag change’s guards around its pre-send removal', () => {
  it('removes nothing and sends nothing while the device is offline', async () => {
    const { retirement, lease, steps, send } = retirementWith();
    const offline = new Error('Tag changes need a connection.');

    await expect(
      retirement.tag(
        groupId,
        1,
        lease,
        {
          current: () => undefined,
          online: () => {
            throw offline;
          },
        },
        send,
      ),
    ).rejects.toBe(offline);
    expect(steps).toEqual([]);
  });

  it('reports a Group or account that is no longer current, not the failed removal', async () => {
    const { retirement, lease, steps, send } = retirementWith({
      removal: new Error('The device storage is full'),
    });
    const superseded = new Superseded();

    await expect(
      retirement.tag(
        groupId,
        1,
        lease,
        {
          current: () => {
            throw superseded;
          },
          online: () => undefined,
        },
        send,
      ),
    ).rejects.toBe(superseded);
    expect(steps).toEqual(['remove']);
  });

  it('says this try was not sent when the removal fails for a current Group', async () => {
    const { retirement, lease, steps, send } = retirementWith({
      removal: new Error('The device storage is full'),
    });

    await expect(
      retirement.tag(
        groupId,
        1,
        lease,
        { current: () => undefined, online: () => undefined },
        send,
      ),
    ).rejects.toThrow(
      'Could not clear older saved copies on this device. This try was not sent. Check or retry the original action after storage recovers.',
    );
    expect(steps).toEqual(['remove']);
  });
});
