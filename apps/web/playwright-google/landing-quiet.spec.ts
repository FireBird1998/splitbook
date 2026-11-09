import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleCopyContrast } from './quiet-contrast';

const ids = ['splitting-line', 'netting-station', 'to-review-rack'];
const art = (id: string) => `[data-quiet-figure="${id}"]`;

test('one pause control freezes and resumes every lazily loaded tour without persisting it', async ({
  page,
}) => {
  await page.goto('/');
  const pause = page.getByRole('button', { name: 'Pause animation' });
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
  await expect(pause).toHaveAttribute('data-tour-speed', '0.6');
  // Pause before the lower tours load: each must inherit the page-wide choice.
  await pause.click();
  for (const id of ids) {
    const stage = page.locator(art(id)).locator('[data-stage]');
    await stage.scrollIntoViewIfNeeded();
    await expect
      .poll(() => stage.locator('[data-count][data-target], [data-line]').count())
      .toBeGreaterThan(0);
    const held = await stage.innerHTML();
    await page.waitForTimeout(250);
    expect(await stage.innerHTML()).toBe(held);
  }
  await page.getByRole('button', { name: 'Play animation' }).click();
  for (const id of ids) {
    const stage = page.locator(art(id)).locator('[data-stage]');
    await stage.scrollIntoViewIfNeeded();
    const before = await stage.innerHTML();
    await expect.poll(() => stage.innerHTML(), { timeout: 12000 }).not.toBe(before);
  }
  await page.reload();
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
});

test('the pause control follows the hero actions in the tab order and has a visible focus ring', async ({
  page,
}) => {
  await page.goto('/');
  const lastAction = page
    .locator('#hero a, #hero button')
    .filter({ hasNotText: /Pause animation|Play animation/ })
    .last();
  await lastAction.focus();
  await page.keyboard.press('Tab');
  const pause = page.getByRole('button', { name: 'Pause animation' });
  await expect(pause).toBeFocused();
  const focus = await pause.evaluate((el) => {
    const css = getComputedStyle(el);
    return { outline: css.outlineStyle, shadow: css.boxShadow };
  });
  expect(focus.outline !== 'none' || focus.shadow !== 'none').toBe(true);
});

test('decorations ignore input, stop off screen, and ship the complete MIT notice', async ({
  page,
}) => {
  const chunks: string[] = [];
  page.on('response', async (response) => {
    if (response.url().split('?')[0].endsWith('.js')) {
      const text = await response.text().catch(() => '');
      if (text.includes('play.license') || text.includes('Anatomy kit (')) chunks.push(text);
    }
  });
  await page.goto('/');
  for (const id of ids) {
    await page.locator(art(id)).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }
  await page.getByRole('button', { name: 'Pause animation' }).click();
  for (const id of ids) {
    const root = page.locator(art(id));
    await expect(root).toHaveAttribute('aria-hidden', 'true');
    await expect(root).toHaveCSS('pointer-events', 'none');
    expect(await root.locator('button,a,[tabindex],[aria-live]').count()).toBe(0);
    const stage = root.locator('[data-stage]');
    const before = await stage.innerHTML();
    await stage.dispatchEvent('click');
    for (const key of ['ArrowRight', ' ', 'Enter', 'Home'])
      await stage.dispatchEvent('keydown', { key });
    expect(await stage.innerHTML()).toBe(before);
  }
  await page.getByRole('button', { name: 'Play animation' }).click();
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const hero = page.locator(art(ids[0])).locator('[data-stage]');
  const hidden = await hero.innerHTML();
  await page.waitForTimeout(300);
  expect(await hero.innerHTML()).toBe(hidden);
  expect(chunks.length).toBeGreaterThanOrEqual(3);
  for (const source of chunks) {
    expect(source).toContain('Anatomy kit (https://github.com/wheresryan22/anatomy)');
    expect(source).toContain('Copyright (c) 2026 Ryan');
    expect(source).toContain('Permission is hereby granted, free of charge');
  }
});

for (const width of [1440, 390])
  for (const colorScheme of ['light', 'dark'] as const) {
    const view = `${width === 1440 ? 'desktop' : 'phone'}-${colorScheme}`;
    test(`${view}: themed stills, section-end bands and contrast over actual masked art`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      const scripts: string[] = [];
      page.on('request', (r) => {
        if (r.url().includes('quiet-tour')) scripts.push(r.url());
      });
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByRole('button', { name: /^(Pause|Play) animation$/ })).toHaveCount(0);
      for (const id of ids) {
        const root = page.locator(art(id));
        await root.scrollIntoViewIfNeeded();
        await expect(root.locator(`.sbq-still-${colorScheme}`)).toBeVisible();
        await expect(root.locator('[data-stage]')).toBeHidden();
        if (width === 390 && id !== 'splitting-line') {
          await expect(root).toHaveCSS('position', 'relative');
          const position = await root.evaluate((el) => {
            const section = el.closest('section')!;
            return {
              end: el.getBoundingClientRect().bottom,
              children: [...section.querySelectorAll('h2,p,li')]
                .filter((x) => !x.closest('[aria-hidden]'))
                .map((x) => x.getBoundingClientRect().bottom),
            };
          });
          expect(Math.max(...position.children)).toBeLessThan(position.end);
        }
      }
      expect(scripts).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
      const output = process.env.LANDING_EVIDENCE_DIR ?? info.outputDir;
      mkdirSync(output, { recursive: true });
      const results = [];
      for (const section of ['hero', 'settle', 'assistants']) {
        const element = page.locator('#' + section);
        results.push({ section, ...(await sampleCopyContrast(element)) });
        await element.screenshot({
          path: join(output, `${view}-${section}.png`),
          animations: 'disabled',
        });
      }
      await page.screenshot({
        path: join(output, `${view}-full.png`),
        fullPage: true,
        animations: 'disabled',
      });
      writeFileSync(join(output, `${view}-contrast.json`), JSON.stringify(results, null, 2) + '\n');
    });
  }
