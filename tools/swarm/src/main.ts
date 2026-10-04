/**
 * The entry point behind `pnpm swarm`. It loads nothing but Node built-ins until the
 * install check has run, so `pnpm swarm check` (and a gate's failed install check)
 * works in a worktree with no install at all, where `effect` itself is missing.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkInstall } from './install.ts';
import { defaultVitestWorkers, renderVerdict, writeVerdict, type Verdict } from './verdict.ts';

const usage = `Usage: pnpm swarm <command> [flags]

  check   Fail unless this worktree's install matches pnpm-lock.yaml.
  up      Start this worktree's own fictional backend and print its MOBILE_VERIFY_URL.
          --origin http://127.0.0.1:<port>  --database ${'<splitbook_mobile_swarm_…>'}
          --mongo-port <port>  --ready-timeout <seconds>
  down    Stop this worktree's backend and drop this worktree's databases.
          --mongo-port <port>
  gate    Run every check a ticket needs and write tools/swarm/out/verdict.json.
          --vitest-workers <n>  --step-timeout <seconds>  --base <ref>
          --mongo-port <port>  --ready-timeout <seconds>

See tools/swarm/README.md.`;

const root = realpathSync(resolve(import.meta.dirname, '../../..'));
const [command, ...args] = process.argv.slice(2);

function git(...gitArgs: string[]): string | undefined {
  try {
    return execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** The gate's verdict when the install is too broken to load the gate itself. */
function installVerdict(detail: string): Verdict {
  return {
    verdict: 'fail',
    interrupted: false,
    worktree: root,
    commit: git('rev-parse', 'HEAD'),
    base: { ref: 'origin/main', commit: git('merge-base', 'HEAD', 'origin/main') },
    startedAt: new Date().toISOString(),
    seconds: 0,
    vitestWorkers: Number(process.env.SWARM_VITEST_WORKERS) || defaultVitestWorkers,
    backend: undefined,
    steps: [{ name: 'install check', status: 'fail', seconds: 0, detail }],
  };
}

if (command === undefined || ['help', '--help', '-h'].includes(command)) {
  console.log(usage);
} else if (command === 'check') {
  const install = checkInstall(root);
  console.log(install.message);
  process.exitCode = install.ok ? 0 : 1;
} else if (command === 'up' || command === 'down' || command === 'gate') {
  let cli: typeof import('./cli.ts') | undefined;
  try {
    cli = await import('./cli.ts');
  } catch (error) {
    // Without an install, effect and the Mongo driver can't load.
    const install = checkInstall(root);
    const message = install.ok
      ? `tools/swarm could not load: ${(error as Error).message}`
      : install.message;
    if (command === 'gate') {
      const verdict = installVerdict(message.replace('\n', ' '));
      writeVerdict(verdict);
      console.log(renderVerdict(verdict));
    } else {
      console.error(message);
    }
    process.exitCode = 1;
  }
  cli?.run(command, args, root);
} else {
  console.error(`Unknown command ${command}.\n\n${usage}`);
  process.exitCode = 2;
}
