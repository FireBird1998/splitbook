import { randomUUID } from 'node:crypto';
import { test, expect, dataOf, joinGroup } from './fixtures';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';

for (const size of ['desktop', 'phone'] as const) {
  for (const mode of ['light', 'dark'] as const) {
    test(`${size}-${mode}: exports keep both payment amounts and every currency section`, async ({
      page,
      ledger,
    }, testInfo) => {
      await page.setViewportSize(
        size === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
      );
      await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
      const group = await dataOf(
        await ledger.alex.post('/api/groups', {
          data: {
            name: 'Fictional Europe trip',
            category: 'trip',
            defaultCurrency: 'INR',
            alternateCurrencies: ['EUR', 'JPY'],
          },
        }),
        201,
      );
      await joinGroup(ledger.alex, ledger.sam, group._id);
      await dataOf(
        await ledger.alex.post(`/api/groups/${group._id}/expenses`, {
          headers: { 'Idempotency-Key': randomUUID() },
          data: {
            description: 'Fictional ferry tickets',
            amount: 40,
            currency: 'EUR',
            category: 'transport',
            tag: 'General',
            date: '2026-10-20',
            paidBy: [{ user: DEMO_PERSONA_IDS.alex, amount: 40 }],
            splitMethod: 'equal',
            splitBetween: [{ user: DEMO_PERSONA_IDS.alex }, { user: DEMO_PERSONA_IDS.sam }],
          },
        }),
        201,
      );
      await dataOf(
        await ledger.sam.post(`/api/groups/${group._id}/settlements`, {
          headers: { 'Idempotency-Key': randomUUID() },
          data: {
            paidTo: DEMO_PERSONA_IDS.alex,
            amount: 20,
            currency: 'EUR',
            amountPaidMinor: 185000,
            paidCurrency: 'INR',
            appliedRate: '92.5',
            rateKind: 'custom',
            suggestedRate: '92.1',
            rateSource: 'frankfurter',
            rateAsOf: '2026-10-20',
            rateFetchedAt: '2026-10-21T12:00:00Z',
          },
        }),
        201,
      );
      const baseURL = process.env.EXPENSE_ACCESS_BASE_URL!;
      await page.context().addCookies((await ledger.alex.storageState()).cookies);
      await page.goto(`${baseURL}/export?group=${group._id}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      await page.getByLabel('Period', { exact: true }).selectOption('all');
      const preview = page.getByRole('region', { name: 'Preview', exact: true });
      await expect(
        preview.getByRole('columnheader', { name: 'Amount paid', exact: true }),
      ).toBeVisible();
      await expect(preview).toContainText('1850.00');
      await expect(preview).toContainText('92.5');
      await expect(preview).toContainText('Cross-currency payments add Amount paid, Paid currency and Rate');
      await page.screenshot({
        path: testInfo.outputPath(`${size}-${mode}-csv-preview.png`),
        fullPage: true,
      });
      await page.getByLabel('Format', { exact: true }).selectOption('statement');
      for (const currency of ['EUR', 'INR', 'JPY'])
        await expect(
          preview.getByRole('region', { name: `${currency} statement preview`, exact: true }),
        ).toBeVisible();
      await expect(preview).toContainText('JPY: nothing in this period; everyone is settled up.');
      await expect(preview).toContainText(
        'Sam Chen paid Alex Rivera ₹1,850.00 to clear €20.00 at ₹92.50 per €, suggested ₹92.10 (20 Oct)',
      );
      await page.screenshot({
        path: testInfo.outputPath(`${size}-${mode}-statement-preview.png`),
        fullPage: true,
      });
      await page.getByRole('link', { name: 'Open statement', exact: true }).click();
      await page.emulateMedia({ media: 'print' });
      for (const currency of ['EUR', 'INR', 'JPY'])
        await expect(
          page.getByRole('region', { name: `${currency} statement`, exact: true }),
        ).toBeVisible();
      await expect(page.locator('.statement-paper')).toContainText('₹1,850.00 to clear €20.00');
      await page.emulateMedia({ media: 'screen' });
      await page.goto(`${baseURL}/export?group=${group._id}`);
      await page.getByLabel('Format', { exact: true }).selectOption('json');
      await expect(preview).toContainText('Fictional Europe trip: INR, EUR, JPY');
      await expect(preview).toContainText(
        '1 Payment, including both amounts, currencies and stored rates',
      );
      await expect(preview).toContainText('1 Expense');
      await expect(preview).not.toContainText('1 Expenses');
      await page.screenshot({
        path: testInfo.outputPath(`${size}-${mode}-backup-preview.png`),
        fullPage: true,
      });
    });
  }
}
