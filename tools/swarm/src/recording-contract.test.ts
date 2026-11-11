import { describe, expect, it } from 'vitest';
import { checkRecordingSources } from './recording-contract.ts';

const path = 'apps/web/src/lib/services/example.ts';
const file = (source: string, name = path) => ({ path: name, source });
const model = file(
  'export interface IExpenseDocument {} const Expense = {}; export default Expense;',
  'apps/web/src/lib/models/Expense.ts',
);
const sources = (source: string) => [model, file(source)];

describe('the ledger recording source contract', () => {
  it('binds an imported model alias instead of matching the local name', () => {
    expect(
      checkRecordingSources(sources("import Bill from '@/lib/models/Expense'; Bill.create({});")),
    ).toMatchObject([{ operation: 'create', message: expect.stringContaining('recordLedger') }]);
    expect(
      checkRecordingSources([file('const Expense = { create() {} }; Expense.create({});')]),
    ).toEqual([]);
  });
});

it.each([
  'const Model = Bill; new Model({});',
  "const row = await Bill.findOne({}).select('+pendingActivity'); await row.save();",
  'const { create: insert } = Bill; insert({});',
  'const insert = Bill.insertMany.bind(Bill); insert([]);',
  "const db = client.db(); const rows = db.collection('expenses'); rows.updateOne({}, {$pull:{pendingActivity:{}}});",
  "const table = flag ? 'expenses' : 'settlements'; client.db().collection(table).insertMany([]);",
  'function save(row: HydratedDocument<IExpenseDocument>) { row.save(); }',
])('finds bound documents, raw collections and method aliases (%s)', (source) => {
  expect(
    checkRecordingSources(
      sources(`import Bill, {IExpenseDocument} from '@/lib/models/Expense'; ${source}`),
    ),
  ).not.toEqual([]);
});

const infrastructure = [
  file('export function makePendingActivity() {}', 'apps/web/src/lib/financial-write.ts'),
  file('export function withGroupMutation() {}', 'apps/web/src/lib/group-mutation.ts'),
];
it.each([
  "import {makePendingActivity as event} from '@/lib/financial-write'; event(id, 'expense_added', actor);",
  "const key = 'notificationContext'; event[key] = context;",
  'const payload = { notificationContext: context };',
  "import {withGroupMutation as fence} from '@/lib/group-mutation'; const options={ledger:true}; fence(id, ()=>Bill.findOne({}), options);",
])('forbids event and fence plumbing outside the module (%s)', (source) => {
  expect(
    checkRecordingSources([
      ...sources(`import Bill from '@/lib/models/Expense'; ${source}`),
      ...infrastructure,
    ]),
  ).toHaveLength(1);
});
it('excludes tests, fixtures, declarations and the actual module but permits unrelated Group fences and schemas', () => {
  const source = "import Bill from '@/lib/models/Expense'; Bill.create({});";
  expect(
    checkRecordingSources([
      model,
      ...[
        'example.test.ts',
        'fixtures/example.ts',
        'test-utils/example.ts',
        'example.d.ts',
        'ledger-recording.ts',
      ].map((name) => file(source, `apps/web/src/lib/${name}`)),
    ]),
  ).toEqual([]);
  expect(
    checkRecordingSources([
      ...infrastructure,
      file(
        "import {Schema} from 'mongoose'; import {withGroupMutation as fence} from '@/lib/group-mutation'; const schema=new Schema({notificationContext:{type:Object}}); fence(id, ()=>Group.updateOne({}), {ledger:true});",
      ),
    ]),
  ).toEqual([]);
});
it('holds each exception to exactly one unchanged site and fails stale entries', () => {
  const input = sources(
    "import Bill from '@/lib/models/Expense'; function cleanup() { Bill.deleteMany({group:id}); }",
  );
  const [finding] = checkRecordingSources(input);
  expect(finding).toBeDefined();
  const exception = { ...finding!, reason: 'Reviewed Group cleanup only.' };
  expect(checkRecordingSources(input, [exception])).toEqual([]);
  expect(
    checkRecordingSources(
      sources(
        "import Bill from '@/lib/models/Expense'; function cleanup() { Bill.deleteMany({}); }",
      ),
      [exception],
    ),
  ).toHaveLength(2);
  expect(checkRecordingSources(input, [exception, exception])).toHaveLength(1);
});

it('follows helper parameters, callback aliases, assigned documents and dynamic collection indexes', () => {
  const input = sources(`import Bill from '@/lib/models/Expense';
    import {withGroupMutation as fence} from '@/lib/group-mutation';
    function write(model) { model.insertOne({}); } write(Bill);
    let row; row = await Bill.findOne({}); const save = row.save; save();
    const tables = ['expenses', 'settlements'] as const;
    db.collection(tables[index]).deleteMany({});
    const enabled = true; const options = {ledger: enabled};
    const callback = () => Bill.findOne({}); fence(id, callback, options);
  `);
  expect(checkRecordingSources([...input, ...infrastructure]).map((f) => f.operation)).toEqual([
    'insertOne',
    'save',
    'deleteMany',
    'ledger-fence',
  ]);
});
it('follows re-exported models and excludes the shared test-suite naming convention', () => {
  expect(
    checkRecordingSources([
      model,
      file("export { default as Record } from './models/Expense';", 'apps/web/src/lib/records.ts'),
      file("import {Record} from './records'; Record.create({});", 'apps/web/src/lib/writer.ts'),
      file(
        "import Bill from '@/lib/models/Expense'; Bill.create({});",
        'apps/web/src/lib/mcp/connection-test-suite.ts',
      ),
    ]),
  ).toHaveLength(1);
});
it.each([
  'function load() { return Bill.findOne({}); } const row = await load(); row.save();',
  'const box = {Bill}; let insert; insert = box.Bill.create; insert({});',
  'let row: HydratedDocument<IExpenseDocument>; row.save();',
  "const row = await Bill.findOne({}); const key = 'notificationContext'; row[key] ??= context;",
])('does not lose returned, shorthand, assigned or typed ledger identities (%s)', (source) => {
  expect(
    checkRecordingSources(
      sources(`import Bill, {IExpenseDocument} from '@/lib/models/Expense'; ${source}`),
    ),
  ).toHaveLength(1);
});
