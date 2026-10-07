import { expect, test, type Page } from '@playwright/test';
import {
  enterAsPersona,
  expectNoSeriousA11yViolations,
  expectThemeApplied,
} from '../playwright/fixtures';

/**
 * The Insights tab's Recurring Expenses card (#315) on the seeded Household, Banyan Court Flat
 * 4B. It shows only while recurring Expenses are switched on, one product-wide switch (#289);
 * the pilot's app has them on, the demo suite's off (`group-insights-detail.spec.ts` checks
 * that the card is absent there). Real reads, no fixtures: each template's amount and next date
 * are compared with the insights read. Priya, the Household's admin, follows Manage to where
 * they are managed; Alex, a member, who can't change them, is told who can.
 */

const HOUSEHOLD_ID = 'a00000000000000000000201';
const INSIGHTS = `/groups/${HOUSEHOLD_ID}/insights`;

interface TemplateRead {
  description: string;
  amountMinor: number;
  nextDate: string | null;
}

async function insightsRead(page: Page) {
  const timeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const response = await page.request.get(
    `/api/groups/${HOUSEHOLD_ID}/insights?compare=6&tz=${encodeURIComponent(timeZone)}`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as {
    month: string;
    currency: string;
    recurringExpenses: boolean;
    recurring: { templates: TemplateRead[] };
  };
}

function money(minor: number, currency: string) {
  const format = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  return format.format(minor / 10 ** format.resolvedOptions().maximumFractionDigits!);
}

/**
 * A template's next day as the card writes it, "Next Mon 5 Oct", with the year when it isn't
 * the current Month's: a calendar day, read in no zone.
 */
function next(day: string, currentMonth: string) {
  const [year, month, date] = day.split('-').map(Number);
  const at = Date.UTC(year, month - 1, date);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(at);
  const label = `${part({ weekday: 'short' })} ${date} ${part({ month: 'short' })}`;
  return `Next ${label}${day.slice(0, 4) === currentMonth.slice(0, 4) ? '' : ` ${year}`}`;
}

const recurringCard = (page: Page) =>
  page.getByRole('main').getByRole('region', { name: 'Recurring Expenses' });

test('the Recurring Expenses card lists the Household’s templates, and an admin manages them', async ({
  page,
}, testInfo) => {
  await enterAsPersona(page, 'priya');
  await page.goto(INSIGHTS);
  await expectThemeApplied(page, testInfo);
  const read = await insightsRead(page);
  expect(read.recurringExpenses).toBe(true);
  expect(read.recurring.templates.map((template) => template.description).sort()).toEqual([
    'Broadband (300 Mbps)',
    'Flat rent',
  ]);

  const card = recurringCard(page);
  const items = card.getByRole('list', { name: 'Recurring Expenses' }).getByRole('listitem');
  await expect(items).toHaveCount(read.recurring.templates.length, { timeout: 30_000 });
  for (const [index, template] of read.recurring.templates.entries()) {
    const row = items.nth(index);
    await expect(row).toContainText(template.description);
    await expect(row).toContainText(money(template.amountMinor, read.currency));
    await expect(row).toContainText(/Monthly on the \d{1,2}(st|nd|rd|th)/);
    if (template.nextDate) await expect(row).toContainText(next(template.nextDate, read.month));
  }
  // The word is recurring Expenses, never bills.
  await expect(card).not.toContainText(/bill/i);
  await expectNoSeriousA11yViolations(page, testInfo, 'group-insights-recurring');

  await card.getByRole('link', { name: 'Manage recurring Expenses' }).click();
  await page.waitForURL(
    (url) =>
      url.pathname === `/groups/${HOUSEHOLD_ID}/settings` && url.hash === '#recurring-expenses',
  );
  const section = page.locator('#recurring-expenses');
  await expect(section).toContainText('Flat rent', { timeout: 30_000 });
  await expect(section).toContainText('Broadband (300 Mbps)');
  // An in-app navigation: the section, which mounts after the Group's read, still brings
  // itself into view and takes focus at its heading.
  await expect(section).toBeInViewport();
  await expect(section.getByText('Recurring', { exact: true })).toBeFocused();
  await expect(section.getByText('Recurring', { exact: true })).toBeInViewport();
});

test('a member who isn’t an admin sees the templates, and who can change them', async ({
  page,
}) => {
  await enterAsPersona(page, 'alex');
  await page.goto(INSIGHTS);
  const card = recurringCard(page);
  await expect(card.getByRole('listitem')).toHaveCount(2, { timeout: 30_000 });
  await expect(card).toContainText('Only the Group’s admins can change recurring Expenses.');
  await expect(card.getByRole('link')).toHaveCount(0);
});
