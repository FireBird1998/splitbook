import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { DEMO_PERSONAS } from '../src/lib/demo-personas';

async function unusedPort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No test port allocated');
  await new Promise<void>((resolve, reject) =>
    listener.close((err) => (err ? reject(err) : resolve())),
  );
  return address.port;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 10_000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}

export async function startIsolatedApp(
  authMode: 'demo' | 'google' = 'demo',
  googleTestIdentity?: { email: string; idTokenSecret: string },
  production = false,
) {
  // Never accept a caller's Mongo URI or app URL. Match the integration suite's
  // splitbook-test-* convention, but use a unique, loopback-only DB per run.
  const dbName = `splitbook-test-access-${randomUUID()}`;
  const uri = `mongodb://127.0.0.1:27017/${dbName}?directConnection=true`;
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
  const appDir = await mkdtemp(path.join(tmpdir(), 'splitbook-expense-access-'));
  const repo = path.resolve(__dirname, '..');
  let app: ChildProcess | undefined;
  const cleanup = async () => {
    if (app) await stop(app);
    try {
      // The target is minted above, never resolved from ambient configuration.
      await client.db(dbName).dropDatabase();
    } finally {
      await client.close();
      await rm(appDir, { recursive: true, force: true });
    }
  };

  try {
    await client.connect();
    await client
      .db(dbName)
      .collection('users')
      .insertMany(
        DEMO_PERSONAS.map((persona) => ({
          _id: new ObjectId(persona.id),
          name: persona.name,
          email: persona.email,
          image: persona.image,
          emailVerified: false,
          preferredCurrency: 'INR',
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );

    // A separate source snapshot avoids the working server's .next lock and
    // Next's automatic .env.local loading. No env files or local data are copied.
    for (const entry of ['src', 'public', 'package.json', 'tsconfig.json', 'next.config.ts']) {
      await cp(path.join(repo, entry), path.join(appDir, entry), { recursive: true });
    }
    await symlink(path.join(repo, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');
    const port = await unusedPort();
    const baseURL = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      NODE_ENV: production ? 'production' : 'development',
      NEXT_TELEMETRY_DISABLED: '1',
      AUTH_MODE: authMode,
      ALLOW_DEMO_AUTH: 'true',
      AUTH_RATE_LIMIT_ENABLED: 'false',
      AUTH_SECRET: randomUUID(),
      AUTH_GOOGLE_ID: 'unused-synthetic-client',
      AUTH_GOOGLE_SECRET: 'unused-synthetic-secret',
      AUTH_ALLOWED_EMAILS: googleTestIdentity?.email ?? '',
      ...(googleTestIdentity
        ? {
            AUTH_TEST_ID_TOKEN_SECRET: googleTestIdentity.idTokenSecret,
            ALLOW_TEST_ID_TOKEN: 'true',
          }
        : {}),
      MONGODB_URI: uri,
      NEXT_PUBLIC_APP_URL: baseURL,
    };
    if (production) {
      // Build only the temporary snapshot. The user's .next and environment
      // files are never read or changed by this production verification.
      const build = spawn(
        process.execPath,
        [require.resolve('next/dist/bin/next'), 'build', '--webpack'],
        { cwd: appDir, stdio: 'inherit', env },
      );
      const timeout = setTimeout(() => build.kill('SIGKILL'), 240_000);
      try {
        const [code] = await once(build, 'exit');
        if (code !== 0) throw new Error(`Isolated production build failed: ${code}`);
      } finally {
        clearTimeout(timeout);
      }
    }
    app = spawn(
      process.execPath,
      [
        require.resolve('next/dist/bin/next'),
        ...(production ? ['start'] : ['dev', '--webpack']),
        '-H',
        '127.0.0.1',
        '-p',
        String(port),
      ],
      {
        cwd: appDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
      },
    );
    const child = app;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Isolated app startup timed out')),
        120_000,
      );
      const ready = (chunk: Buffer) => {
        process.stdout.write(chunk);
        if (chunk.toString().includes('Ready in')) {
          clearTimeout(timeout);
          child.stdout!.off('data', ready);
          child.stdout!.resume();
          resolve();
        }
      };
      child.stdout!.on('data', ready);
      child.stderr!.on('data', (chunk) => process.stderr.write(chunk));
      child.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Isolated app exited: ${code}`));
      });
    });
    // Only publish the URL after our own child reports readiness. An occupied
    // port fails startup; an existing app is never reused.
    process.env.EXPENSE_ACCESS_BASE_URL = baseURL;
    process.env.EXPENSE_ACCESS_TEST_DB = dbName;
    return cleanup;
  } catch (err) {
    await cleanup();
    throw err;
  }
}

export default async function globalSetup() {
  return startIsolatedApp();
}
