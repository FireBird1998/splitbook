import { expect, test } from '@playwright/test';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectThemeApplied,
  expectNoSeriousA11yViolations,
  reviewScreenshot,
} from './fixtures';
import { seedToReview } from './to-review-seed';

test.afterEach(async () => {
  await seedToReview(0);
});
test('To review card and Group banner share counts, sources and links; empty hides both', async ({
  page,
}, testInfo) => {
  await seedToReview(2);
  await enterAsPersona(page, 'alex');
  await expectThemeApplied(page, testInfo);
  const card = page.getByRole('region', { name: 'To review · 2', exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('2 from Claude · 2 needs details');
  await expect(card).toContainText('Only you see these');
  await expect(card.getByRole('link', { name: new RegExp(DEMO_TRIP_NAME) })).toHaveAttribute(
    'href',
    `/groups/${DEMO_GROUP_ID}/review`,
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%';
  });
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-home');
  await reviewScreenshot(page, testInfo, 'to-review-home');
  await page.goto(`/groups/${DEMO_GROUP_ID}/expenses`);
  const banner = page.getByRole('region', { name: 'To review', exact: true });
  await expect(banner).toContainText('2 to review · 2 from Claude today · 2 needs details');
  await expect(banner.getByRole('link', { name: 'Review', exact: true })).toHaveAttribute(
    'href',
    `/groups/${DEMO_GROUP_ID}/review`,
  );
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%';
  });
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-group');
  await reviewScreenshot(page, testInfo, 'to-review-group');
  await seedToReview(0);
  await page.reload();
  await expect(banner).toHaveCount(0);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /^To review/ })).toHaveCount(0);
});

test('Home and the Group banner stay hidden while loading and offer retry on failure', async ({
  page,
}) => {
  let release: () => void = () => {};
  let fail = true;
  await page.route('**/api/user/to-review', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      status: fail ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify(
        fail ? { error: 'Unavailable' } : { status: 200, data: { total: 0, groups: [] } },
      ),
    });
  });
  const homeRequested = page.waitForRequest('**/api/user/to-review');
  await enterAsPersona(page, 'alex');
  await homeRequested;
  await expect(page.getByRole('region', { name: /^To review/ })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Loading To review' })).toHaveCount(0);
  release();
  const card = page.getByRole('region', { name: 'To review', exact: true });
  await expect(card).toContainText('Unable to load To review.');
  fail = false;
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect
    .poll(async () => {
      release();
      return card.isVisible();
    })
    .toBe(false);
  fail = true;
  const requested = page.waitForRequest('**/api/user/to-review');
  await page.goto(`/groups/${DEMO_GROUP_ID}/expenses`);
  await requested;
  await expect(page.getByRole('status', { name: 'Loading To review' })).toHaveCount(0);
  release();
  const banner = page.getByRole('region', { name: 'To review', exact: true });
  await expect(banner).toContainText('Unable to load To review.');
  fail = false;
  await banner.getByRole('button', { name: 'Try again' }).click();
  await expect
    .poll(async () => {
      release();
      return banner.isVisible();
    })
    .toBe(false);
});

test('empty Home never mounts a To review card while the read is pending', async ({
  page,
}, testInfo) => {
  await seedToReview(0);
  await page.addInitScript(() => {
    const seen = { card: false };
    Object.assign(window, { toReviewSeen: seen });
    const observer = new MutationObserver(() => {
      if (document.querySelector('[aria-labelledby="to-review-heading"]')) seen.card = true;
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/user/to-review', async (route) => {
    await held;
    await route.continue();
  });
  const requested = page.waitForRequest('**/api/user/to-review');
  await enterAsPersona(page, 'alex');
  await requested;
  await expectThemeApplied(page, testInfo);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '130%';
  });
  await expect(page.getByRole('region', { name: /^To review/ })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'Loading To review' })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-empty-home-loading');
  const response = page.waitForResponse('**/api/user/to-review');
  release();
  expect((await (await response).json()).data.total).toBe(0);
  await expect(page.getByRole('region', { name: /^To review/ })).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, 'toReviewSeen').card)).toBe(false);
  await expectNoSeriousA11yViolations(page, testInfo, 'to-review-empty-home-loaded');
});
