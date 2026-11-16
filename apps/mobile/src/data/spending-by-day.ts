import { createPhoneSwitch, type PhoneSwitchStorage } from './phone-switch';

/**
 * Spending by day (#1271): one switch for the Home card and the Spending screen, kept on this
 * phone like Appearance, Motion and Tilt. Off until the member turns it on; while off, nothing is
 * read for it.
 */
let deviceStorage: PhoneSwitchStorage | null = null;
export const spendingByDay = createPhoneSwitch(
  {
    load: () => deviceStorage?.load() ?? Promise.resolve(null),
    save: (value) => deviceStorage?.save(value) ?? Promise.resolve(),
  },
  'Spending by day',
  false,
);
export function configureSpendingByDayStorage(storage: PhoneSwitchStorage) {
  deviceStorage = storage;
  return spendingByDay.restore();
}
