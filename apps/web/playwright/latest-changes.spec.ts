import { expect, test, type Page } from '@playwright/test';
import { DEMO_PERSONA_IDS } from '../src/lib/demo-personas';
import {
  DEMO_GROUP_ID,
  DEMO_TRIP_NAME,
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
  reviewScreenshot,
} from './fixtures';

/**
 * Home's latest changes (#309) on the seeded demo data. Journeys elsewhere add changes too, so
 * this one makes its own at the top of the list: Alex adds an Expense to the Goa trip, edits
 * its amount and deletes it, which leaves every balance as it was.
 */

const { alex, sam } = DEMO_PERSONA_IDS;

/** An Expense Alex paid for and split with Sam, as the Expense form sends it. */
const expense = (description: string, amount: number) => ({
  description,
  amount,
  currency: 'INR',
  category: 'food',
  tag: 'Food',
  date: new Date().toISOString().slice(0, 10),
  paidBy: [{ user: alex, amount }],
  splitMethod: 'equal',
  splitBetween: [{ user: alex }, { user: sam }],
});

async function addEditAndDelete(page: Page, description: string) {
  const path = `/api/groups/${DEMO_GROUP_ID}/expenses`;
  const created = await page.request.post(path, { data: expense(description, 240) });
  expect(created.status()).toBe(201);
  const { data } = await created.json();
  const edited = await page.request.patch(`${path}/${data._id}`, {
    data: expense(description, 360),
    headers: { 'X-Splitbook-Revision': String(data.revision ?? 0) },
  });
  expect(edited.status()).toBe(200);
  const { data: saved } = await edited.json();
  const deleted = await page.request.delete(`${path}/${data._id}`, {
    headers: { 'X-Splitbook-Revision': String(saved.revision) },
  });
  expect(deleted.status()).toBe(200);
}

test('Home lists the latest changes across Groups, newest first, with an edit as old → new', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'alex');
  const description = `Ferry snacks (${testInfo.project.name})`;
  await addEditAndDelete(page, description);
  await page.reload();

  const card = page.getByRole('region', { name: 'Latest changes' });
  const entries = card.getByRole('listitem');
  await expect(entries).toHaveCount(10);
  const [deleted, edited, added] = ['deleted', 'edited', 'added'].map((action) =>
    entries.filter({ hasText: `You ${action} ${description}` }),
  );
  // Seen as "₹240.00 → ₹360.00"; the words for screen readers are hidden from sight.
  await expect(edited).toContainText(/₹240\.00 →.*₹360\.00/);
  await expect(added).toContainText('₹240.00');
  for (const entry of [deleted, edited, added]) {
    await expect(entry).toContainText(`${DEMO_TRIP_NAME} · Today at`);
    await expect(entry.getByRole('link')).toHaveAttribute('href', `/groups/${DEMO_GROUP_ID}`);
  }
  // Newest first. Other journeys may write to Alex's Groups meanwhile, so only the order is fixed.
  const texts = await entries.allTextContents();
  const position = (action: string) =>
    texts.findIndex((entry) => entry.includes(`You ${action} ${description}`));
  expect(position('deleted')).toBeLessThan(position('edited'));
  expect(position('edited')).toBeLessThan(position('added'));
  // Screen readers hear the edit as "from … to …", not the arrow.
  await expect(edited.getByRole('link')).toHaveAccessibleName(/from ₹240\.00\s+to ₹360\.00/);
  // There is no page of every Group's Activity, so no "All activity" link.
  await expect(card.getByRole('link', { name: 'All activity' })).toHaveCount(0);

  await expectThemeApplied(page, testInfo);
  await card.scrollIntoViewIfNeeded();
  await expectNoSeriousA11yViolations(page, testInfo, 'home-latest-changes');
  await reviewScreenshot(page, testInfo, 'home-latest-changes');

  // An entry leads to its Group.
  await edited.getByRole('link').click();
  await page.waitForURL((url) => url.pathname === `/groups/${DEMO_GROUP_ID}`);
  await expect(page.getByRole('main').getByText(DEMO_TRIP_NAME).first()).toBeVisible();
});

test('the card fails on its own, says so, and recovers with Try again', async ({ page }) => {
  let failing = true;
  await page.route(
    (url) => url.pathname === '/api/user/activity',
    async (route) => {
      if (failing) await route.fulfill({ status: 500, json: { error: 'Internal diagnostic' } });
      else await route.fallback();
    },
  );
  await enterAsPersona(page, 'alex');

  const card = page.getByRole('region', { name: 'Latest changes' });
  const error = card.getByRole('alert');
  await expect(error).toHaveText(/Latest changes could not be loaded\./);
  await expect(page.getByText(/Internal diagnostic/)).toHaveCount(0);
  // The rest of Home is unaffected.
  await expect(page.getByRole('region', { name: 'Current balance' })).toBeVisible();

  failing = false;
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(error).toHaveCount(0);
  await expect(card.getByRole('listitem').first()).toBeVisible();
});
