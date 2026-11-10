import type { NextConfig } from 'next';
import { API_CACHE_CONTROL } from './src/lib/api-cache-control';

const nextConfig: NextConfig = {
  // Apply before proxy refusals and route handlers. Pages and assets keep their own policy.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: API_CACHE_CONTROL }],
      },
    ];
  },
  // `forbidden()`: a Group's server page (the statement, #319) refuses a non-member with a
  // real HTTP 403 and `groups/[id]/forbidden.tsx`, without exposing any Group data.
  experimental: { authInterrupts: true },
  // @splitbook/shared ships TypeScript source; compile it together with the app.
  // Load-bearing beyond the in-repo dev/build: the expense-access suite copies the
  // app to a temp directory and runs webpack there, where the package sits outside
  // the project root and is only compiled because it is listed here.
  transpilePackages: ['@splitbook/shared'],
  // The MongoDB driver's URI parser (`lib/mongodb-uri.ts`, #850) loads under Node, as Next
  // already loads `mongodb` and `mongoose`: bundled, its ESM wrapper's default export is lost.
  serverExternalPackages: ['mongodb-connection-string-url'],
  // From 16.3, `next dev` run under an AI coding agent writes AGENTS.md and
  // CLAUDE.md into apps/web. Agent instructions live in the root AGENTS.md;
  // keep dev from adding untracked instruction files to every worktree.
  agentRules: false,
};

export default nextConfig;
