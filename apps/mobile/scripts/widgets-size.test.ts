import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { compileModsAsync } from 'expo/config-plugins';
import { expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const withWidgets = require('../plugins/with-android-widgets');
it('generates provider bounds that allow four columns and two rows on the device grid', async () => {
  const root = mkdtempSync(join(tmpdir(), 'splitbook-widget-size-'));
  try {
    mkdirSync(join(root, 'android/app/src/main'), { recursive: true });
    mkdirSync(join(root, 'assets/widgets'), { recursive: true });
    copyFileSync(
      join(process.cwd(), 'assets/widgets/balances-preview.png'),
      join(root, 'assets/widgets/balances-preview.png'),
    );
    copyFileSync(
      join(process.cwd(), 'assets/widgets/group-preview.png'),
      join(root, 'assets/widgets/group-preview.png'),
    );
    writeFileSync(
      join(root, 'android/app/src/main/AndroidManifest.xml'),
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:name=".MainApplication" /></manifest>',
    );
    await compileModsAsync(
      withWidgets(
        { name: 'Splitbook', slug: 'splitbook', android: { package: 'com.splitbook.app.dev' } },
        { enabled: true },
      ),
      { projectRoot: root, platforms: ['android'] },
    );
    const xml = readFileSync(
      join(root, 'android/app/src/main/res/xml/widget_balances.xml'),
      'utf8',
    );
    expect(xml).toContain('android:maxResizeWidth="640dp"');
    expect(xml).toContain('android:maxResizeHeight="220dp"');
    expect(xml).toContain('android:targetCellWidth="2" android:targetCellHeight="2"');
    expect(xml).toContain('android:updatePeriodMillis="0"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
