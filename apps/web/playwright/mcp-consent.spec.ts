import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { enterAsPersona, expectThemeApplied, reviewScreenshot } from './fixtures';

// Run against the real, seeded MCP-enabled app with playwright.mcp-consent.config.ts.
test.skip(process.env.MCP_CONSENT_TEST !== 'true', 'Requires the MCP consent configuration');

/** Alex's own Group, which Alex sets to Not allowed for a run and back afterwards (#621). */
const NOT_ALLOWED = 'Studio Lunch Club';
let notAllowedId: string | null = null;

async function setAssistantRule(page: Page, rule: 'allowed' | 'not_allowed') {
  if (!notAllowedId) {
    const groups = await page.request.get('/api/groups');
    expect(groups.status()).toBe(200);
    const listed = (await groups.json()).data as { _id: string; name: string }[];
    notAllowedId = listed.find((group) => group.name === NOT_ALLOWED)!._id;
  }
  const changed = await page.request.put(`/api/groups/${notAllowedId}/assistant-rule`, {
    data: { rule },
  });
  expect(changed.status()).toBe(200);
}

// The demo Group goes back to Allowed, as the seed left it.
test.afterEach(async ({ page }) => {
  if (notAllowedId) await setAssistantRule(page, 'allowed');
});

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
    await setAssistantRule(page, 'not_allowed');
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
    // publishes no details, so the page says it has no published address.
    // The name leads the page as its heading (#617).
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Fictional consent test assistant wants to use your Splitbook',
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
    await expect(
      page.getByText('Registered by the assistant itself. Its address isn’t published.', {
        exact: true,
      }),
    ).toBeVisible();
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
    // Which Groups (#617): every Group that allows assistants ticked, with the warning about
    // leaving one out. A Group whose admins don't allow them is greyed out (#621).
    const groupChoice = page.getByRole('group', { name: 'Which Groups' });
    const groupBoxes = groupChoice.getByRole('checkbox');
    expect(await groupBoxes.count()).toBeGreaterThan(2);
    const notAllowed = groupChoice.getByRole('checkbox', { name: new RegExp(`^${NOT_ALLOWED}`) });
    await expect(notAllowed).toBeDisabled();
    await expect(notAllowed).not.toBeChecked();
    for (const box of await groupBoxes.all())
      if (await box.isEnabled()) await expect(box).toBeChecked();
    await expect(
      groupChoice.getByText('You don’t allow assistants in this Group', { exact: true }),
    ).toBeVisible();
    await expect(
      groupChoice.getByText('A Group’s admins decide whether assistants can use it.', {
        exact: true,
      }),
    ).toBeVisible();
    // The To review checkbox lines up with the Groups' checkboxes (#621).
    const left = async (box: typeof permission) => (await box.boundingBox())!.x;
    expect(Math.abs((await left(permission)) - (await left(groupBoxes.first())))).toBeLessThan(1);
    await expect(
      page.getByText(
        'Groups you untick are left out of Fictional consent test assistant’s answers, so its totals won’t include them.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByText('This connection can access all Groups')).toHaveCount(0);
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
    // The opted-in run also leaves one Group out, which the assistant then never sees (#617).
    if (allowPreparation)
      await groupChoice.getByRole('checkbox', { name: /^Kochi to Alleppey/ }).uncheck();
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
    /** The assistant's list of Groups, as it reads it on its next call. */
    const listGroups = async () => {
      const listed = await request.post(resource, {
        headers: {
          Authorization: `Bearer ${issued.access_token}`,
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        data: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_groups', arguments: {} },
        },
      });
      expect(listed.status()).toBe(200);
      return listed.text();
    };
    const reply = await listGroups();
    expect(reply).toContain('Banyan Court Flat 4B');
    expect(reply).not.toContain(NOT_ALLOWED);
    if (allowPreparation) expect(reply).not.toContain('Kochi to Alleppey');
    else expect(reply).toContain('Kochi to Alleppey');
    // Its own page (#620): a Group unticked and saved there leaves the assistant's next call,
    // with the same token, and comes back once ticked again.
    if (!allowPreparation) {
      const listing = await page.request.get('/api/auth/mcp/connections');
      const connections = (await listing.json()).connections as { id: string; clientId: string }[];
      const own = connections.find((connection) => connection.clientId === clientId)!;
      await page.goto(`/settings/assistants/${own.id}`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Fictional consent test assistant' }),
      ).toBeVisible();
      const onItsPage = page.getByRole('group', { name: 'Which Groups' });
      const banyan = onItsPage.getByRole('checkbox', { name: /^Banyan Court Flat 4B/ });
      const save = page.getByRole('button', { name: 'Save changes', exact: true });
      await banyan.uncheck();
      await save.click();
      await expect(page.getByText(/^Saved\. /)).toBeVisible();
      expect(await listGroups()).not.toContain('Banyan Court Flat 4B');
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);
      await banyan.check();
      await save.click();
      await expect(save).toBeDisabled();
      expect(await listGroups()).toContain('Banyan Court Flat 4B');
    }
    // Asked to approve the same assistant again, the page starts from the choice in force,
    // never from every Group ticked (#617).
    await page.goto(
      `/api/auth/oauth2/authorize?${new URLSearchParams({
        ...Object.fromEntries(query),
        state: 'fictional-consent-again',
        code_challenge: createHash('sha256')
          .update(randomBytes(32).toString('base64url'))
          .digest('base64url'),
      })}`,
    );
    await expect(page).toHaveURL(/\/mcp\/consent\?/);
    const again = page.getByRole('group', { name: 'Which Groups' });
    await expect(again.getByRole('checkbox', { name: /^Banyan Court Flat 4B/ })).toBeChecked();
    const kochi = again.getByRole('checkbox', { name: /^Kochi to Alleppey/ });
    if (allowPreparation) await expect(kochi).not.toBeChecked();
    else await expect(kochi).toBeChecked();
  });
}
