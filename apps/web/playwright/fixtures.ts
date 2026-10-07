import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { darkTokens, lightTokens } from '../src/lib/theme/tokens';

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

/** Whether the project runs at phone width, where the sidebar is a drawer. */
export function isPhone(testInfo: TestInfo): boolean {
  return testInfo.project.name.startsWith('mobile-');
}

/**
 * The shell's navigation: the sidebar on desktop, or on phones the drawer, opened from the
 * top bar's menu button.
 */
export async function openNavigation(page: Page) {
  // The sidebar shows from MUI's lg breakpoint up.
  if (page.viewportSize()!.width >= 1200)
    return page.getByRole('complementary', { name: 'Splitbook' });
  const drawer = page.getByRole('dialog', { name: 'Navigation menu' });
  const menu = page.getByRole('banner').getByRole('button', { name: 'Open navigation menu' });
  // A click that lands before the page hydrates does nothing, so click until it opens.
  await expect(async () => {
    if (!(await drawer.isVisible())) await menu.click({ timeout: 1_000 });
    await expect(drawer).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return drawer;
}

/** The top bar's Add expense (#304): labelled on desktop, an icon button of the same name on phones. */
export const addExpenseButton = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: 'Add expense', exact: true });

/**
 * Open Add expense from the top bar and return the dialog it opens: inside a Group, the Group's
 * Expense form; elsewhere pass the chooser. A click that lands before the page hydrates does
 * nothing, so it clicks until the dialog opens.
 */
export async function openAddExpense(
  page: Page,
  dialog: Locator = page.getByRole('dialog', { name: /^Add expense/ }),
): Promise<Locator> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await addExpenseButton(page).click({ timeout: 1_000 });
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return dialog;
}

/** The theme switch's name, which says the mode it moves to. */
export const THEME_SWITCH_NAME = /^Switch to (dark|light) mode$/;

/**
 * The theme switch: in the top bar, or below 430 px, where the bar has no room for it, at the
 * foot of the drawer, which this opens (src/components/layout/phone-top-bar.ts).
 */
export async function themeSwitch(page: Page) {
  if (page.viewportSize()!.width >= 430)
    return page.getByRole('banner').getByRole('button', { name: THEME_SWITCH_NAME });
  const drawer = await openNavigation(page);
  return drawer.getByRole('button', { name: THEME_SWITCH_NAME });
}

/** Sign out from the account menu at the foot of the sidebar, and land back on the persona picker. */
export async function signOut(page: Page): Promise<void> {
  const navigation = await openNavigation(page);
  await navigation.getByRole('button', { name: 'Account menu' }).click();
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

/** CSS `rgb()` form of a `#rrggbb` token, as getComputedStyle reports it. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/**
 * Assert the document carries the project's expected theme.
 *
 * Two things flip independently: the inline script in the root layout sets
 * `data-theme` before hydration, while the MUI palette (body colour and
 * background, owned by ThemeProvider) follows one frame after hydration. In
 * between, token-driven dark surfaces meet light-palette text, and an axe scan
 * that only waited for the attribute reports contrast violations (#22). Wait
 * for the palette as well.
 */
export async function expectThemeApplied(page: Page, testInfo: TestInfo): Promise<void> {
  const theme = expectedTheme(testInfo);
  const tokens = theme === 'dark' ? darkTokens : lightTokens;
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).color))
    .toBe(hexToRgb(tokens.text));
}

/** Save a full-page screenshot for design review under playwright/artifacts/. */
export async function reviewScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.screenshot({
    path: `playwright/artifacts/${testInfo.project.name}/${name}.png`,
    fullPage: true,
  });
}

/**
 * Check the fully rendered presentation, including serious contrast findings.
 * Wait for fonts and finite entrance animations so an intermediate opacity
 * frame is not mistaken for the screen's final text/background contrast.
 * Keep complete node diagnostics in the report to make failures actionable.
 */
export async function expectNoSeriousA11yViolations(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === 'running' &&
            Number.isFinite(animation.effect?.getTiming().iterations ?? 1),
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  await testInfo.attach(`axe-${name}`, {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  });

  const blocking = results.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        summary: node.failureSummary,
      })),
    }));
  expect(
    blocking,
    `Serious or critical accessibility violations on ${name}: ${JSON.stringify(blocking)}`,
  ).toEqual([]);
}

/** Parse the first currency amount (e.g. "₹1,480.00") found in a text blob. */
export function parseMoneyText(text: string): number {
  const match = text.match(/[₹$€£]([\d,]+(?:\.\d{1,2})?)/);
  if (!match) throw new Error(`No currency amount found in: ${text}`);
  return Number(match[1].replace(/,/g, ''));
}
