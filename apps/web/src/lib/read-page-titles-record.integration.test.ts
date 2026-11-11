import { metadataReads } from './test-utils/reads/metadata';
import { expect, it, vi } from 'vitest';
import { callRoute } from './test-utils/signed-in-route';
import { readCases, readFixture } from './test-utils/reads/fixture';
vi.mock('next/headers', async () => (await import('./test-utils/signed-in-route')).nextHeaders);
vi.mock('next/server', async (original) =>
  (await import('./test-utils/signed-in-route')).nextServer(original),
);
const fixture = readFixture('page-titles');
for (const read of metadataReads)
  for (const state of readCases)
    it(`${read.name} / ${state}`, async () => {
      const access = await fixture.arrange(state);
      const { generateMetadata } = await read.load();
      const record = await fixture.capture(async () => {
        const response = await callRoute(
          async () =>
            Response.json(
              await generateMetadata({ params: Promise.resolve({ id: access.groupId }) }),
            ),
          { method: 'GET', path: `/groups/${access.groupId}`, cookie: access.cookie },
        );
        // Metadata has no HTTP status. The wrapper supplies only Next's request headers.
        return response.body;
      });
      expect(record.addedDueExpense).toBe(false);
    });
