import { expect, type Page, type TestInfo } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

/** Demo personas rendered by the persona picker. */
export const PERSONAS = {
  alex: 'Alex Rivera',
  sam: 'Sam Chen',
  priya: 'Priya Shah',
} as const;

export type PersonaKey = keyof typeof PERSONAS;

/** Seeded demo trip (see src/lib/demo-personas.ts). */
export const DEMO_GROUP_ID = 'a00000000000000000000010';
export const DEMO_TRIP_NAME = 'Goa Friends Trip';

/** Enter the demo as a persona and land on a loaded dashboard. */
export async function enterAsPersona(page: Page, persona: PersonaKey): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: `Enter as ${PERSONAS[persona]}` }).click();
  await page.waitForURL((url) => url.pathname === '/dashboard');
  await expect(
    page.getByRole('heading', { name: /good (morning|afternoon|evening)/i }),
  ).toBeVisible();
}

/** Sign out via the navbar account menu and land back on the persona picker. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign Out' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('button', { name: `Enter as ${PERSONAS.alex}` })).toBeVisible();
}

/** Switch from the current persona to another one. */
export async function switchPersona(page: Page, persona: PersonaKey): Promise<void> {
  await signOut(page);
  await enterAsPersona(page, persona);
}

/** Expected theme mode for the current project (from its colorScheme). */
export function expectedTheme(testInfo: TestInfo): 'light' | 'dark' {
  return testInfo.project.name.endsWith('-dark') ? 'dark' : 'light';
}

/** Assert the document carries the project's expected theme. */
export async function expectThemeApplied(page: Page, testInfo: TestInfo): Promise<void> {
  const theme = expectedTheme(testInfo);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe(theme);
}

/** Save a full-page screenshot for design review under playwright/artifacts/. */
export async function reviewScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.screenshot({
    path: `playwright/artifacts/${testInfo.project.name}/${name}.png`,
    fullPage: true,
  });
}

/**
 * Run an axe-core scan and fail on critical violations. The full violation
 * list (including serious/minor, e.g. contrast suggestions) is attached to
 * the test report for review.
 */
export async function expectNoCriticalA11yViolations(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  await testInfo.attach(`axe-${name}`, {
    body: JSON.stringify(
      results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        nodes: violation.nodes.length,
      })),
      null,
      2,
    ),
    contentType: 'application/json',
  });

  const critical = results.violations.filter((violation) => violation.impact === 'critical');
  expect(
    critical,
    `Critical accessibility violations on ${name}: ${JSON.stringify(
      critical.map((violation) => violation.id),
    )}`,
  ).toEqual([]);
}

/** Parse the first currency amount (e.g. "₹1,480.00") found in a text blob. */
export function parseMoneyText(text: string): number {
  const match = text.match(/[₹$€£]([\d,]+(?:\.\d{1,2})?)/);
  if (!match) throw new Error(`No currency amount found in: ${text}`);
  return Number(match[1].replace(/,/g, ''));
}
