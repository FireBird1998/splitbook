import { describe, expect, it } from 'vitest';
import { fakeSplitbook } from './fake-splitbook';
import { testPhone } from './test-phone';

describe('test phone', () => {
  it('reopens the app on the same session and stored payment without sending it', async () => {
    const server = fakeSplitbook();
    const phone = testPhone(server);
    const first = phone.open();
    await first.signIn('alex');
    await phone.stores.settlementAttempts.save(
      'a00000000000000000000001',
      'b00000000000000000000001',
      { untouched: 'fictional payment' },
    );
    const second = phone.open();
    await second.restore();
    expect(second).not.toBe(first);
    expect(second.getSnapshot().auth.user?.name).toBe('Alex Rivera');
    expect(
      await phone.stores.settlementAttempts.load(
        'a00000000000000000000001',
        'b00000000000000000000001',
      ),
    ).toEqual({ untouched: 'fictional payment' });
    phone.dispose();
  });
  it('fails, stalls and holds a store write without changing what was stored until release', async () => {
    const phone = testPhone(fakeSplitbook());
    const store = phone.stores.settlementAttempts;
    store.failNext('save', new Error('Fictional disk failure'));
    await expect(store.save('alex', 'maple', { value: 1 })).rejects.toThrow(
      'Fictional disk failure',
    );
    expect(store.records.size).toBe(0);
    const hold = store.holdNext('save');
    const writing = store.save('alex', 'maple', { value: 2 });
    await hold.arrived;
    expect(store.records.size).toBe(0);
    hold.release();
    await writing;
    expect(await store.load('alex', 'maple')).toEqual({ value: 2 });
    let release!: () => void;
    store.stallNext(
      'save',
      new Promise<void>((done) => {
        release = done;
      }),
    );
    const stalled = store.save('alex', 'maple', { value: 3 });
    await Promise.resolve();
    expect(await store.load('alex', 'maple')).toEqual({ value: 2 });
    release();
    await stalled;
    expect(await store.load('alex', 'maple')).toEqual({ value: 3 });
  });
  it('shows the current cleanup markers and keeps their write faults at the phone boundary', async () => {
    const phone = testPhone(fakeSplitbook());
    await phone.stores.cleanupMarker.mark();
    expect(phone.stores.cleanupMarker.value).toBe(true);
    await phone.stores.signOutRecord.mark({ invitationCleared: true });
    expect(phone.stores.signOutRecord.value).toEqual({ invitationCleared: true });
    phone.stores.cleanupMarker.failNext('save');
    await expect(phone.stores.cleanupMarker.mark()).rejects.toThrow(
      'Fictional device storage failure',
    );
  });
});
