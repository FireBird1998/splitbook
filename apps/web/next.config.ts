import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @splitbook/shared ships TypeScript source; compile it together with the app.
  // Load-bearing beyond the in-repo dev/build: the expense-access suite copies the
  // app to a temp directory and runs webpack there, where the package sits outside
  // the project root and is only compiled because it is listed here.
  transpilePackages: ['@splitbook/shared'],
  // From 16.3, `next dev` run under an AI coding agent writes AGENTS.md and
  // CLAUDE.md into apps/web. Agent instructions live in the root AGENTS.md;
  // keep dev from adding untracked instruction files to every worktree.
  agentRules: false,
};

export default nextConfig;
