import { expect, it } from 'vitest';
import { DEMO_PERSONA_IDS } from '@/lib/demo-personas';
import { recordingFixture } from './fixture';

export function paymentRetryPaths(writer: 'single-settlement' | 'settlement-batch') {
  const fixture = recordingFixture(writer, `retry-precedence-${writer}`);
  it('judges a new archived save before its departed party', async () => {
    await fixture.remove(DEMO_PERSONA_IDS.sam);
    await fixture.archive();
    const answer = await fixture.send();
    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('GROUP_ARCHIVED');
  });
  it('judges a changed retry body before its departed party', async () => {
    expect((await fixture.send()).status).toBe(201);
    await fixture.remove(DEMO_PERSONA_IDS.sam);
    const answer = await fixture.send(
      writer === 'single-settlement'
        ? { note: 'Changed' }
        : { settlements: [{ amount: 30, currency: 'INR', note: 'Changed' }] },
    );
    expect(answer.status).toBe(409);
    expect(answer.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('acknowledges its receipt after a named person leaves', async () => {
    const first = await fixture.send();
    expect(first.status).toBe(201);
    await fixture.remove(DEMO_PERSONA_IDS.sam);
    const answer = await fixture.send();
    expect(answer.status).toBe(201);
    expect(answer.body).toEqual(first.body);
  });
  for (const state of ['party leaves', 'archive'] as const)
    it(`recognises a winner while waiting, then ${state}`, async () => {
      const pause = fixture.holdFence(1);
      const waiting = fixture.send();
      let first: Awaited<typeof waiting>;
      try {
        await Promise.race([
          pause.reached,
          waiting.then(() => {
            throw new Error('Payment ended before fence');
          }),
        ]);
        pause.restore();
        first = await fixture.send();
        expect(first.status).toBe(201);
        if (state === 'archive') await fixture.archive();
        else await fixture.remove(DEMO_PERSONA_IDS.sam);
      } finally {
        pause.restore();
        pause.release();
      }
      const answer = await waiting;
      expect(answer.status).toBe(201);
      expect(answer.body).toEqual(first!.body);
      expect((await fixture.state()).settlements).toHaveLength(1);
    });
}
