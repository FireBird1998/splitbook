import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendTarget } from './environment.mjs';

// isolatedEnv() refuses root and web .env files. A developer checkout may have them,
// and these tests are not about them.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readdirSync: () => [],
}));

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
});

describe('the environment the backend scripts give their child processes', () => {
  const chosen = {
    SPLITBOOK_NATIVE_ORIGIN_PORT: '4187',
    SPLITBOOK_NATIVE_DATABASE: 'splitbook_mobile_187',
    SPLITBOOK_NATIVE_MONGO_PORT: '27017',
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** isolatedEnv() as seed.mjs and start.mjs call it, in a process started with these variables. */
  async function childEnvironment(variables: Record<string, string>) {
    for (const [name, value] of Object.entries(variables)) vi.stubEnv(name, value);
    vi.resetModules();
    const { isolatedEnv } = await import('./environment.mjs');
    return isolatedEnv();
  }

  it('points Next and the seed at the chosen backend, ignoring an inherited MONGODB_URI', async () => {
    const child = await childEnvironment({
      ...chosen,
      MONGODB_URI: 'mongodb://db.example.com:27017/splitbook',
    });
    expect(child.NEXT_PUBLIC_APP_URL).toBe('http://127.0.0.1:4187');
    expect(child.MONGODB_URI).toBe(
      'mongodb://127.0.0.1:27017/splitbook_mobile_187?directConnection=true',
    );
  });

  it("lets the seed's child process resolve the backend the parent checked", async () => {
    // seed.mjs runs the fixtures in a child whose whole environment is isolatedEnv().
    // The child resolves its target from that environment, and must not fall back to
    // the default database.
    expect(backendTarget(await childEnvironment(chosen))).toEqual(backendTarget(chosen));
  });
});
