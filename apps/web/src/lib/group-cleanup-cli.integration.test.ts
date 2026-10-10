import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inventoryOrphanGroups } from './group-cleanup';
import { integrationTestDb } from './test-utils/integration-db';

const testDb = integrationTestDb('orphan-cleanup-cli');
const execute = promisify(execFile);
let directory: string;
const id = new mongoose.Types.ObjectId('b00000000000000000000081');
const command = (...args: string[]) =>
  execute('pnpm', ['run', 'groups:orphans', ...args], {
    cwd: resolve(import.meta.dirname, '../..'),
    env: {
      NODE_ENV: 'test',
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      MONGODB_URI: testDb.uri,
    },
    timeout: 20_000,
  });
const target = () => ['--environment', 'test', '--database', testDb.dbName];
async function reviewedManifest() {
  const report = await inventoryOrphanGroups(mongoose.connection.db!, 'test');
  const path = resolve(directory, 'reviewed.json');
  await writeFile(path, JSON.stringify({ ...report, selectedGroupIds: [String(id)] }));
  return path;
}

beforeAll(async () => {
  await testDb.connect();
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== 'isdbgrid')
    throw new Error('Maintenance CLI tests require an isolated replica set.');
  directory = await mkdtemp(resolve(tmpdir(), 'splitbook-orphan-cli-'));
});
beforeEach(async () => {
  if ((await mongoose.connection.db!.listCollections({ name: 'system.profile' }).toArray()).length)
    await mongoose.connection.db!.collection('system.profile').drop();
  await testDb.reset();
  await mongoose.connection
    .db!.collection('groups')
    .insertOne({ _id: id, name: 'Fictional reviewed Group', members: [], isArchived: true });
  await mongoose.connection.db!.collection('expenses').insertOne({ group: id });
});
afterAll(async () => {
  await testDb.teardown();
  await rm(directory, { recursive: true, force: true });
});

describe('orphan Group maintenance CLI', () => {
  it('defaults to inventory and accepts help without touching a database', async () => {
    expect((await command('--help')).stdout).toContain('Usage:');
    const output = resolve(directory, 'inventory.json');
    await command(...target(), '--output', output);
    expect(JSON.parse(await readFile(output, 'utf8')).groups[0]).toMatchObject({
      id: String(id),
      memberCount: 0,
    });
    expect(await mongoose.connection.db!.collection('groups').countDocuments()).toBe(1);
    expect(await mongoose.connection.db!.collection('groupdeletions').countDocuments()).toBe(0);
  });

  it('runs a reviewed manifest as read-only without model/index initialization', async () => {
    const manifest = await reviewedManifest();
    const db = mongoose.connection.db!;
    await db.command({ profile: 2 });
    try {
      await command(...target(), '--manifest', manifest);
    } finally {
      await db.command({ profile: 0 });
    }
    const operations = await db.collection('system.profile').find({}).toArray();
    expect(
      operations.some(
        (operation) =>
          operation.op === 'insert' ||
          operation.op === 'update' ||
          operation.op === 'remove' ||
          operation.command?.create ||
          operation.command?.createIndexes ||
          operation.command?.delete ||
          operation.command?.insert ||
          operation.command?.update,
      ),
    ).toBe(false);
    expect(await db.collection('expenses').countDocuments({ group: id })).toBe(1);
    expect(await db.collection('groupdeletions').countDocuments()).toBe(0);
  });

  it('executes explicit apply and a later resume in actual child processes', async () => {
    const manifest = await reviewedManifest();
    const output = resolve(directory, 'applied.json');
    await command(...target(), '--manifest', manifest, '--apply', '--output', output);
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({
      dryRun: false,
      results: [{ groupId: String(id), status: 'complete' }],
    });
    expect(await mongoose.connection.db!.collection('groups').countDocuments({ _id: id })).toBe(0);
    expect(await mongoose.connection.db!.collection('expenses').countDocuments({ group: id })).toBe(
      0,
    );
    await command(...target(), '--resume', '--apply');
    const receipt = await mongoose.connection.db!.collection('groupdeletions').findOne({ _id: id });
    expect(receipt?.state).toBe('complete');
    expect(receipt?.expiresAt.getTime() - receipt?.completedAt.getTime()).toBe(
      7 * 24 * 60 * 60 * 1_000,
    );
  });

  it('rejects an output collision before claiming or deleting a selected Group', async () => {
    const manifest = await reviewedManifest();
    const output = resolve(directory, 'do-not-replace.json');
    await writeFile(output, 'keep existing report');
    await expect(
      command(...target(), '--manifest', manifest, '--apply', '--output', output),
    ).rejects.toThrow();
    expect(await readFile(output, 'utf8')).toBe('keep existing report');
    expect(await mongoose.connection.db!.collection('groups').countDocuments({ _id: id })).toBe(1);
    expect(await mongoose.connection.db!.collection('groupdeletions').countDocuments()).toBe(0);
  });

  it.each(
    [
      [],
      ['--environment', 'test'],
      ['--database', 'admin'],
      ['--apply'],
      ['--resume'],
      ['--apply', '--dry-run'],
      ['--unknown'],
      ['--environment', 'test', '--environment', 'test'],
      ['--environment', 'test', '--database', 'different'],
    ].map((args) => [args]),
  )('rejects invalid or incomplete arguments %j without writes', async (args) => {
    await expect(command(...args)).rejects.toThrow();
    expect(await mongoose.connection.db!.collection('groups').countDocuments({ _id: id })).toBe(1);
    expect(await mongoose.connection.db!.collection('groupdeletions').countDocuments()).toBe(0);
  });

  it('rejects a manifest environment mismatch without applying it', async () => {
    const manifest = await reviewedManifest();
    await expect(
      command(
        '--environment',
        'different',
        '--database',
        testDb.dbName,
        '--manifest',
        manifest,
        '--apply',
      ),
    ).rejects.toThrow();
    expect(await mongoose.connection.db!.collection('groups').countDocuments({ _id: id })).toBe(1);
    expect(await mongoose.connection.db!.collection('groupdeletions').countDocuments()).toBe(0);
  });
});
