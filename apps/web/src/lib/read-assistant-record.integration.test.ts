import { vi } from 'vitest';
import { readFixture } from './test-utils/reads/fixture';
import {
  assistantTools,
  assistantReadCases,
  connectionReadCases,
} from './test-utils/reads/assistant';
vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = readFixture('assistant');
assistantReadCases(fixture, assistantTools.slice(0, 4));
connectionReadCases(fixture);
