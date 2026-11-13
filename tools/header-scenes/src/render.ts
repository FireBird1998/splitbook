/** PNG review of committed output, never an alternative scene build. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { Data, Effect } from 'effect';
import beach from '@splitbook/shared/header-scenes/beach';
import sakura from '@splitbook/shared/header-scenes/sakura';
import ecoCity from '@splitbook/shared/header-scenes/eco-city';
import mountainVillage from '@splitbook/shared/header-scenes/mountain-village';
import { headerSceneCss } from '@splitbook/shared/header-scenes/styles';
import { previewPage } from './preview.ts';

class RenderFailed extends Data.TaggedError('RenderFailed')<{ cause: unknown }> {}
const output = resolve(process.argv[2] ?? 'out');
const render = Effect.acquireUseRelease(
  Effect.tryPromise({
    try: () => chromium.launch({ headless: true, timeout: 15_000 }),
    catch: (cause) => new RenderFailed({ cause }),
  }),
  (browser) =>
    Effect.tryPromise({
      try: async () => {
        mkdirSync(output, { recursive: true });
        const page = await browser.newPage({
          viewport: { width: 1100, height: 240 },
          deviceScaleFactor: 2,
        });
        page.setDefaultTimeout(15_000);
        for (const scene of [ecoCity, mountainVillage, beach, sakura])
          for (const time of ['day', 'night'] as const) {
            const name = `${scene.id}-${time}`;
            const html = previewPage(scene, headerSceneCss, time);
            writeFileSync(resolve(output, `${name}.html`), html);
            await page.setContent(html);
            await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'allow' });
            console.log(`Rendered ${name}.png`);
          }
      },
      catch: (cause) => new RenderFailed({ cause }),
    }).pipe(Effect.timeout('60 seconds')),
  (browser) => Effect.promise(() => browser.close()),
);
await Effect.runPromise(render);
