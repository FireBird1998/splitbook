import { useSyncExternalStore } from 'react';
import { phoneClock, type PhoneNow } from '../data/phone-clock';

/**
 * The phone's day, hour and zone. A component that reads them draws again when one of them moves
 * while it shows: at midnight, at each hour, and when the phone's zone changes (#1302).
 */
export const usePhoneNow = (): PhoneNow =>
  useSyncExternalStore(phoneClock.subscribe, phoneClock.now);
