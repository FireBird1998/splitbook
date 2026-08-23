/**
 * Shared fixtures for integration tests: fixed test user identities.
 * Distinct `b…` ObjectId prefix keeps them visually separate from the
 * `a…` demo personas used by the demo seed.
 */

import mongoose from 'mongoose';
import User from '@/lib/models/User';

export const TEST_USER_IDS = {
  alice: 'b00000000000000000000001',
  bob: 'b00000000000000000000002',
  carol: 'b00000000000000000000003',
  dave: 'b00000000000000000000004',
} as const;

export type TestUserKey = keyof typeof TEST_USER_IDS;

const TEST_USER_NAMES: Record<TestUserKey, string> = {
  alice: 'Alice Tester',
  bob: 'Bob Tester',
  carol: 'Carol Tester',
  dave: 'Dave Tester',
};

/** Insert test users (idempotent per test run — call after db.reset()). */
export async function createTestUsers(...keys: TestUserKey[]): Promise<void> {
  await User.insertMany(
    keys.map((key) => ({
      _id: new mongoose.Types.ObjectId(TEST_USER_IDS[key]),
      name: TEST_USER_NAMES[key],
      email: `${key}.test@splitbook-test.local`,
      preferredCurrency: 'INR',
    })),
  );
}
