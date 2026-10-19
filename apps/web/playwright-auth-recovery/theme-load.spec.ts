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
      // Hold the client bundles so these assertions observe the server's first paint,
      // before React can adopt the preference or repair an artwork variant.
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const scripts = '**/_next/static/**/*.js';
      await page.route(scripts, async (route) => {
        await held;
        await route.continue();
      });
      try {
        await page.goto(`${base}${path}`, { waitUntil: 'commit' });
        await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(14, 16, 22)');
        const brand = page.locator('img[src^="/brand/"]:visible');
        await expect(brand.first()).toBeVisible();
        const sources = await brand.evaluateAll((images) =>
          images.map((image) => image.getAttribute('src')),
        );
        for (const source of sources)
          expect(
            ['/brand/mark-on-dark.svg', '/brand/logo-dark.svg'],
            `brand before hydration: ${path}`,
          ).toContain(source);
        if (path === '/') {
          await expect(page.locator('figure.iso').first()).toBeVisible();
          const papers = await page
            .locator('figure.iso')
            .evaluateAll((figures) =>
              figures.map((figure) =>
                getComputedStyle(figure).getPropertyValue('--anatomy-paper').trim(),
              ),
            );
          for (const paper of papers) expect(paper, 'figure before hydration').toBe('#131313');
        }
      } finally {
        release();
        await page.waitForLoadState('load');
        await page.unrouteAll({ behavior: 'wait' });
      }
      await page.waitForLoadState('load');
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

test('a light-theme toggle before preference adoption switches to dark', async ({ page }) => {
  const base = process.env.EXPENSE_ACCESS_BASE_URL!;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript((key) => {
    localStorage.removeItem(key);
    // Let hydration finish, but hold the frame that adopts the initial preference.
    window.requestAnimationFrame = () => 1;
  }, THEME_STORAGE_KEY);
  const token = signTestIdToken(
    {
      sub: 'auth-recovery-user',
      email: 'auth-recovery@splitbook.test',
      name: 'Auth Recovery User',
    },
    process.env.AUTH_RECOVERY_TEST_ID_TOKEN_SECRET!,
  );
  expect(
    (
      await page.request.post(`${base}/api/auth/sign-in/social`, {
        data: { provider: 'google', idToken: { token } },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`${base}/dashboard`);
  await page.waitForLoadState('networkidle');
  // A forced click does not wait for animation frames to establish layout stability.
  await page.getByRole('button', { name: 'Switch to dark mode' }).click({ force: true });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_STORAGE_KEY)).toBe('dark');
});

for (const attribute of ['missing', 'invalid'] as const) {
  test(`Landing figures stay light before hydration when the theme attribute is ${attribute}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(
      ({ attribute, key }) => {
        if (attribute === 'missing') {
          // The pre-paint script catches blocked storage and leaves the attribute unset.
          Storage.prototype.getItem = () => {
            throw new DOMException('Storage is blocked', 'SecurityError');
          };
        } else {
          localStorage.setItem(key, 'invalid-theme');
        }
      },
      { attribute, key: THEME_STORAGE_KEY },
    );
    // Inspect server-rendered colours without letting hydration repair the preference.
    await page.route('**/_next/static/**/*.js', (route) => route.abort());
    await page.goto(`${process.env.EXPENSE_ACCESS_BASE_URL!}/`);
    expect(await page.locator('html').getAttribute('data-theme')).toBe(
      attribute === 'missing' ? null : 'invalid-theme',
    );
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 245, 249)');
    const figures = page.locator('figure.iso');
    await expect(figures.first()).toBeVisible();
    for (const paper of await figures.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).getPropertyValue('--anatomy-paper').trim()),
    ))
      expect(paper).toBe('#fbfbfa');
  });
}

for (const mode of ['dark', 'light'] as const) {
  test(`Home avatar rings use ${mode} colours before preference adoption`, async ({ page }) => {
    const base = process.env.EXPENSE_ACCESS_BASE_URL!;
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(
      ({ key, mode }) => {
        localStorage.setItem(key, mode);
        // Home's rows only exist after client reads. Hold preference adoption while
        // those reads finish: their first paint must already use the root's palette.
        window.requestAnimationFrame = () => 1;
      },
      { key: THEME_STORAGE_KEY, mode },
    );
    const token = signTestIdToken(
      {
        sub: 'auth-recovery-user',
        email: 'auth-recovery@splitbook.test',
        name: 'Auth Recovery User',
      },
      process.env.AUTH_RECOVERY_TEST_ID_TOKEN_SECRET!,
    );
    expect(
      (
        await page.request.post(`${base}/api/auth/sign-in/social`, {
          data: { provider: 'google', idToken: { token } },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await page.request.post(`${base}/api/groups`, {
          data: { name: `Avatar ring ${mode}`, category: 'trip', defaultCurrency: 'INR' },
        })
      ).status(),
    ).toBe(201);
    await page.goto(`${base}/dashboard`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    const ring = page
      .getByRole('region', { name: 'Groups', exact: true })
      .locator('.MuiAvatar-root')
      .first();
    await expect(ring).toBeVisible();
    await expect(ring).toHaveCSS(
      'box-shadow',
      mode === 'dark' ? 'rgb(24, 27, 38) 0px 0px 0px 2px' : 'rgb(255, 255, 255) 0px 0px 0px 2px',
    );
  });
}
