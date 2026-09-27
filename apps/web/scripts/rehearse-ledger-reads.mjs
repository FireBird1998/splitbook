/**
 * Run from the workspace root:
 * pnpm web exec tsx scripts/rehearse-ledger-reads.mjs
 *
 * Uses only a newly minted database on loopback MongoDB, never MONGODB_URI or
 * .env.local. Removes only that verified empty database after the rehearsal.
 * Reports raw synthetic JSON/query plans, not production latency estimates.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createLedgerIndexes } from '../src/lib/ledger-indexes.ts';
import { assertStoredExpenseMoney } from '@splitbook/shared/exact-money';
import { calculateNetBalancesMinor } from '@splitbook/shared/debt-simplifier';

assert.equal(
  process.argv.length,
  2,
  'This isolated rehearsal accepts no database or output overrides',
);
const dbName = `splitbook-test-read-${randomUUID()}`;
const client = new MongoClient(`mongodb://127.0.0.1:27017/${dbName}?directConnection=true`, {
  serverSelectionTimeoutMS: 5_000,
});
const out = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../output/playwright/ledger-migration',
);
const oid = (n) => new ObjectId(n.toString(16).padStart(24, '0'));
const id = (value) => String(value);
const bytes = (rows) => Buffer.byteLength(JSON.stringify(rows));
const sizes = (before, after) => ({
  records: before.length,
  fullDocumentBytes: bytes(before),
  projectedBytes: bytes(after),
  bytesSaved: bytes(before) - bytes(after),
  reductionPercent: Number((100 * (1 - bytes(after) / bytes(before))).toFixed(2)),
});
const walk = (value, visit) => {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) visit(value);
  for (const child of Object.values(value)) walk(child, visit);
};
const explainSummary = (explain) => {
  const stages = [];
  const indexNames = [];
  const sorts = [];
  walk(explain.queryPlanner.winningPlan.queryPlan ?? explain.queryPlanner.winningPlan, (node) => {
    if (node.stage) stages.push(node.stage);
    if (node.indexName) indexNames.push(node.indexName);
  });
  walk(explain.executionStats.executionStages, (node) => {
    if (String(node.stage).toUpperCase().includes('SORT')) {
      const fields = [
        'stage',
        'nReturned',
        'totalDataSizeSorted',
        'usedDisk',
        'spills',
        'memLimit',
        'limitAmount',
      ];
      sorts.push(
        Object.fromEntries(fields.filter((key) => key in node).map((key) => [key, node[key]])),
      );
    }
  });
  return {
    nReturned: explain.executionStats.nReturned,
    totalDocsExamined: explain.executionStats.totalDocsExamined,
    totalKeysExamined: explain.executionStats.totalKeysExamined,
    winningPlanStages: stages,
    indexesUsed: indexNames,
    hasBlockingSort: stages.some((stage) => stage === 'SORT'),
    sorts,
  };
};
const contributionProjection = {
  group: 1,
  currency: 1,
  moneyVersion: 1,
  amount: 1,
  amountMinor: 1,
  paidBy: 1,
  splitBetween: 1,
};
const groupContributionProjection = {
  currency: 1,
  moneyVersion: 1,
  amount: 1,
  amountMinor: 1,
  paidBy: 1,
  splitBetween: 1,
};
const summaryProjection = { currency: 1, moneyVersion: 1, amount: 1, amountMinor: 1 };
const listProjection = { editHistory: 0 };
const groups = Array.from({ length: 5 }, (_, g) => ({
  _id: oid(100 + g),
  name: `Synthetic group ${g + 1}`,
  defaultCurrency: g % 2 === 0 ? 'INR' : 'USD',
  tags: [{ _id: oid(200 + g), name: 'General', isArchived: false, isDeleted: false }],
  members: Array.from({ length: 3 }, (_, m) => oid(1000 + g * 3 + m)),
}));
const fixtures = groups.flatMap((group, g) =>
  Array.from({ length: 200 }, (_, i) => {
    const amountMinor = 10000 + g * 1000 + i;
    const amount = amountMinor / 100;
    const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
    const splitBetween = group.members.map((user, m) => {
      const minor = Math.floor(amountMinor / 3) + (m < amountMinor % 3 ? 1 : 0);
      return { user, amount: minor / 100, amountMinor: minor };
    });
    const record = {
      _id: oid(10000 + g * 200 + i),
      group: group._id,
      description: `Synthetic expense ${i}`,
      amount,
      amountMinor,
      moneyVersion: 1,
      currency: group.defaultCurrency,
      category: 'other',
      splitMethod: 'equal',
      paidBy: [{ user: group.members[0], amount, amountMinor }],
      splitBetween,
      date: new Date(Date.UTC(2026, 0, 1 + Math.floor(i / 10))),
      createdAt,
      updatedAt: createdAt,
      tag: 'General',
      tagId: group.tags[0]._id,
      notes: 'Synthetic read rehearsal',
      predefinedItem: null,
      receiptUrl: null,
      recurringExpense: null,
      period: null,
      createdBy: group.members[0],
      isDeleted: i % 10 === 0,
      deletedAt: i % 10 === 0 ? createdAt : null,
      deletedBy: i % 10 === 0 ? group.members[0] : null,
      revision: 40,
      editHistory: Array.from({ length: 40 }, (_, r) => ({
        editedBy: group.members[0],
        editedAt: new Date(createdAt.valueOf() + r),
        changes: {
          notes: {
            old: `Historical note ${r}: ${'a'.repeat(180)}`,
            new: `Revised note ${r}: ${'b'.repeat(180)}`,
          },
        },
      })),
    };
    assertStoredExpenseMoney(record);
    return record;
  }),
);

(async () => {
  let evidence;
  let db;
  let ownsDatabase = false;
  try {
    await client.connect();
    db = client.db(dbName);
    assert.equal(
      (await db.listCollections().toArray()).length,
      0,
      'Only a new disposable database may be used',
    );
    ownsDatabase = true;
    await db.collection('groups').insertMany(groups);
    const expenses = db.collection('expenses');
    await expenses.insertMany(fixtures);
    await expenses.createIndexes([
      { key: { group: 1, date: -1 } },
      { key: { group: 1, isDeleted: 1 } },
      { key: { group: 1, tag: 1 } },
      { key: { group: 1, category: 1 } },
      { key: { description: 'text' } },
      {
        key: { recurringExpense: 1, period: 1 },
        unique: true,
        partialFilterExpression: { recurringExpense: { $type: 'objectId' } },
      },
    ]);
    const oldIndexes = (await expenses.listIndexes().toArray()).map(({ name, key }) => ({
      name,
      key,
    }));
    const allFilter = { group: { $in: groups.map((group) => group._id) }, isDeleted: false };
    const listFilter = { group: groups[0]._id, isDeleted: false };
    const listSort = { date: -1, createdAt: -1 };
    const baselineAll = await expenses.find(allFilter).sort({ _id: 1 }).toArray();
    const projectedAll = await expenses
      .find(allFilter, { projection: contributionProjection })
      .sort({ _id: 1 })
      .toArray();
    const baselineGroup = await expenses.find(listFilter).sort({ _id: 1 }).toArray();
    const projectedGroup = await expenses
      .find(listFilter, { projection: groupContributionProjection })
      .sort({ _id: 1 })
      .toArray();
    const projectedSummary = await expenses
      .find(listFilter, { projection: summaryProjection })
      .sort({ _id: 1 })
      .toArray();
    const baselineList = await expenses.find(listFilter).sort(listSort).limit(20).toArray();
    const projectedList = await expenses
      .find(listFilter, { projection: listProjection })
      .sort(listSort)
      .limit(20)
      .toArray();
    const beforeFullExplain = explainSummary(
      await expenses.find(listFilter).sort(listSort).limit(20).explain('executionStats'),
    );
    const beforeProjectedExplain = explainSummary(
      await expenses
        .find(listFilter, { projection: listProjection })
        .sort(listSort)
        .limit(20)
        .explain('executionStats'),
    );
    assert.equal(baselineAll.length, 900);
    assert.equal(baselineGroup.length, 180);
    assert.deepEqual(
      baselineAll.map((row) => id(row._id)),
      projectedAll.map((row) => id(row._id)),
    );
    assert.deepEqual(
      baselineGroup.map((row) => id(row._id)),
      projectedGroup.map((row) => id(row._id)),
    );
    assert.deepEqual(
      baselineGroup.map((row) => id(row._id)),
      projectedSummary.map((row) => id(row._id)),
    );
    for (let i = 0; i < baselineAll.length; i++) {
      for (const key of Object.keys(contributionProjection))
        assert.deepEqual(baselineAll[i][key], projectedAll[i][key]);
    }
    assert.deepEqual(
      baselineList.map((row) => {
        const projected = { ...row };
        delete projected.editHistory;
        return projected;
      }),
      projectedList,
    );
    const total = (rows) => rows.reduce((sum, row) => sum + row.amountMinor, 0);
    assert.equal(total(baselineGroup), total(projectedSummary));
    const groupBalances = groups.map((group) => {
      const before = calculateNetBalancesMinor(
        baselineAll.filter((row) => id(row.group) === id(group._id)),
        [],
        group.defaultCurrency,
      ).sort((a, b) => a.userId.localeCompare(b.userId));
      const after = calculateNetBalancesMinor(
        projectedAll.filter((row) => id(row.group) === id(group._id)),
        [],
        group.defaultCurrency,
      ).sort((a, b) => a.userId.localeCompare(b.userId));
      assert.deepEqual(before, after);
      assert.equal(
        before.reduce((sum, balance) => sum + balance.amountMinor, 0),
        0,
      );
      return { groupId: id(group._id), currency: group.defaultCurrency, balancesMinor: before };
    });
    const currencyTotalsMinor = Object.fromEntries(
      ['INR', 'USD'].map((currency) => {
        const before = total(baselineAll.filter((row) => row.currency === currency));
        const after = total(projectedAll.filter((row) => row.currency === currency));
        assert.equal(before, after);
        return [currency, before];
      }),
    );
    await createLedgerIndexes(db);
    const afterProjectedExplain = explainSummary(
      await expenses
        .find(listFilter, { projection: listProjection })
        .sort(listSort)
        .limit(20)
        .explain('executionStats'),
    );
    assert.deepEqual(
      await expenses
        .find(listFilter, { projection: listProjection })
        .sort(listSort)
        .limit(20)
        .toArray(),
      projectedList,
    );
    evidence = {
      scope:
        'Synthetic, local read-shape and query-plan evidence; not a production latency benchmark.',
      database: dbName,
      fixture: {
        groups: groups.length,
        expenses: fixtures.length,
        activeExpenses: baselineAll.length,
        deletedExpenses: fixtures.length - baselineAll.length,
        activeExpensesPerGroup: baselineGroup.length,
        editHistoryEntriesPerExpense: 40,
        currencies: ['INR', 'USD'],
        validCanonicalMoney: true,
      },
      measurement: {
        unit: 'Buffer.byteLength(JSON.stringify(rawMongoDocuments))',
        excludes: [
          'Mongoose user population',
          'HTTP envelope',
          'compression',
          'network latency',
          'production data distribution',
        ],
        unhintedQueries: true,
        baselineNotes: [
          'The old summary path aggregated in MongoDB; full-document versus summary projection is not an old/new API comparison and no summary payload-reduction metric is reported.',
          'groupBalance compares the expense-list balance-contribution projection, which omits group; dashboardBalance compares balance.service projection, which includes group.',
        ],
      },
      equivalence: {
        count: true,
        IDs: true,
        contributionFields: true,
        amountTotals: true,
        balances: true,
        zeroSumBalances: true,
        listFieldsExcludingEditHistory: true,
        listOrderBeforeAndAfterIndex: true,
        currencyTotalsMinor,
        groupBalances,
      },
      payloads: {
        dashboardBalance: sizes(baselineAll, projectedAll),
        groupBalance: sizes(baselineGroup, projectedGroup),
        defaultListPage: sizes(baselineList, projectedList),
      },
      projections: {
        dashboardBalance: contributionProjection,
        groupBalance: groupContributionProjection,
        groupSummary: summaryProjection,
        defaultListPage: listProjection,
      },
      defaultListExplain: {
        filter: listFilter,
        sort: listSort,
        limit: 20,
        beforeFullDocuments: beforeFullExplain,
        beforeProjectedDocuments: beforeProjectedExplain,
        afterProjectedDocuments: afterProjectedExplain,
      },
      indexesBefore: oldIndexes,
      indexesAfter: (await expenses.listIndexes().toArray()).map(({ name, key }) => ({
        name,
        key,
      })),
      databaseRemoved: false,
    };
  } finally {
    try {
      if (ownsDatabase) await db.dropDatabase();
      if (evidence) evidence.databaseRemoved = true;
    } finally {
      await client.close();
    }
  }
  assert.ok(evidence);
  assert.equal(evidence.databaseRemoved, true);
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'read-rehearsal.json'), JSON.stringify(evidence, null, 2) + '\n');
  const lines = [
    evidence.scope,
    `Disposable database: ${evidence.database}; removed: ${evidence.databaseRemoved}`,
    'Fixture: 1,000 valid canonical-money Expenses across 5 Groups; 900 active / 100 deleted; 40 edit-history entries per Expense.',
    'Equivalence assertions passed: IDs, counts, contribution fields, amount totals, per-person exact minor-unit balances, zero-sum balances, list fields and list order.',
    `Active amount totals in minor units: ${JSON.stringify(evidence.equivalence.currencyTotalsMinor)}`,
    '',
    ...Object.entries(evidence.payloads).map(
      ([name, data]) =>
        `${name}: ${data.records} records; ${data.fullDocumentBytes.toLocaleString('en-US')} → ${data.projectedBytes.toLocaleString('en-US')} JSON bytes (${data.reductionPercent}% smaller).`,
    ),
    '',
    'Default list query: first Group, isDeleted=false, sort date DESC then createdAt DESC, limit 20; no hint.',
    ...Object.entries(evidence.defaultListExplain)
      .filter(([key]) => key.includes('Documents'))
      .map(
        ([name, data]) =>
          `${name}: returned ${data.nReturned}; keys examined ${data.totalKeysExamined}; docs examined ${data.totalDocsExamined}; stages ${data.winningPlanStages.join(' → ')}; indexes ${data.indexesUsed.join(', ')}; blocking sort ${data.hasBlockingSort}.`,
      ),
    '',
    'Method: measured raw MongoDB documents with Buffer.byteLength(JSON.stringify(...)); excludes Mongoose user population, HTTP envelope, compression and network timing. These are synthetic payload/query-plan measurements, not production speed estimates.',
    ...evidence.measurement.baselineNotes,
    'Before index creation, the database used the indexes from the pre-hardening Expense schema. After measurements call the actual createLedgerIndexes(db) implementation. Queries were not hinted.',
  ];
  await writeFile(resolve(out, 'read-rehearsal.txt'), lines.join('\n') + '\n');
  console.log(
    JSON.stringify(
      {
        database: evidence.database,
        databaseRemoved: evidence.databaseRemoved,
        payloads: evidence.payloads,
        defaultListExplain: evidence.defaultListExplain,
        currencyTotalsMinor: evidence.equivalence.currencyTotalsMinor,
      },
      null,
      2,
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
