import { expect, test } from '@playwright/test';
import { enterAsPersona, expectNoSeriousA11yViolations } from './fixtures';

test('Settings names assistants and only a confirmed Disconnect revokes access', async ({
  page,
}, testInfo) => {
  let revocations = 0;
  await page.route('**/api/auth/mcp/connections*', (route) =>
    route.fulfill({
      json: {
        resource: 'https://assistant.example.test/api/mcp',
        nextOffset: null,
        connections: [
          {
            id: 'fictional-connection',
            clientId: 'https://assistant.example.test/client.json',
            name: 'Fictional assistant',
            scopes: ['ledger:read', 'drafts:write'],
            access: 'Ledger + To review',
            lastUsedAt: null,
          },
        ],
      },
    }),
  );
  await page.route('**/api/auth/mcp/revoke', (route) => {
    revocations += 1;
    expect(route.request().postDataJSON()).toEqual({ id: 'fictional-connection' });
    return route.fulfill({ json: { disconnected: true } });
  });
  await enterAsPersona(page, 'alex');
  await page.goto('/settings');
  await expect(page.getByText('Fictional assistant', { exact: true })).toBeVisible();
  await expect(page.getByText('Read only + To review', { exact: true })).toBeVisible();
  await expect(page.getByText('Not used yet', { exact: true })).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Disconnect Fictional assistant, assistant.example.test/client.json',
      exact: true,
    })
    .click();
  const confirmation = page.getByRole('dialog', { name: 'Disconnect Fictional assistant?' });
  await expect(confirmation).toContainText(
    'The assistant stops at once. Items already prepared stay in your To review.',
  );
  expect(revocations).toBe(0);
  await page.clock.install();
  // The page's own time, a second on: the installed clock keeps running, so the test process's
  // time can already be behind it, and pausing in the past throws (#825).
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('#disconnect-assistant-title')).toHaveText(
    'Disconnect Fictional assistant?',
  );
  await page.clock.resume();
  await expect(confirmation).toBeHidden();
  expect(revocations).toBe(0);
  await page
    .getByRole('button', {
      name: 'Disconnect Fictional assistant, assistant.example.test/client.json',
      exact: true,
    })
    .click();
  await expectNoSeriousA11yViolations(page, testInfo, 'assistant-disconnect');
  await confirmation.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByText('No assistants connected.', { exact: true })).toBeVisible();
  expect(revocations).toBe(1);
});
