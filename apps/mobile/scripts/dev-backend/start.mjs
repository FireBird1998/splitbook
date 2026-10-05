import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { webApp, serverEnv, serverMode, origin, originPort, databaseName } from './environment.mjs';
import { withIsolatedDatabase } from './database.mjs';

const next = resolve(webApp, 'node_modules/next/dist/bin/next');
let child;
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    if (child) child.kill(signal);
    else process.exit(1);
  });
}

/** Runs Next with the server's environment; resolves with its exit code. */
function runNext(args, environment) {
  if (stopping) return Promise.resolve(1);
  child = spawn(process.execPath, [next, ...args], {
    cwd: webApp,
    env: environment,
    stdio: 'inherit',
  });
  return new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}

async function main() {
  const mode = serverMode(process.env);
  const environment = serverEnv(mode);
  // Starting never claims an existing database: run seed first to establish ownership.
  await withIsolatedDatabase(async () => undefined);
  const listen = ['--hostname', '127.0.0.1', '--port', String(originPort)];
  if (mode === 'production') {
    // Next inlines NEXT_PUBLIC_APP_URL at build time, so each start builds for its own
    // origin. --webpack, as the web app's own build script.
    console.log(`Building the web app for ${origin}`);
    const built = await runNext(['build', '--webpack'], environment);
    if (built !== 0) throw new Error(`The production build failed (exit code ${built}).`);
  }
  console.log(
    `Starting fictional native backend at ${origin}; database=${databaseName}${mode === 'production' ? '; production build' : ''}`,
  );
  process.exitCode = await runNext(
    mode === 'production' ? ['start', ...listen] : ['dev', ...listen],
    environment,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
