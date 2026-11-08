const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

// Keep the provider declared when disabled so an upgrade can disable existing widgets too.
module.exports = function withAndroidWidgets(config, { enabled = false } = {}) {
  config = withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    app.receiver = (app.receiver ?? []).filter(
      (item) => item.$['android:name'] !== '.widget.Balances',
    );
    app.receiver.push({
      $: {
        'android:name': '.widget.Balances',
        'android:label': 'Balances',
        'android:enabled': String(enabled),
        'android:exported': 'false',
      },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } },
            { $: { 'android:name': `${config.android.package}.WIDGET_CLICK` } },
          ],
        },
      ],
      'meta-data': [
        {
          $: {
            'android:name': 'android.appwidget.provider',
            'android:resource': '@xml/widget_balances',
          },
        },
      ],
    });
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const main = path.join(mod.modRequest.platformProjectRoot, 'app/src/main');
      const javaDir = path.join(
        main,
        'java',
        config.android.package.replaceAll('.', '/'),
        'widget',
      );
      fs.mkdirSync(javaDir, { recursive: true });
      fs.writeFileSync(
        path.join(javaDir, 'Balances.java'),
        `package ${config.android.package}.widget;\n\npublic class Balances extends com.reactnativeandroidwidget.RNWidgetProvider {}\n`,
      );
      fs.mkdirSync(path.join(main, 'res/xml'), { recursive: true });
      fs.writeFileSync(
        path.join(main, 'res/xml/widget_balances.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="110dp" android:minHeight="110dp"
    android:targetCellWidth="2" android:targetCellHeight="2"
    android:minResizeWidth="110dp" android:minResizeHeight="40dp"
    android:maxResizeWidth="250dp" android:maxResizeHeight="110dp"
    android:resizeMode="horizontal|vertical"
    android:description="@string/widget_balances_description"
    android:initialLayout="@layout/rn_widget"
    android:previewImage="@drawable/widget_balances_preview"
    android:updatePeriodMillis="0" android:widgetCategory="home_screen|not_keyguard" />
`,
      );
      fs.mkdirSync(path.join(main, 'res/drawable'), { recursive: true });
      fs.copyFileSync(
        path.join(mod.modRequest.projectRoot, 'assets/widgets/balances-preview.png'),
        path.join(main, 'res/drawable/widget_balances_preview.png'),
      );
      fs.mkdirSync(path.join(main, 'res/values'), { recursive: true });
      fs.writeFileSync(
        path.join(main, 'res/values/widget_balances.xml'),
        '<resources><string name="widget_balances_description">What you owe and are owed, by currency</string></resources>\n',
      );
      return mod;
    },
  ]);
};
