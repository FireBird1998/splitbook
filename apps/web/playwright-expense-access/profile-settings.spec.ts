import type { Page } from '@playwright/test';
import { test, expect, dataOf, type Ledger } from './fixtures';

const profilePath = '/api/user/profile';

function appURL(path: string) {
  const origin = process.env.EXPENSE_ACCESS_BASE_URL;
  if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw new Error('Isolated app required');
  return `${origin}${path}`;
}

async function enter(page: Page, ledger: Ledger, path: string) {
  await page.context().addCookies((await ledger.sam.storageState()).cookies);
  await page.goto(appURL(path));
}

async function chooseCurrency(page: Page, label: string, code: string, keyboard = false) {
  const select = page.getByRole('combobox', { name: new RegExp(`^${label}`) });
  const option = page.getByRole('option', { name: new RegExp(` ${code} —`) });
  if (keyboard) {
    await select.focus();
    await select.press('Enter');
    await option.press('Enter');
  } else {
    await select.click();
    await option.click();
  }
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release: () => release() };
}

test.beforeEach(async ({ ledger }) => {
  await dataOf(
    await ledger.sam.patch(profilePath, {
      data: { name: 'Sam Chen', preferredCurrency: 'INR' },
    }),
  );
});

test('profile validation rejects blank names without changing persisted values', async ({
  ledger,
}) => {
  expect(
    (await ledger.anonymous.patch(profilePath, { data: { name: 'Anonymous' } })).status(),
  ).toBe(401);
  const before = await dataOf(await ledger.sam.get(profilePath));
  for (const name of ['', '   ', '\n\t', 'x'.repeat(101)]) {
    const result = await ledger.sam.patch(profilePath, {
      data: { name, preferredCurrency: 'USD' },
    });
    expect(result.status(), await result.text()).toBe(422);
    expect(await dataOf(await ledger.sam.get(profilePath))).toEqual(before);
  }
  expect(
    (await ledger.sam.patch(profilePath, { data: { preferredCurrency: 'XXX' } })).status(),
  ).toBe(422);
  expect(await dataOf(await ledger.sam.get(profilePath))).toEqual(before);
});

test('profile names trim before length validation and omitted fields remain unchanged', async ({
  ledger,
}) => {
  const name = 'N'.repeat(100);
  expect(
    await dataOf(
      await ledger.sam.patch(profilePath, {
        data: { name: `  ${name}  ` },
      }),
    ),
  ).toMatchObject({ name, preferredCurrency: 'INR' });
  await dataOf(await ledger.sam.patch(profilePath, { data: { preferredCurrency: 'USD' } }));
  expect(await dataOf(await ledger.sam.get(profilePath))).toMatchObject({
    name,
    preferredCurrency: 'USD',
  });
});

test('saved profile currency is selected and persisted when creating a new Group', async ({
  page,
  ledger,
}) => {
  await enter(page, ledger, '/settings');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Sam Chen');
  await page.getByLabel('Name', { exact: true }).fill('  Sam Preference  ');
  await chooseCurrency(page, 'Preferred Currency', 'USD');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Settings saved!')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Sam Preference');
  expect(await dataOf(await ledger.sam.get(profilePath))).toMatchObject({
    name: 'Sam Preference',
    preferredCurrency: 'USD',
  });
  await page.goto(appURL('/groups/new'));
  await expect(page.getByRole('combobox', { name: /^Currency/ })).toContainText('USD');
  await page.getByLabel('Trip name').fill('Saved currency Group');
  await page.getByRole('button', { name: 'Create trip', exact: true }).click();
  // A new Group opens on its Expenses tab: its own address redirects there (#305).
  await expect(page).toHaveURL(/\/groups\/[a-f0-9]{24}\/expenses$/);
  const groupId = new URL(page.url()).pathname.split('/').at(-2);
  expect(await dataOf(await ledger.sam.get(`/api/groups/${groupId}`))).toMatchObject({
    defaultCurrency: 'USD',
  });
});

test('blank profile names show a field error before any save request', async ({ page, ledger }) => {
  await enter(page, ledger, '/settings');
  const name = page.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue('Sam Chen');
  const saves: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === profilePath && request.method() === 'PATCH')
      saves.push(request.postData() ?? '');
  });
  for (const value of ['', '   ']) {
    await name.fill(value);
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('Name is required');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveValue(value);
  }
  expect(saves).toEqual([]);
  expect(await dataOf(await ledger.sam.get(profilePath))).toMatchObject({ name: 'Sam Chen' });
});

for (const failure of [
  {
    label: '422',
    status: 422,
    json: { error: 'Profile validation failed' },
    message: 'Profile validation failed',
  },
  {
    label: '500',
    status: 500,
    json: { error: 'Profile temporarily unavailable' },
    message: 'Profile temporarily unavailable',
  },
  { label: 'non-JSON 500', status: 500, message: 'Failed to save settings. Please try again.' },
  { label: 'network', message: 'Failed to save settings. Please try again.' },
]) {
  test(`profile ${failure.label} failure keeps the draft and allows a successful retry`, async ({
    page,
    ledger,
  }, testInfo) => {
    if (failure.label === '500') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'dark' });
    }
    await enter(page, ledger, '/settings');
    const name = page.getByLabel('Name', { exact: true });
    await expect(name).toHaveValue('Sam Chen');
    await name.fill('Preserved profile draft');
    await chooseCurrency(page, 'Preferred Currency', 'EUR');
    await page.route('**/api/user/profile', async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      if (!failure.status) return route.abort('failed');
      if (failure.json) return route.fulfill({ status: failure.status, json: failure.json });
      return route.fulfill({
        status: failure.status,
        contentType: 'text/plain',
        body: 'Unavailable',
      });
    });
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(failure.message);
    await expect(name).toHaveValue('Preserved profile draft');
    await expect(page.getByRole('combobox', { name: 'Preferred Currency' })).toContainText('EUR');
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
    await expect(page.getByText('Settings saved!')).toHaveCount(0);
    expect(await dataOf(await ledger.sam.get(profilePath))).toMatchObject({
      name: 'Sam Chen',
      preferredCurrency: 'INR',
    });
    if (failure.label === '500')
      await page.screenshot({
        path: testInfo.outputPath('mobile-profile-save-error.png'),
        fullPage: true,
      });
    await page.unroute('**/api/user/profile');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByText('Settings saved!')).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: failure.message })).toHaveCount(0);
    expect(await dataOf(await ledger.sam.get(profilePath))).toMatchObject({
      name: 'Preserved profile draft',
      preferredCurrency: 'EUR',
    });
  });
}

for (const chosenCurrency of [null, 'EUR', 'INR']) {
  test(`late profile loading preserves the edited name${chosenCurrency ? ` and explicitly chosen ${chosenCurrency}` : ' while applying the saved currency'}`, async ({
    page,
    ledger,
  }) => {
    await dataOf(await ledger.sam.patch(profilePath, { data: { preferredCurrency: 'USD' } }));
    const response = deferred();
    await page.route('**/api/user/profile', async (route) => {
      if (route.request().method() === 'GET') await response.promise;
      await route.continue();
    });
    try {
      await enter(page, ledger, '/settings');
      await page.getByLabel('Name', { exact: true }).fill('Typing before profile loads');
      if (chosenCurrency)
        await chooseCurrency(page, 'Preferred Currency', chosenCurrency, chosenCurrency === 'INR');
      await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
      response.release();
      await expect(page.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
        'Typing before profile loads',
      );
      await expect(page.getByRole('combobox', { name: 'Preferred Currency' })).toContainText(
        chosenCurrency ?? 'USD',
      );
      await page.getByRole('button', { name: 'Save Changes' }).click();
      await expect(page.getByText('Settings saved!')).toBeVisible();
      expect(await dataOf(await ledger.sam.get(profilePath))).toMatchObject({
        name: 'Typing before profile loads',
        preferredCurrency: chosenCurrency ?? 'USD',
      });
    } finally {
      response.release();
    }
  });
}

for (const chosenCurrency of ['EUR', 'INR']) {
  test(`late saved currency does not replace an explicit new Group ${chosenCurrency} selection`, async ({
    page,
    ledger,
  }) => {
    await dataOf(await ledger.sam.patch(profilePath, { data: { preferredCurrency: 'USD' } }));
    const response = deferred();
    await page.route('**/api/user/profile', async (route) => {
      await response.promise;
      await route.continue();
    });
    try {
      await enter(page, ledger, '/groups/new');
      await page.getByLabel('Trip name').fill('Explicit currency Group');
      await expect(page.getByRole('button', { name: 'Create trip', exact: true })).toBeDisabled();
      await chooseCurrency(page, 'Currency', chosenCurrency, chosenCurrency === 'INR');
      await expect(page.getByRole('button', { name: 'Create trip', exact: true })).toBeEnabled();
      const loaded = page.waitForResponse(
        (result) => new URL(result.url()).pathname === profilePath,
      );
      response.release();
      await loaded;
      await expect(page.getByRole('combobox', { name: /^Currency/ })).toContainText(chosenCurrency);
      await page.getByRole('button', { name: 'Create trip', exact: true }).click();
      await expect(page).toHaveURL(/\/groups\/[a-f0-9]{24}\/expenses$/);
      const groupId = new URL(page.url()).pathname.split('/').at(-2);
      expect(await dataOf(await ledger.sam.get(`/api/groups/${groupId}`))).toMatchObject({
        defaultCurrency: chosenCurrency,
      });
    } finally {
      response.release();
    }
  });
}

test('profile load failure is visible and retry preserves input already entered', async ({
  page,
  ledger,
}) => {
  await page.route('**/api/user/profile', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  );
  await enter(page, ledger, '/settings');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Could not load your profile',
  );
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  await page.getByLabel('Name', { exact: true }).fill('Draft before retry');
  await page.unroute('**/api/user/profile');
  await page.getByRole('button', { name: 'Retry loading profile' }).click();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeEnabled();
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Draft before retry');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});

for (const invalidPreference of [false, true]) {
  test(`new Group keeps a supported fallback after ${invalidPreference ? 'an unsupported saved currency' : 'profile loading fails'}`, async ({
    page,
    ledger,
  }) => {
    await page.route('**/api/user/profile', (route) =>
      route.fulfill({
        status: invalidPreference ? 200 : 503,
        json: invalidPreference ? { data: { preferredCurrency: 'XXX' } } : { error: 'Unavailable' },
      }),
    );
    await enter(page, ledger, '/groups/new');
    await page.getByLabel('Trip name').fill('Fallback currency Group');
    await expect(page.getByRole('button', { name: 'Create trip', exact: true })).toBeEnabled();
    await expect(page.getByRole('combobox', { name: /^Currency/ })).toContainText('INR');
    await expect(page.getByText('Loading saved currency…')).toHaveCount(0);
  });
}
