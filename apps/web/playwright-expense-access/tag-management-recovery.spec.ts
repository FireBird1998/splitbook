import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { tagSnapshotSchema } from '@splitbook/shared/tag-management';
import { test, expect, dataOf } from './fixtures';

for (const profile of [
  { name: 'desktop-light', width: 1280, height: 900, mode: 'light' },
  { name: 'mobile-dark', width: 390, height: 844, mode: 'dark' },
] as const) {
  test(`${profile.name}: interrupted Tag creation survives reload and shows its later name`, async ({
    ledger,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: profile.width, height: profile.height });
    await page.emulateMedia({ colorScheme: profile.mode });
    await page.context().addCookies((await ledger.priya.storageState()).cookies);
    const path = `/api/groups/${ledger.groupB}/tag-actions`;
    const baseURL = process.env.EXPENSE_ACCESS_BASE_URL!;
    let writes = 0;
    await page.route(`**${path}`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      writes++;
      const applied = await route.fetch();
      expect(applied.status(), await applied.text()).toBe(200);
      await route.abort('failed');
    });
    await page.goto(`${baseURL}/groups/${ledger.groupB}/settings`);
    await page.getByRole('button', { name: 'Manage Tags', exact: true }).click();
    await page.getByRole('button', { name: 'Create Tag', exact: true }).click();
    await page.getByRole('textbox', { name: 'Tag name', exact: true }).fill('Villa');
    await page.getByRole('button', { name: 'Apply change', exact: true }).click();
    await expect(
      page.getByText('The result is unconfirmed. Check the action or retry its original request.'),
    ).toBeVisible();
    expect(writes).toBe(1);
    const before = tagSnapshotSchema.parse(await dataOf(await ledger.priya.get(path)));
    const villa = before.tags.find((tag) => tag.name === 'Villa')!;
    expect(villa).toBeTruthy();
    await dataOf(
      await ledger.priya.post(path, {
        data: {
          requestId: randomUUID(),
          intent: {
            action: 'rename',
            tagId: villa.id,
            expectedRevision: villa.revision,
            name: 'Later lodge',
          },
        },
      }),
    );
    await page.reload();
    await page.getByRole('button', { name: 'Manage Tags', exact: true }).click();
    await expect(page.getByText('Unconfirmed Tag action', { exact: true })).toBeVisible();
    expect(writes).toBe(1);
    await page.getByRole('button', { name: 'Check action', exact: true }).click();
    await expect(page.getByText('Create confirmed', { exact: true })).toBeVisible();
    await expect(page.getByText('Submitted name: Villa', { exact: true })).toBeVisible();
    await expect(page.getByText('Current Tag: Later lodge', { exact: true })).toBeVisible();
    expect(writes).toBe(1);
    const accessibility = await new AxeBuilder({ page })
      .include('[role="region"][aria-label="Manage Tags"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      .toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('confirmed-earlier-tag-action.png'),
      fullPage: true,
    });
    const current = tagSnapshotSchema.parse(await dataOf(await ledger.priya.get(path)));
    expect(current.tags.filter((tag) => tag.id === villa.id)).toHaveLength(1);
    expect(current.tags.some((tag) => tag.name === 'Villa')).toBe(false);
  });
}
