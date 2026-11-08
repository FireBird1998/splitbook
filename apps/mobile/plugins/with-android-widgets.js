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
        `package ${config.android.package}.widget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public class Balances extends com.reactnativeandroidwidget.RNWidgetProvider {
  @Override public void onReceive(Context context, Intent intent) {
    if ((context.getPackageName() + ".WIDGET_CLICK").equals(intent.getAction())
        && "OPEN_URI".equals(intent.getStringExtra("clickAction"))) {
      Bundle data = intent.getBundleExtra("clickActionData");
      String value = data == null ? null : data.getString("uri");
      if (value != null) {
        Uri uri = Uri.parse(value);
        if ("${Array.isArray(config.scheme) ? config.scheme[0] : config.scheme}".equals(uri.getScheme()) && "widget".equals(uri.getHost())) {
          // Read-only navigation must not be consumed by the renderer's size calibration.
          context.startActivity(new Intent(Intent.ACTION_VIEW, uri)
              .setPackage(context.getPackageName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
          Intent measure = new Intent(intent);
          measure.removeExtra("clickAction");
          super.onReceive(context, measure);
          return;
        }
      }
      return;
    }
    super.onReceive(context, intent);
  }
}
`,
      );
      fs.mkdirSync(path.join(main, 'res/xml'), { recursive: true });
      fs.writeFileSync(
        path.join(main, 'res/xml/widget_balances.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="110dp" android:minHeight="110dp"
    android:targetCellWidth="2" android:targetCellHeight="2"
    android:minResizeWidth="110dp" android:minResizeHeight="40dp"
    android:maxResizeWidth="640dp" android:maxResizeHeight="220dp"
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
