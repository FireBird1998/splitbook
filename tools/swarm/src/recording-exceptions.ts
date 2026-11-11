import type { AllowedRecordingSite } from './recording-contract.ts';

// Exact, reviewed maintenance/projection sites. A changed, duplicated or missing site fails.
export const recordingExceptions = [
  {
    path: 'apps/web/src/lib/activity-boundary.ts',
    operation: 'audience',
    within: 'activityPayload',
    site: 'notificationContext:{version:event.notificationContext.version,eventId:event.notificationContext.eventId,kind:event.notificationContext.kind,groupId:event.notificationContext.groupId,recordId:event.notificationContext.recordId,occurredAt:event.notificationContext.occurredAt,recipientIds:Array.from(event.notificationContext.recipientIds),}',
    reason:
      'Outbox publication copies the already committed immutable audience; it does not choose recipients.',
  },
  {
    path: 'apps/web/src/lib/demo/seed.ts',
    operation: 'deleteMany',
    within: 'resetDemoData',
    site: 'Expense.deleteMany(inSeededGroups)',
    reason:
      'Explicit demo reset deletes only the seeded Groups and their fictional ledger records.',
  },
  {
    path: 'apps/web/src/lib/demo/seed.ts',
    operation: 'deleteMany',
    within: 'resetDemoData',
    site: 'Settlement.deleteMany(inSeededGroups)',
    reason:
      'Explicit demo reset deletes only the seeded Groups and their fictional ledger records.',
  },
  {
    path: 'apps/web/src/lib/migrations/expense-dates.ts',
    operation: 'updateOne',
    within: 'migrateExpenseDates',
    site: 'expenses.updateOne({_id:move._id,date:move.from},{$set:{date:move.to}},)',
    reason:
      'Reviewed date-only migration changes the recorded day without creating a financial write.',
  },
  {
    path: 'apps/web/src/lib/migrations/ledger-money.ts',
    operation: 'updateOne',
    within: 'migrateLedgerMoney',
    site: "db.collection(collection).updateOne({_id:record._id,moneyVersion:{$exists:false},amount:record.amount,currency:record.currency,updatedAt:record.updatedAt??{$exists:false},...(collection==='settlements'?{}:{paidBy:record.paidBy,splitBetween:record.splitBetween}),},{$set:fields},)",
    reason:
      'Reviewed exact-money migration backfills minor-unit storage under a compare-and-swap filter.',
  },
  {
    path: 'apps/web/src/lib/migrations/ledger.ts',
    operation: 'updateMany',
    within: 'migrateLedger',
    site: 'db.collection(collection).updateMany({revision:{$exists:false}},{$set:{revision:0}})',
    reason:
      'Ledger migration initializes absent legacy revisions; it does not record a member command.',
  },
  {
    path: 'apps/web/src/lib/migrations/tag-references.ts',
    operation: 'updateOne',
    within: 'migrateTagReferences',
    site: 'db.collection(collection).updateOne({_id:record._id,group:record.group,tag:record.tag,tagId:null},{$set:{tagId:newObjectId(decision.tagId)}},)',
    reason: 'Reviewed identity migration binds legacy Tag names to their stable Tag IDs.',
  },
  {
    path: 'apps/web/src/lib/services/activity.service.ts',
    operation: 'audience',
    within: 'publishOne',
    site: 'notificationContext:existing.notificationContext',
    reason:
      'Outbox publication preserves the committed audience and acknowledges its immutable event with a pull; it never changes financial fields.',
  },
  {
    path: 'apps/web/src/lib/services/activity.service.ts',
    operation: 'updateOne',
    within: 'publishOne',
    site: 'db.collection<PendingActivitySource>(source).updateOne({_id:newTypes.ObjectId(recordId),group:event.group},{$pull:{pendingActivity:{_id:event._id}}},{maxTimeMS:maxTimeMS(),session},)',
    reason:
      'Outbox publication preserves the committed audience and acknowledges its immutable event with a pull; it never changes financial fields.',
  },
  {
    path: 'apps/web/src/lib/services/group-cleanup.service.ts',
    operation: 'deleteMany',
    within: 'resumeGroupDeletion',
    site: 'db.collection(collection).deleteMany({group:id,_id:{$in:records.map((record)=>record._id)}},{session},)',
    reason:
      'Confirmed Group deletion removes a bounded batch of dependent records in its deletion transaction.',
  },
  {
    path: 'apps/web/src/lib/services/tag-management.service.ts',
    operation: 'updateMany',
    within: 'submit',
    site: 'Expense.collection.updateMany(legacy,{$set:{tagId}},{session})',
    reason:
      'Reported #1108 finding: on-request Tag rename binds legacy records to the same stable Tag identity, without a financial edit, revision or Activity. This is inline identity migration, not an ordinary Expense change.',
  },
  {
    path: 'apps/web/scripts/rehearse-ledger-reads.mjs',
    operation: 'insertMany',
    within: '',
    site: 'expenses.insertMany(fixtures)',
    reason:
      'Read-performance rehearsal inserts synthetic fixtures in its explicitly owned rehearsal database.',
  },
  {
    path: 'apps/web/scripts/verify-group-cleanup.ts',
    operation: 'insertOne',
    within: 'verify',
    site: "db.collection(name).insertOne({group:id,isDeleted:true,isPaused:true,pendingActivity:[{metadata:{description:'Fictional unprojected event'}}],})",
    reason:
      'The cleanup verifier inserts fictional deleted records in its disposable test database to exercise bounded deletion.',
  },
  {
    path: 'apps/web/scripts/verify-group-cleanup.ts',
    operation: 'insertMany',
    within: 'verify',
    site: "db.collection('expenses').insertMany(Array.from({length:2_000},()=>({group:pending,isDeleted:true})))",
    reason:
      'The cleanup verifier inserts fictional deleted records in its disposable test database to exercise bounded deletion.',
  },
  {
    path: 'apps/web/scripts/verify-group-cleanup.ts',
    operation: 'insertOne',
    within: 'verify',
    site: "db.collection('expenses').insertOne({group:historic,isDeleted:true})",
    reason:
      'The cleanup verifier inserts fictional deleted records in its disposable test database to exercise bounded deletion.',
  },
] satisfies readonly AllowedRecordingSite[];
