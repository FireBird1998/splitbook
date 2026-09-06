import { expect, test } from '@playwright/test';

test('production catalogue is unavailable as HTML or a client-navigation payload', async ({
  page,
  request,
}) => {
  for (const suffix of ['', '?enabled=true', '/']) {
    const response = await request.get(`/dev/design-system${suffix}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('Local examples · synthetic data');
  }
  await page.goto('/dev/design-system');
  await expect(page.getByRole('heading', { name: 'Splitbook design system' })).toHaveCount(0);
  await page.goto('/login');
  // App Router client navigation requests the RSC representation rather than HTML.
  const flight = await page.request.get('/dev/design-system', { headers: { RSC: '1' } });
  expect(flight.status()).toBe(404);
  expect(await flight.text()).not.toContain('Local examples · synthetic data');
  const protectedPage = await request.get('/dev/design-system/private', { maxRedirects: 0 });
  expect(protectedPage.status()).toBe(307);
  expect(protectedPage.headers().location).toContain('/login');
});
