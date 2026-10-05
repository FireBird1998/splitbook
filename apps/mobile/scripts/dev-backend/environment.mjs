import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

export const repository = resolve(import.meta.dirname, '../../../..');
export const webApp = resolve(repository, 'apps/web');
export const marker = 'splitbook-native-ticket-50-fictional-only';

function tcpPort(name, value) {
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) {
    throw new Error(`${name} must be a TCP port number between 1 and 65535`);
  }
  return Number(value);
}

function fictionalDatabaseName(value) {
  // Mongo allows 63 characters. Lowercase only, so two names never differ by case alone.
  if (!/^splitbook_mobile_[a-z0-9_]+$/.test(value) || value.length > 63) {
    throw new Error(
      'SPLITBOOK_NATIVE_DATABASE must start with splitbook_mobile_ and continue with lowercase letters, digits or underscores, 63 characters at most',
    );
  }
  return value;
}

/**
 * The fictional backend this process targets. Each worktree can run its own backend,
 * with its own origin port and database; without the variables it is the default
 * backend. The origin and Mongo stay on loopback, and invalid values are refused.
 */
export function backendTarget(env) {
  const mongoPort = tcpPort(
    'SPLITBOOK_NATIVE_MONGO_PORT',
    env.SPLITBOOK_NATIVE_MONGO_PORT ?? '27018',
  );
  const originPort = tcpPort(
    'SPLITBOOK_NATIVE_ORIGIN_PORT',
    env.SPLITBOOK_NATIVE_ORIGIN_PORT ?? '4138',
  );
  if (originPort === mongoPort) {
    throw new Error('SPLITBOOK_NATIVE_ORIGIN_PORT must differ from SPLITBOOK_NATIVE_MONGO_PORT');
  }
  const databaseName = fictionalDatabaseName(
    env.SPLITBOOK_NATIVE_DATABASE ?? 'splitbook_mobile_50',
  );
  return {
    origin: `http://127.0.0.1:${originPort}`,
    originPort,
    databaseName,
    mongoPort,
    mongoUri: `mongodb://127.0.0.1:${mongoPort}/${databaseName}?directConnection=true`,
  };
}

/** The variables that make a child process, such as the seed, resolve the same backend. */
function targetVariables(target) {
  return {
    SPLITBOOK_NATIVE_ORIGIN_PORT: String(target.originPort),
    SPLITBOOK_NATIVE_DATABASE: target.databaseName,
    SPLITBOOK_NATIVE_MONGO_PORT: String(target.mongoPort),
  };
}

const target = backendTarget(process.env);
export const { origin, originPort, databaseName, mongoPort, mongoUri } = target;
export const identities = {
  alex: 'a00000000000000000000001',
  sam: 'a00000000000000000000002',
  priya: 'a00000000000000000000003',
};
export const groups = {
  trip: 'a00000000000000000000010',
  household: 'a00000000000000000000020',
  private: 'a00000000000000000000030',
};

export function assertNoEnvironmentFiles() {
  for (const directory of [repository, webApp]) {
    const files = readdirSync(directory).filter(
      (name) => name.startsWith('.env') && name !== '.env.example',
    );
    if (files.length) {
      throw new Error(
        `Refusing environment files in ${directory}. Use a clean worktree without root/web .env files; do not delete your working environment files.`,
      );
    }
  }
}

export function isolatedEnv() {
  assertNoEnvironmentFiles();
  return {
    PATH: process.env.PATH ?? '',
    TMPDIR: tmpdir(),
    NODE_ENV: 'development',
    NEXT_TELEMETRY_DISABLED: '1',
    AUTH_MODE: 'demo',
    AUTH_SECRET: 'native-ticket-50-isolated-fictional-test-secret-not-a-real-account-secret',
    AUTH_RATE_LIMIT_ENABLED: 'false',
    NEXT_PUBLIC_APP_URL: origin,
    MONGODB_URI: mongoUri,
    ...targetVariables(target),
  };
}

/**
 * How start.mjs serves the web app: `dev` (`next dev`, the default) or `production`
 * (a production build for this origin, then `next start`). Only start.mjs reads it.
 */
export function serverMode(env) {
  const mode = env.SPLITBOOK_NATIVE_SERVER ?? 'dev';
  if (mode !== 'dev' && mode !== 'production') {
    throw new Error('SPLITBOOK_NATIVE_SERVER must be dev or production');
  }
  return mode;
}

/** The web server's environment in that mode. */
export function serverEnv(mode) {
  const environment = isolatedEnv();
  if (mode !== 'production') return environment;
  // Demo personas fail closed in production without ALLOW_DEMO_AUTH=true, which the
  // Playwright CI jobs set for the same reason.
  return { ...environment, NODE_ENV: 'production', ALLOW_DEMO_AUTH: 'true' };
}
