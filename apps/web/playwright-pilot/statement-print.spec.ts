import { expect, test } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import { enterAsPersona } from '../playwright/fixtures';

test('statement print uses clean A4 light colours in every theme', async ({ page }) => {
  await enterAsPersona(page, 'alex');
  const response = await page.request.post('/api/groups', {
    data: {
      name: 'Ferry statement',
      category: 'trip',
      defaultCurrency: 'INR',
      alternateCurrencies: [],
    },
  });
  expect(response.status()).toBe(201);
  const id = (await response.json()).data._id;
  const expense = await page.request.post(`/api/groups/${id}/expenses`, {
    data: {
      description: 'Ferry tickets',
      date: '2026-09-01',
      amount: 101.01,
      currency: 'INR',
      category: 'transport',
      tag: 'General',
      paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 101.01 }],
      splitMethod: 'equal',
      splitBetween: [{ user: DEMO_PERSONA_IDS.alex }],
    },
  });
  expect(expense.status(), await expense.text()).toBe(201);
  await page.goto(`/groups/${id}/statement?tz=Asia%2FKolkata&from=2026-09-01&to=2026-09-10`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ferry statement · Statement');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('aside')).toBeHidden();
  await expect(page.locator('.statement-paper')).toHaveScreenshot('statement-print.png', {
    animations: 'disabled',
  });
});
