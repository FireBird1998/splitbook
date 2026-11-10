import { expect, it, vi } from 'vitest';
import { readTagCommand } from './tag-management-http';
import { serverError } from './utils/api-response';
vi.mock('next/headers', () => ({ headers: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));

it('answers a malformed Tag command through the central answering seam', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const cause = await readTagCommand(
    new Request('http://localhost/api/tag-actions', {
      method: 'POST',
      body: 'not JSON',
    }),
  ).catch((error: unknown) => error);
  const answer = serverError(cause);
  expect(answer.status).toBe(400);
  expect(await answer.text()).toBe(
    '{"error":"Check the Tag name and submitted action, then try again.","status":400,"code":"INVALID_TAG_COMMAND"}',
  );
  log.mockRestore();
});
