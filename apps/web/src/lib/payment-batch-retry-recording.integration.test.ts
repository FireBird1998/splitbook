import { vi } from 'vitest';
import { paymentRetryPaths } from './test-utils/recordings/payment-retries';
vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
paymentRetryPaths('settlement-batch');
