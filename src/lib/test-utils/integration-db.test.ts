import { describe, expect, it } from 'vitest';
import { integrationTestDb } from './integration-db';

describe('integrationTestDb', () => {
  it('derives a per-file test database name from the file key', () => {
    const db = integrationTestDb('Expense Ownership');

    expect(db.dbName).toBe('splitbook-test-expense-ownership');
    expect(db.uri).toContain('/splitbook-test-expense-ownership?');
  });

  it('replaces any database segment in TEST_MONGODB_URI with the per-file name', () => {
    const previous = process.env.TEST_MONGODB_URI;
    process.env.TEST_MONGODB_URI = 'mongodb://mongo.internal:27017/anything?directConnection=true';
    try {
      const db = integrationTestDb('groups');

      expect(db.uri).toBe(
        'mongodb://mongo.internal:27017/splitbook-test-groups?directConnection=true',
      );
    } finally {
      if (previous === undefined) delete process.env.TEST_MONGODB_URI;
      else process.env.TEST_MONGODB_URI = previous;
    }
  });

  it('never targets the demo database', () => {
    const db = integrationTestDb('seed');

    expect(db.dbName).not.toContain('demo');
    expect(db.uri).not.toContain('splitbook-demo');
  });
});
