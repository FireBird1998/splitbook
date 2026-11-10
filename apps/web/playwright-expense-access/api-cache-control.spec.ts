import type { APIResponse } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { test, expect } from './fixtures';

const PRIVATE_NO_STORE = 'private, no-store';

function privateResponse(response: APIResponse, status: number, label: string) {
  expect.soft(response.status(), label).toBe(status);
  expect.soft(response.headers()['cache-control'], label).toBe(PRIVATE_NO_STORE);
}

test('the HTTP API prevents caching on successful and refused ledger requests (#1043)', async ({
  ledger,
}) => {
  const { alex, sam, priya, anonymous, groupB } = ledger;
  const group = `/api/groups/${groupB}`;

  privateResponse(await sam.get('/api/groups'), 200, 'Groups list');
  const anonymousGroups = await anonymous.get('/api/groups', { maxRedirects: 0 });
  privateResponse(anonymousGroups, 401, 'Groups list refused by the proxy');
  expect(await anonymousGroups.json()).toEqual({
    error: 'Unauthorized',
    status: 401,
    code: 'UNAUTHORIZED',
  });
  expect(anonymousGroups.headers().location).toBeUndefined();

  for (const [family, path] of [
    ['Group', group],
    ['Expenses', `${group}/expenses`],
    ['Balances', `${group}/balances`],
    ['Activity', `${group}/activity`],
    ['Tags', `${group}/tag-actions`],
    ['Drafts', `${group}/drafts`],
    ['rates', `${group}/rates?from=INR&to=INR`],
  ]) {
    privateResponse(await sam.get(path), 200, family);
    privateResponse(await alex.get(path), 403, `${family} refuses an outsider`);
  }

  const settlement = { paidTo: DEMO_PERSONA_IDS.priya, amount: 25, currency: 'INR' };
  privateResponse(await sam.post(`${group}/settlements`, { data: settlement }), 201, 'Settlement');
  privateResponse(
    await alex.post(`${group}/settlements`, { data: settlement }),
    403,
    'Settlement refuses an outsider',
  );
  privateResponse(
    await priya.post(`${group}/settlements`, { data: {} }),
    422,
    'Settlement validation error',
  );

  const exportPath = `/api/export?groups=${groupB}&include=shares&format=csv&tz=UTC`;
  const download = await sam.get(exportPath);
  privateResponse(download, 200, 'export download');
  expect(download.headers()['content-disposition']).toMatch(/^attachment; filename=/);
  expect(download.headers()['x-content-type-options']).toBe('nosniff');
  privateResponse(await alex.get(exportPath), 403, 'export refuses an outsider');
  privateResponse(await sam.get('/api/groups/000000000000000000000000'), 404, 'Group not found');
});

test('the HTTP API prevents caching on auth, MCP and cron responses (#1043)', async ({
  ledger,
}) => {
  const { sam, anonymous } = ledger;
  privateResponse(await sam.get('/api/auth/get-session'), 200, 'Better Auth session');
  privateResponse(
    await anonymous.post('/api/auth/demo-persona/sign-in', { data: {} }),
    400,
    'Better Auth rejects invalid sign-in',
  );
  privateResponse(await anonymous.post('/api/mcp', { data: {} }), 404, 'disabled MCP route');
  privateResponse(await anonymous.get('/api/mcp'), 405, 'MCP refuses an unsupported method');
  privateResponse(await anonymous.get('/api/cron/exchange-rates'), 401, 'rates cron refusal');

  // Next renders its own stronger cache policy when there is no matching route.
  const missing = await sam.get('/api/no-such-route');
  expect(missing.status()).toBe(404);
  expect(missing.headers()['cache-control'].split(/,\s*/)).toEqual(
    expect.arrayContaining(['private', 'no-store']),
  );
});

test('the landing page and its link preview keep their own cache policy (#1043)', async ({
  ledger: { anonymous },
}) => {
  const page = await anonymous.get('/');
  expect(page.status()).toBe(200);
  expect(page.headers()['content-type']).toContain('text/html');
  expect(page.headers()['cache-control']).not.toBe(PRIVATE_NO_STORE);

  const image = await anonymous.get('/landing-figures/splitting-line-light.png');
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/png');
  expect(image.headers()['cache-control']).toBe('public, max-age=0');
});
