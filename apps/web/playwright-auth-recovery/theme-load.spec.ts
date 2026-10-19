import { test, expect } from '@playwright/test';
import { signTestIdToken } from '../src/lib/auth/test-id-token';
import { THEME_STORAGE_KEY } from '../src/lib/product';

for (const preference of ['stored', 'system'] as const) {
  test(`dark ${preference} preference survives first paint and hydration on Landing, Home and a Group`, async ({
    page,
  }) => {
    const base = process.env.EXPENSE_ACCESS_BASE_URL!;
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ colorScheme: preference === 'system' ? 'dark' : 'light' });
    await page.addInitScript(
      ({ preference, key }) => {
        if (preference === 'stored') localStorage.setItem(key, 'dark');
        else localStorage.removeItem(key);
        const samples: { theme: string | null; background: string }[] = [];
        const writes: string[] = [];
        Object.assign(window, { themeSamples: samples, themeWrites: writes });
        const set = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (name, value) {
          if (this === document.documentElement && name === 'data-theme') writes.push(value);
          return set.call(this, name, value);
        };
        const sample = () => {
          if (document.body?.children.length)
            samples.push({
              theme: document.documentElement.getAttribute('data-theme'),
              background: getComputedStyle(document.body).backgroundColor,
            });
          if (samples.length < 90) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      },
      { preference, key: THEME_STORAGE_KEY },
    );
    const checkLoad = async (path: string) => {
      await page.goto(`${base}${path}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.waitForFunction(
        () => (window as unknown as { themeSamples: unknown[] }).themeSamples.length >= 60,
      );
      const observed = await page.evaluate(() => {
        const state = window as unknown as {
          themeSamples: { theme: string | null; background: string }[];
          themeWrites: string[];
        };
        return { samples: state.themeSamples, writes: state.themeWrites };
      });
      expect(observed.writes, path).not.toContain('light');
      expect(
        observed.samples.map((sample) => sample.background),
        path,
      ).not.toContain('rgb(244, 245, 249)');
      expect(
        observed.samples.map((sample) => sample.theme),
        path,
      ).not.toContain('light');
      expect(errors.filter((error) => /hydrat|did not match|server rendered/i.test(error))).toEqual(
        [],
      );
    };
    await checkLoad('/');
    const token = signTestIdToken(
      {
        sub: 'auth-recovery-user',
        email: 'auth-recovery@splitbook.test',
        name: 'Auth Recovery User',
      },
      process.env.AUTH_RECOVERY_TEST_ID_TOKEN_SECRET!,
    );
    const signedIn = await page.request.post(`${base}/api/auth/sign-in/social`, {
      data: { provider: 'google', idToken: { token } },
    });
    expect(signedIn.status()).toBe(200);
    const created = await page.request.post(`${base}/api/groups`, {
      data: { name: 'Theme check', category: 'trip', defaultCurrency: 'INR' },
    });
    expect(created.status()).toBe(201);
    const group = (await created.json()).data;
    await checkLoad('/dashboard');
    await checkLoad(`/groups/${group._id}/expenses`);
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 245, 249)');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(14, 16, 22)');
  });
}
