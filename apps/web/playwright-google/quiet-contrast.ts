import { expect, type Locator } from '@playwright/test';

/** Sample the real masked background at each visible copy character, with only its ink hidden. */
export async function sampleCopyContrast(section: Locator) {
  await section.scrollIntoViewIfNeeded();
  const samples = await section.evaluate((root) => {
    const origin = root.getBoundingClientRect();
    const result: { x: number; y: number; color: string; text: string }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement!;
      if (
        !parent.closest('h1,h2,h3,p,button,a,li') ||
        parent.closest('[aria-hidden="true"],style,script')
      )
        continue;
      const css = getComputedStyle(parent);
      if (css.visibility === 'hidden' || css.display === 'none' || css.clip !== 'auto') continue;
      for (let i = 0; i < (node.textContent?.length ?? 0); i++) {
        if (!node.textContent![i].trim()) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) continue;
        result.push({
          x: Math.floor(rect.x - origin.x + rect.width / 2),
          y: Math.floor(rect.y - origin.y + rect.height / 2),
          color: css.color,
          text: node.textContent!.trim().slice(0, 90),
        });
      }
    }
    root.setAttribute('data-contrast-sample', '');
    return result;
  });
  const page = section.page();
  const hide = await page.addStyleTag({
    content:
      '[data-contrast-sample] :is(h1,h2,h3,p,button,a,li,span){color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}',
  });
  const image = await section.screenshot({ animations: 'disabled' });
  await hide.evaluate((node) => node.parentNode?.removeChild(node));
  await section.evaluate((root) => root.removeAttribute('data-contrast-sample'));
  const result = await page.evaluate(
    async ({ png, samples }) => {
      const image = new Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const luminance = (rgb: number[]) =>
        rgb
          .map((x) => {
            const c = x / 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const readings = samples
        .map((sample) => {
          const at = (sample.y * canvas.width + sample.x) * 4;
          const bg = Array.from(pixels.slice(at, at + 3));
          const fg = (sample.color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const a = luminance(bg),
            b = luminance(fg);
          return {
            ...sample,
            background: bg,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        })
        .filter((sample) => Number.isFinite(sample.ratio));
      readings.sort((a, b) => a.ratio - b.ratio);
      return { count: readings.length, minimum: readings[0], lowest: readings.slice(0, 10) };
    },
    { png: image.toString('base64'), samples },
  );
  expect(result.count).toBeGreaterThan(10);
  expect(result.minimum.ratio, JSON.stringify(result.lowest)).toBeGreaterThanOrEqual(4.5);
  return result;
}
