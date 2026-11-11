import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { readCases, readFixture } from './test-utils/reads/fixture';
vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = readFixture('statement');
let origin: string;
let server: ChildProcess;
let output = '';
let appDirectory: string;
beforeAll(async () => {
  // Match the expense-access suite: Next may rewrite only this disposable app's config.
  appDirectory = await mkdtemp(resolve(tmpdir(), 'splitbook-read-statement-'));
  for (const file of ['src', 'public', 'package.json', 'tsconfig.json', 'next.config.ts'])
    await cp(resolve(file), resolve(appDirectory, file), {
      recursive: true,
      filter: (path) => !path.endsWith('.snap') && !path.endsWith('.test.ts'),
    });
  await symlink(resolve('node_modules'), resolve(appDirectory, 'node_modules'), 'dir');
  const portServer = createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const address = portServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing statement port');
  const port = address.port;
  await new Promise<void>((resolve) => portServer.close(() => resolve()));
  origin = `http://127.0.0.1:${port}`;
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    MCP_ENABLED: 'false',
    MONGODB_URI: fixture.db.uri,
    AUTH_MODE: 'demo',
    ALLOW_DEMO_AUTH: 'true',
    NEXT_PUBLIC_APP_URL: origin,
    NEXT_TELEMETRY_DISABLED: '1',
    SPLITBOOK_READ_TEST_CLOCK: String(fixture.clock.getTime()),
  };
  // Compile with the real clock. A frozen earlier day invalidates Next's dev cache timestamps.
  server = spawn(
    process.execPath,
    [resolve('node_modules/next/dist/bin/next'), 'build', '--webpack'],
    {
      cwd: appDirectory,
      env: serverEnv,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const build = server;
  for (const stream of [build.stdout, build.stderr])
    stream?.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-12000);
    });
  const [buildCode] = await once(build, 'exit');
  expect(buildCode, output).toBe(0);
  server = spawn(
    process.execPath,
    [
      resolve('node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      cwd: appDirectory,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...serverEnv,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${resolve('src/lib/test-utils/reads/fixed-clock.mjs')}`,
      },
    },
  );
  for (const stream of [server.stdout, server.stderr])
    stream?.on('data', (chunk) => {
      output = (output + String(chunk)).slice(-12000);
    });
  const deadline = performance.now() + 90_000;
  while (performance.now() < deadline) {
    if (server.exitCode !== null || server.signalCode !== null)
      throw new Error(`Statement server exited: ${output}`);
    try {
      if ((await fetch(`${origin}/api/auth/ok`, { signal: AbortSignal.timeout(5000) })).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Statement server did not start: ${output}`);
}, 180_000);
afterAll(async () => {
  try {
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        process.kill(-server.pid, 'SIGTERM');
        await Promise.race([
          exited,
          new Promise<void>((resolve) => {
            timeout = setTimeout(() => {
              process.kill(-server.pid!, 'SIGKILL');
              resolve();
            }, 10_000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }
  } finally {
    if (appDirectory) await rm(appDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
});

for (const state of readCases)
  it(`Statement page / ${state}`, async () => {
    const access = await fixture.arrange(state);
    const signIn = await fetch(`${origin}/api/auth/demo-persona/sign-in`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        personaId: state === 'admin' ? 'alex' : state === 'outsider' ? 'priya' : 'sam',
      }),
    });
    expect(signIn.status, output).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const record = await fixture.capture(async () => {
      const response = await fetch(`${origin}/groups/${access.groupId}/statement?tz=UTC`, {
        headers: { cookie },
        redirect: 'manual',
      });
      const html = await response.text();
      const renderedText = html
        .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return { status: response.status, body: { renderedText } };
    });
    if (state === 'member' || state === 'admin') {
      expect(record.addedDueExpense).toBe(true);
      expect(record.answer).toMatchObject({
        status: 200,
        body: { renderedText: expect.stringContaining('Due rent') },
      });
    }
  }, 90_000);
