import { afterEach, describe, expect, it } from 'vitest';
import { hermesZoneMoved } from '@splitbook/shared/test-support/hermes-zone';
import { viewMonthLabel } from './group-snackbar';

describe('View in {Month}', () => {
  it('names the Month, with its year when it differs from the Month shown', () => {
    expect(viewMonthLabel('2026-08', '2026-09')).toBe('View in August');
    expect(viewMonthLabel('2025-12', '2026-01')).toBe('View in December 2025');
    expect(viewMonthLabel('2026-08', null)).toBe('View in August 2026');
  });

  // #1286: the app started in India and the phone then moved to Pago Pago, a day behind. Hermes
  // keeps the zone it started in for its dates while Intl follows the new one (#1283).
  describe('after the phone’s zone moves while the app runs (#1286)', () => {
    let restore = () => {};
    afterEach(() => restore());

    it('names the Month from its key', () => {
      restore = hermesZoneMoved('Asia/Kolkata', 'Pacific/Pago_Pago');
      expect(viewMonthLabel('2026-08', '2026-09')).toBe('View in August');
      expect(viewMonthLabel('2026-01', '2025-12')).toBe('View in January 2026');
    });
  });
});
