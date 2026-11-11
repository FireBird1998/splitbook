import { vi } from 'vitest';
import { readFixture } from './test-utils/reads/fixture';
import { acrossReads } from './test-utils/reads/catalog';
import { httpReadCases } from './test-utils/reads/http';
vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
httpReadCases(readFixture('across'), acrossReads);
