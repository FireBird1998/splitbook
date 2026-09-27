import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';

export const repository = resolve(import.meta.dirname, '../../../..');
export const webApp = resolve(repository, 'apps/web');
export const origin = 'http://127.0.0.1:4138';
export const databaseName = 'splitbook_mobile_50';
export const marker = 'splitbook-native-ticket-50-fictional-only';

function localMongoPort(value = '27018') {
  if (!/^\d{1,5}$/.test(value))
    throw new Error('SPLITBOOK_NATIVE_MONGO_PORT must be a local TCP port');
  const port = Number(value);
  if (port < 1 || port > 65535)
    throw new Error('SPLITBOOK_NATIVE_MONGO_PORT must be between 1 and 65535');
  return port;
}

export const mongoPort = localMongoPort(process.env.SPLITBOOK_NATIVE_MONGO_PORT);
export const mongoUri = `mongodb://127.0.0.1:${mongoPort}/${databaseName}?directConnection=true`;
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
    SPLITBOOK_NATIVE_MONGO_PORT: String(mongoPort),
  };
}
