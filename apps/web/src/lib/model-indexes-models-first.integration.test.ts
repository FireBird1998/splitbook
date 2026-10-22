/**
 * #856: the other order, the models loading before db.ts, gives every model the same schema
 * indexes on a fresh database. Its database is `splitbook-test-model-indexes-models-first`.
 */

import mongoose from 'mongoose';
import { afterAll, beforeAll, expect, it } from 'vitest';
import Activity from '@/lib/models/Activity';
import Expense from '@/lib/models/Expense';
import Group from '@/lib/models/Group';
import Invitation from '@/lib/models/Invitation';
import ProductSwitch from '@/lib/models/ProductSwitch';
import RecurringExpense from '@/lib/models/RecurringExpense';
import Settlement from '@/lib/models/Settlement';
import User from '@/lib/models/User';
// db.ts after the models.
import { integrationTestDb } from '@/lib/test-utils/integration-db';
import { MODEL_INDEXES, modelIndexes } from '@/lib/test-utils/model-indexes';

const db = integrationTestDb('model-indexes-models-first');
const models = [
  Activity,
  Expense,
  Group,
  Invitation,
  ProductSwitch,
  RecurringExpense,
  Settlement,
  User,
];

beforeAll(db.connect);
afterAll(db.teardown);

it('every model gets its schema indexes once connected', async () => {
  await Promise.all(models.map((model) => model.init()));
  expect(await modelIndexes(mongoose.connection.db!)).toEqual(MODEL_INDEXES);
});
