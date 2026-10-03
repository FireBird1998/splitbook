import { describe, expect, it } from 'vitest';
import { backendTarget, targetVariables } from './environment.mjs';

describe('fictional backend target', () => {
  it("defaults to today's single backend", () => {
    expect(backendTarget({})).toEqual({
      origin: 'http://127.0.0.1:4138',
      originPort: 4138,
      databaseName: 'splitbook_mobile_50',
      mongoPort: 27018,
      mongoUri: 'mongodb://127.0.0.1:27018/splitbook_mobile_50?directConnection=true',
    });
  });

  it('takes a per-worktree origin port and database name, keeping the origin on loopback', () => {
    expect(
      backendTarget({
        SPLITBOOK_NATIVE_ORIGIN_PORT: '4186',
        SPLITBOOK_NATIVE_DATABASE: 'splitbook_mobile_186',
        SPLITBOOK_NATIVE_MONGO_PORT: '27017',
      }),
    ).toEqual({
      origin: 'http://127.0.0.1:4186',
      originPort: 4186,
      databaseName: 'splitbook_mobile_186',
      mongoPort: 27017,
      mongoUri: 'mongodb://127.0.0.1:27017/splitbook_mobile_186?directConnection=true',
    });
  });

  it.each([
    '',
    '0',
    '65536',
    '04186',
    '-4186',
    '4186 ',
    '41a6',
    '4186.0',
    '127.0.0.1:4186',
    'http://example.com:4186',
  ])('refuses the origin port %j', (value) => {
    expect(() => backendTarget({ SPLITBOOK_NATIVE_ORIGIN_PORT: value })).toThrow(
      /^SPLITBOOK_NATIVE_ORIGIN_PORT must be/,
    );
  });

  it('refuses an origin port that is the Mongo port', () => {
    expect(() => backendTarget({ SPLITBOOK_NATIVE_ORIGIN_PORT: '27018' })).toThrow(
      /^SPLITBOOK_NATIVE_ORIGIN_PORT must differ from SPLITBOOK_NATIVE_MONGO_PORT/,
    );
  });

  it.each([
    '',
    'splitbook',
    'splitbook_mobile_',
    'splitbook_50',
    'splitbook_test_50',
    'production_splitbook_mobile_50',
    'splitbook_mobile_50/admin',
    'splitbook_mobile_50.users',
    'splitbook_mobile_ 50',
    'splitbook_mobile_QA',
    'splitbook_mobile_50?directConnection=false',
    `splitbook_mobile_${'x'.repeat(47)}`,
  ])('refuses the database name %j', (value) => {
    expect(() => backendTarget({ SPLITBOOK_NATIVE_DATABASE: value })).toThrow(
      /^SPLITBOOK_NATIVE_DATABASE must/,
    );
  });

  it('accepts the longest database name Mongo allows', () => {
    const databaseName = `splitbook_mobile_${'x'.repeat(46)}`;
    expect(backendTarget({ SPLITBOOK_NATIVE_DATABASE: databaseName }).databaseName).toBe(
      databaseName,
    );
  });

  it('refuses an invalid Mongo port, as before', () => {
    expect(() => backendTarget({ SPLITBOOK_NATIVE_MONGO_PORT: 'mongo' })).toThrow(
      /^SPLITBOOK_NATIVE_MONGO_PORT must be/,
    );
  });

  it('hands child processes the variables that resolve the same backend', () => {
    // The seed runs in a child process; it must seed the database the parent checked.
    const target = backendTarget({
      SPLITBOOK_NATIVE_ORIGIN_PORT: '4187',
      SPLITBOOK_NATIVE_DATABASE: 'splitbook_mobile_187',
      SPLITBOOK_NATIVE_MONGO_PORT: '27017',
    });
    expect(backendTarget(targetVariables(target))).toEqual(target);
    expect(backendTarget(targetVariables(backendTarget({})))).toEqual(backendTarget({}));
  });
});
