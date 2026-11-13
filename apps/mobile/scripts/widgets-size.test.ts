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
    copyFileSync(
      join(process.cwd(), 'assets/widgets/quick-preview.png'),
      join(root, 'assets/widgets/quick-preview.png'),
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
    const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).toMatch(/android:configChanges="[^"]*uiMode/);
    const xml = readFileSync(
      join(root, 'android/app/src/main/res/xml/widget_balances.xml'),
      'utf8',
    );
    expect(xml).toContain('android:minWidth="250dp" android:minHeight="180dp"');
    expect(xml).toContain('android:maxResizeWidth="640dp"');
    expect(xml).toContain('android:maxResizeHeight="640dp"');
    expect(xml).toContain('android:targetCellWidth="4" android:targetCellHeight="3"');
    expect(xml).toContain('android:minResizeWidth="110dp" android:minResizeHeight="40dp"');
    expect(xml).toContain('android:resizeMode="horizontal|vertical"');
    expect(
      readFileSync(join(root, 'android/app/src/main/res/values/widget_balances.xml'), 'utf8'),
    ).toContain('Your balances, payments and Groups');
    expect(xml).toContain('android:updatePeriodMillis="0"');
    expect(xml).toContain('android:widgetFeatures="reconfigurable"');
    expect(xml).toContain('android:configure="com.splitbook.app.dev.widget.GroupConfiguration"');
    const groupXml = readFileSync(
      join(root, 'android/app/src/main/res/xml/widget_group.xml'),
      'utf8',
    );
    expect(groupXml).toContain('android:targetCellWidth="4" android:targetCellHeight="2"');
    expect(groupXml).toContain('android:minResizeWidth="110dp" android:minResizeHeight="110dp"');
    expect(groupXml).toContain('android:maxResizeWidth="640dp" android:maxResizeHeight="640dp"');
    expect(groupXml).toContain('android:resizeMode="horizontal|vertical"');
    expect(groupXml).toContain('android:updatePeriodMillis="0"');
    expect(groupXml).toContain('android:widgetCategory="home_screen|not_keyguard"');
    const quickXml = readFileSync(
      join(root, 'android/app/src/main/res/xml/widget_quick.xml'),
      'utf8',
    );
    expect(manifest).toContain('android:label="Quick actions"');
    for (const attribute of [
      'android:targetCellWidth="2" android:targetCellHeight="1"',
      'android:minResizeWidth="40dp" android:minResizeHeight="40dp"',
      'android:maxResizeWidth="640dp" android:maxResizeHeight="640dp"',
      'android:resizeMode="horizontal|vertical"',
      'android:updatePeriodMillis="0"',
    ])
      expect(quickXml).toContain(attribute);
    expect(
      readFileSync(join(root, 'android/app/src/main/res/values/widget_balances.xml'), 'utf8'),
    ).toContain('Add an Expense or record a payment in one tap');
    const activity = readFileSync(
      join(root, 'android/app/src/main/java/com/splitbook/app/dev/widget/GroupConfiguration.java'),
      'utf8',
    );
    for (const [kind, provider] of [
      ['balances', 'Balances'],
      ['group', 'Group'],
      ['quick', 'Quick'],
    ]) {
      const providerXml = readFileSync(
        join(root, `android/app/src/main/res/xml/widget_${kind}.xml`),
        'utf8',
      );
      expect(providerXml).toContain(
        'android:configure="com.splitbook.app.dev.widget.GroupConfiguration"',
      );
      expect(providerXml).toContain('android:widgetFeatures="reconfigurable"');
      expect(activity).toContain(
        `"com.splitbook.app.dev.widget.${provider}".equals(info.provider.getClassName())`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
