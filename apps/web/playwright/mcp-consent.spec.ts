import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { enterAsPersona, expectThemeApplied, reviewScreenshot } from './fixtures';

// Run against the real, seeded MCP-enabled app with playwright.mcp-consent.config.ts.
test.skip(process.env.MCP_CONSENT_TEST !== 'true', 'Requires the MCP consent configuration');

for (const allowPreparation of [false, true]) {
  test(`preparation permission is optional and accessible (opted in=${allowPreparation})`, async ({
    page,
    request,
    baseURL,
  }, testInfo) => {
    const resource = `${baseURL}/api/mcp`;
    const challenge = await request.post(resource);
    expect(challenge.status()).toBe(401);
    const scopes = challenge.headers()['www-authenticate']?.match(/\bscope="([^"]+)"/)?.[1];
    expect(scopes).toBeTruthy();
    const redirectUri = 'https://assistant.example.test/callback';
    const registration = await request.post('/api/auth/oauth2/register', {
      data: {
        client_name: 'Fictional consent test assistant',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        scope: scopes,
      },
    });
    expect(registration.status()).toBe(201);
    const { client_id: clientId } = await registration.json();
    await enterAsPersona(page, 'alex');
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      prompt: 'consent',
      scope: scopes!,
      resource,
      state: 'fictional-consent-test',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    await page.goto(`/api/auth/oauth2/authorize?${query}`);
    await expect(page).toHaveURL(/\/mcp\/consent\?/);
    // Named by the name it registered, with what it can't do (#614). A registered client
    // publishes no details, so no address is shown for it.
    await expect(
      page.getByText('Fictional consent test assistant wants to use your Splitbook', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('What Fictional consent test assistant can’t do', { exact: true }),
    ).toBeVisible();
    for (const limit of [
      'Save Expenses or payments',
      'Change anything in a Group',
      'See Groups left out',
      'See anyone’s email',
    ])
      await expect(page.getByText(limit, { exact: true })).toBeVisible();
    await expect(page.getByText('identified by its published details')).toHaveCount(0);
    // Who is approving, and a caution beside Allow naming the assistant (#614).
    await expect(page.getByText('Signed in as', { exact: true })).toBeVisible();
    await expect(page.getByText('Alex Rivera', { exact: true })).toBeVisible();
    await expect(page.getByText('alex.demo@splitbook.local', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Only allow this if you asked Fictional consent test assistant to connect just now.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText('Splitbook checks your access on every request.', { exact: true }),
    ).toBeVisible();
    const permission = page.getByRole('checkbox', {
      name: 'Also let it prepare Expenses for your To review',
      exact: true,
    });
    await expect(permission).toBeVisible();
    await expect(permission).not.toBeChecked();
    await expect(
      page.getByText(
        'It can add, change and permanently delete items in your To review. Only you can save them as Expenses, in Splitbook.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.getByText('Prepared items don’t change Balances until you save them.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Disconnect at any time in Settings. Your To review items stay yours; disconnecting cannot erase information already shared with the assistant.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/draft/i);
    await page.addStyleTag({ content: 'html { font-size: 130%; }' });
    await expectThemeApplied(page, testInfo);
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
    const accessibility = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await reviewScreenshot(page, testInfo, `mcp-consent-130-${allowPreparation}`);
    if (allowPreparation) await permission.check();
    // Capture only the fictional client's callback; authorization and consent are real.
    await page.route(`${redirectUri}**`, (route) => route.fulfill({ body: 'Connected' }));
    await page.getByRole('button', { name: 'Allow connection', exact: true }).click();
    await page.waitForURL(`${redirectUri}**`);
    const callback = new URL(page.url());
    expect(callback.searchParams.get('state')).toBe('fictional-consent-test');
    const exchange = await request.post(`${baseURL}/api/auth/oauth2/token`, {
      form: {
        grant_type: 'authorization_code',
        client_id: clientId,
        code: callback.searchParams.get('code')!,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource,
      },
    });
    expect(exchange.status()).toBe(200);
    const issued = await exchange.json();
    expect(issued.scope.split(' ').includes('drafts:write')).toBe(allowPreparation);
  });
}
