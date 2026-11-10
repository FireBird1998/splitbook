import { vi } from 'vitest';
import { recordWriter } from './test-utils/recordings/harness';

vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);

recordWriter('settlement-batch');
