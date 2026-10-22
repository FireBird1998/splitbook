/**
 * Every Mongoose model's schema indexes, as a fresh database gets them (#856): each model's
 * collection, its indexes by name, with their keys, uniqueness and partial filters. These are the
 * lists the app built before #846, and the ones staging and production hold.
 */

import type mongoose from 'mongoose';

const id = { name: '_id_', key: { _id: 1 } };
const keyed = { 'creationRequest.key': { $type: 'string' } };

export const MODEL_INDEXES = {
  activities: [
    id,
    { name: 'group_1_createdAt_-1__id_-1', key: { group: 1, createdAt: -1, _id: -1 } },
  ],
  expenses: [
    id,
    { name: 'description_text', key: { _fts: 'text', _ftsx: 1 } },
    { name: 'group_1_category_1', key: { group: 1, category: 1 } },
    {
      name: 'group_1_createdBy_1_creationRequest.key_1',
      key: { group: 1, createdBy: 1, 'creationRequest.key': 1 },
      unique: true,
      partialFilterExpression: keyed,
    },
    { name: 'group_1_date_-1', key: { group: 1, date: -1 } },
    { name: 'group_1_isDeleted_1', key: { group: 1, isDeleted: 1 } },
    {
      name: 'group_1_isDeleted_1_date_-1_createdAt_-1',
      key: { group: 1, isDeleted: 1, date: -1, createdAt: -1 },
    },
    { name: 'group_1_tag_1', key: { group: 1, tag: 1 } },
    { name: 'group_1_tagId_1', key: { group: 1, tagId: 1 } },
    {
      name: 'recurringExpense_1_period_1',
      key: { recurringExpense: 1, period: 1 },
      unique: true,
      partialFilterExpression: { recurringExpense: { $type: 'objectId' } },
    },
  ],
  groups: [
    id,
    { name: 'createdBy_1', key: { createdBy: 1 } },
    {
      name: 'createdBy_1_creationRequest.key_1',
      key: { createdBy: 1, 'creationRequest.key': 1 },
      unique: true,
      partialFilterExpression: keyed,
    },
    {
      name: 'inviteCode_1',
      key: { inviteCode: 1 },
      unique: true,
      partialFilterExpression: { inviteCode: { $type: 'string' } },
    },
    { name: 'members.user_1', key: { 'members.user': 1 } },
  ],
  invitations: [
    id,
    { name: 'invitedEmail_1_group_1', key: { invitedEmail: 1, group: 1 } },
    { name: 'status_1_expiresAt_1', key: { status: 1, expiresAt: 1 } },
    { name: 'token_1', key: { token: 1 }, unique: true },
  ],
  productswitches: [id],
  recurringexpenses: [
    id,
    { name: 'group_1', key: { group: 1 } },
    { name: 'group_1_tagId_1', key: { group: 1, tagId: 1 } },
  ],
  settlements: [
    id,
    { name: 'group_1_createdAt_-1', key: { group: 1, createdAt: -1 } },
    {
      name: 'group_1_createdBy_1_creationRequest.key_1',
      key: { group: 1, createdBy: 1, 'creationRequest.key': 1 },
      unique: true,
      partialFilterExpression: keyed,
    },
    { name: 'group_1_paidBy_1', key: { group: 1, paidBy: 1 } },
    { name: 'group_1_paidTo_1', key: { group: 1, paidTo: 1 } },
  ],
  users: [id, { name: 'users_email_uidx', key: { email: 1 }, unique: true }],
};

/** The indexes the database holds for those collections, in the same shape. */
export async function modelIndexes(db: mongoose.mongo.Db) {
  const held: Record<string, unknown[]> = {};
  for (const collection of Object.keys(MODEL_INDEXES)) {
    const indexes = await db
      .collection(collection)
      .indexes()
      .catch(() => []);
    held[collection] = indexes
      .map(({ name, key, unique, partialFilterExpression }) => ({
        name,
        key,
        ...(unique ? { unique } : {}),
        ...(partialFilterExpression ? { partialFilterExpression } : {}),
      }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  return held;
}
