import { describe, expect, it, onTestFinished } from 'vitest';
import { hermesZoneMoved } from '@splitbook/shared/test-support/hermes-zone';
import { mockDeviceLocale } from '../test-utils/device-locale';
import { spellTime } from './day-format';
import { refreshedLabel } from './refresh-feedback';

// #1298: the app started in India and the phone moved to Pago Pago while it ran. Hermes keeps
// India for its dates (#1283); when shown figures were read is "today" by the phone's day.
describe('when figures were read, after the phone’s zone moves while the app runs (#1298)', () => {
  it('gives only the time for a read on the phone’s today, and the day for one before it', () => {
    onTestFinished(hermesZoneMoved('Asia/Kolkata', 'Pacific/Pago_Pago'));
    mockDeviceLocale('en-US');
    // 9:00 PM on 20 Nov in Pago Pago (1:30 PM on 21 Nov in India).
    const now = Date.parse('2026-11-21T08:00:00.000Z');
    // 1:00 AM on 20 Nov in Pago Pago (5:30 PM on 20 Nov in India).
    const today = new Date('2026-11-20T12:00:00.000Z');
    expect(refreshedLabel(today.getTime(), now)).toBe(spellTime(today));
    expect(spellTime(today)).toMatch(/^1:00\s+AM$/);
    // 9:00 PM on 19 Nov in Pago Pago (1:30 AM on 20 Nov in India).
    const before = new Date('2026-11-20T08:00:00.000Z');
    expect(refreshedLabel(before.getTime(), now)).toBe(`19\u00a0Nov, ${spellTime(before)}`);
  });
});
