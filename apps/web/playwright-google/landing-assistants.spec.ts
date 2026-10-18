import { expect, test, type Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from '../playwright/fixtures';

/**
 * The landing page where Connected assistants are live and can prepare items for To review
 * (#450), on playwright.google-assistants.config.ts's server. With them off, the auth suite's
 * landing tests check the section is absent.
 */

const section = (page: Page) => page.locator('#assistants');
/** Fig 2's plate, its drawing named by its full description, and the rack's waiting count. */
const fig2 = (page: Page) => page.getByRole('figure', { name: 'The To review rack' });
const fig2Drawing = (page: Page) =>
  fig2(page).getByRole('img', { name: /^A To review rack on a bench\./ });
const waiting = (page: Page) => fig2(page).locator('[data-count="rack"]');
const bar = (page: Page, item: number) => fig2Drawing(page).locator(`[data-bar="${item}"]`);

test('the hero and the top bar lead to Connected assistants, with Fig 2 and what an assistant can do', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(
    page.getByRole('navigation', { name: 'Splitbook' }).getByRole('link', { name: 'Assistants' }),
  ).toHaveAttribute('href', '#assistants');
  await page.getByRole('link', { name: 'Use Claude or ChatGPT? Connect Splitbook' }).click();
  await expect(page).toHaveURL(/#assistants$/);
  await expect(
    section(page).getByRole('heading', {
      level: 2,
      name: 'Talk to your Groups in Claude or ChatGPT.',
    }),
  ).toBeInViewport();
  // Splitbook never moves money; what an assistant prepares waits for the member (owner copy).
  await expect(section(page)).toContainText('Nothing is saved until you say so.');
  await expect(section(page)).not.toContainText('money only moves');

  for (const step of ['Ask, or tell it what you spent', 'Review and save'])
    await expect(section(page).getByRole('listitem').filter({ hasText: step })).toBeVisible();
  for (const name of [
    'Ask about your money',
    'Tell it what you spent',
    'You save, never the assistant',
    'Stay in control',
  ])
    await expect(section(page).getByRole('heading', { level: 3, name })).toBeVisible();
  await expect(section(page).getByRole('link', { name: 'How to connect ChatGPT' })).toHaveAttribute(
    'href',
    '/connect/chatgpt',
  );
  await fig2(page).scrollIntoViewIfNeeded();
  await expect(fig2Drawing(page)).toBeVisible();
  await expect(fig2(page)).toContainText('Bars with a blue tag: items an assistant prepared');

  await expectNoSeriousA11yViolations(page, testInfo, 'landing-assistants-desktop-light');
});

test('the assistants section fits a phone without sideways scroll, in dark', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/#assistants');
  await expect(section(page).getByRole('heading', { level: 2 })).toBeVisible();
  await fig2(page).scrollIntoViewIfNeeded();
  await expect(fig2Drawing(page)).toBeVisible();
  await expect(fig2(page)).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await expectNoSeriousA11yViolations(page, testInfo, 'landing-assistants-phone-dark');
});

test('under reduced motion Fig 2 holds its still, Dinner saved and Cab waiting, and steps through the rest', async ({
  page,
}) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await fig2(page).scrollIntoViewIfNeeded();

  // The documented still: Dinner is saved into the line, and Cab waits alone in the rack.
  await expect(waiting(page)).toHaveText('1');
  await expect(bar(page, 0)).toBeHidden();
  await expect(bar(page, 1)).toBeVisible();
  await expect(fig2(page)).toContainText(
    'Cab to the airport ₹600 waits in To review · nothing moves until you save it',
  );
  await expect(fig2(page).getByRole('button', { name: /^(Pause|Play)$/ })).toHaveCount(0);

  const tour = fig2(page).getByRole('group', { name: /^Live tour\./ });
  const status = fig2(page).getByRole('status');
  await tour.press('ArrowRight');
  await expect(waiting(page)).toHaveText('0');
  // Starting over is announced too, so the live region never keeps the still's words (#568).
  await expect(status).toHaveText('Claude connected · To review empty');
  await tour.press('ArrowRight');
  await expect(status).toHaveText('Claude prepares Dinner at Thalassa ₹2,400 · 3 × ₹800');
  await expect(waiting(page)).toHaveText('1');
  await tour.press('ArrowRight');
  await expect(status).toHaveText('Claude prepares Cab to the airport ₹600 · 2 × ₹300');
  await expect(waiting(page)).toHaveText('2');
  await tour.press('ArrowRight');
  // The lever lets only the bottom bar out: Dinner is saved, Cab stays.
  await expect(status).toHaveText(
    'Cab to the airport ₹600 waits in To review · nothing moves until you save it',
  );
  await expect(waiting(page)).toHaveText('1');
  await expect(bar(page, 0)).toBeHidden();

  // Nothing moves by itself.
  await page.clock.runFor(5_000);
  await expect(waiting(page)).toHaveText('1');
  await expect(bar(page, 1)).toBeVisible();
});

test('Fig 2 prepares and saves by itself on screen, and pauses from its button', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto('/');
  await fig2(page).scrollIntoViewIfNeeded();
  await expect(fig2(page).getByRole('status')).toHaveText(
    'Claude prepares Dinner at Thalassa ₹2,400 · 3 × ₹800',
    { timeout: 10_000 },
  );

  const drawing = () => fig2Drawing(page).evaluate((svg) => svg.innerHTML);
  await fig2(page).getByRole('button', { name: 'Pause' }).click();
  // Held, the step under way shows settled, then nothing moves.
  await page.clock.runFor(500);
  const held = await drawing();
  await page.clock.runFor(3_000);
  expect(await drawing()).toBe(held);
  await fig2(page).getByRole('button', { name: 'Play' }).click();
  await expect.poll(drawing).not.toBe(held);
  await expect(fig2(page).getByRole('status')).toHaveText(
    'You pull the lever · Dinner at Thalassa ₹2,400 is saved',
    { timeout: 15_000 },
  );
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the section still shows Fig 2 at its still: Dinner saved, Cab waiting by the lever', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(fig2Drawing(page)).toBeVisible();
    await expect(fig2(page)).toContainText(
      'Cab to the airport ₹600 waits in To review · nothing moves until you save it',
    );
    await expect(waiting(page)).toHaveText('1');
    await expect(bar(page, 0)).toBeHidden();
    await expect(bar(page, 1)).toBeVisible();
    // The member's lever is drawn, not just its mount.
    await expect(fig2Drawing(page).locator('[data-part="lever"] path').first()).toBeAttached();
    await expect(fig2(page).getByRole('group', { name: /^Live tour/ })).toHaveCount(0);
    await expect(fig2(page).getByRole('button', { name: /^(Pause|Play)$/ })).toHaveCount(0);
  });
});
