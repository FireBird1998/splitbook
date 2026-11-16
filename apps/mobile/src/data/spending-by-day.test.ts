import { expect, it } from 'vitest';
import { configureSpendingByDayStorage, spendingByDay } from './spending-by-day';

// #1274: Spending by day is a phone switch, off until the member turns it on.
function phone(initial: string | null = null) {
  let stored = initial;
  return {
    load: async () => stored,
    save: async (value: string) => {
      stored = value;
    },
    stored: () => stored,
  };
}

it('is off on a fresh install and after an update that brings the switch', async () => {
  expect(spendingByDay.getSnapshot()).toEqual({ enabled: false, message: null });
  await configureSpendingByDayStorage(phone(null));
  expect(spendingByDay.getSnapshot()).toEqual({ enabled: false, message: null });
});

it('stays on after a restart once turned on, and off once turned off', async () => {
  const storage = phone();
  await configureSpendingByDayStorage(storage);
  await spendingByDay.select(true);
  expect(storage.stored()).toBe('on');
  await configureSpendingByDayStorage(storage);
  expect(spendingByDay.getSnapshot().enabled).toBe(true);
  await spendingByDay.select(false);
  await configureSpendingByDayStorage(storage);
  expect(spendingByDay.getSnapshot().enabled).toBe(false);
});

it('reads anything but a saved "on" as off', async () => {
  await configureSpendingByDayStorage(phone('yes'));
  expect(spendingByDay.getSnapshot().enabled).toBe(false);
});

it('stays off and says so when the phone can’t read the choice', async () => {
  await configureSpendingByDayStorage({
    load: async () => {
      throw Error('locked');
    },
    save: async () => undefined,
  });
  expect(spendingByDay.getSnapshot()).toEqual({
    enabled: false,
    message: 'Couldn’t load Spending by day. Please choose again.',
  });
});
