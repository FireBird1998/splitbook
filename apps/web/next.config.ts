import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // @splitbook/shared ships TypeScript source; compile it together with the app.
  transpilePackages: ['@splitbook/shared'],
};

export default nextConfig;
