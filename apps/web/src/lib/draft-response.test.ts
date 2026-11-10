import { mongo } from 'mongoose';
import { MoneyValidationError } from '@splitbook/shared/exact-money';
import { Refusal } from '@splitbook/shared/refusals';
import { draftError } from './draft-response';
import { expect, it, vi } from 'vitest';
import { auth } from '@/lib/auth';
import { POST as create } from '@/app/api/groups/[id]/drafts/route';
import { POST as save } from '@/app/api/groups/[id]/drafts/save/route';
import savedAnswers from './refusal-census-draft-answers.json';

vi.mock('next/headers', () => ({ headers: () => new Headers() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/lib/db', () => ({ default: vi.fn() }));

// Supplemental baseline recorded on origin's #1082 responder before moving Drafts.
// The original census snapshots remain immutable.
it.each([
  {
    subject: 'creation',
    handler: create,
    body: '{"error":"Draft request not confirmed. Reload before retrying; reuse the original creation request.","status":503,"code":"DRAFT_UNCONFIRMED"}',
  },
  { subject: 'save', handler: save, body: savedAnswers[0].body },
])('keeps the $subject HTTP fault answer private and byte for byte', async ({ handler, body }) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(auth.api.getSession).mockRejectedValue(new Error('submitted private data'));
  const answer = await handler(new Request('http://localhost/api/drafts', { method: 'POST' }), {
    params: Promise.resolve({ id: 'a00000000000000000000001' }),
  });
  expect(answer.status).toBe(503);
  expect(await answer.text()).toBe(body);
  expect(answer.headers.get('Cache-Control')).toBe('private, no-store');
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});

it.each([
  Object.assign(new Error('revision race'), { name: 'VersionError' }),
  new MoneyValidationError('INVALID_MONEY', 'Private amount problem', ['amount']),
  new mongo.MongoOperationTimeoutError('operation timed out'),
  new Refusal('INVALID_TAG'),
])('keeps an unclassified Draft save failure uncertain (%s)', async (cause) => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  log.mockClear();
  vi.mocked(auth.api.getSession).mockRejectedValue(cause);
  const answer = await save(new Request('http://localhost/api/drafts/save', { method: 'POST' }), {
    params: Promise.resolve({ id: 'a00000000000000000000001' }),
  });
  expect(answer.status).toBe(503);
  expect(await answer.text()).toBe(savedAnswers[0].body);
  expect(log).not.toHaveBeenCalled();
  log.mockRestore();
});

it('answers a typed refusal by kind without a positive code list', async () => {
  const response = draftError(new Refusal('EXPORT_TOO_LARGE', { rows: 3, limit: 2 }));
  expect(response.status).toBe(413);
  expect(await response.text()).toBe(
    '{"error":"This export would have 3 rows, more than the 2 one download can hold. Pick fewer Groups or a shorter period.","status":413,"code":"EXPORT_TOO_LARGE"}',
  );
});
