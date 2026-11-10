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
});
