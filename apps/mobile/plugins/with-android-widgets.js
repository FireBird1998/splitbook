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
    app.receiver = app.receiver.filter((item) => item.$['android:name'] !== '.widget.Group');
    app.receiver.push({
      $: {
        'android:name': '.widget.Group',
        'android:label': 'Group',
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
            'android:resource': '@xml/widget_group',
          },
        },
      ],
    });
    app.receiver = app.receiver.filter((item) => item.$['android:name'] !== '.widget.Quick');
    app.receiver.push({
      $: {
        'android:name': '.widget.Quick',
        'android:label': 'Add expense',
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
            'android:resource': '@xml/widget_quick',
          },
        },
      ],
    });
    app.service = (app.service ?? []).filter(
      (item) => item.$['android:name'] !== '.widget.FontScaleJob',
    );
    app.service.push({
      $: {
        'android:name': '.widget.FontScaleJob',
        'android:permission': 'android.permission.BIND_JOB_SERVICE',
        'android:exported': 'true',
        'android:enabled': String(enabled),
      },
    });
    app.service = app.service.filter((item) => item.$['android:name'] !== '.widget.DateChangeJob');
    app.service.push({
      $: {
        'android:name': '.widget.DateChangeJob',
        'android:permission': 'android.permission.BIND_JOB_SERVICE',
        'android:exported': 'true',
        'android:enabled': String(enabled),
      },
    });
    app.receiver = app.receiver.filter(
      (item) => item.$['android:name'] !== '.widget.ClockChangeReceiver',
    );
    app.receiver.push({
      $: {
        'android:name': '.widget.ClockChangeReceiver',
        'android:exported': 'false',
        'android:enabled': String(enabled),
      },
      'intent-filter': [
        {
          action: ['TIME_SET', 'TIMEZONE_CHANGED', 'BOOT_COMPLETED'].map((name) => ({
            $: { 'android:name': `android.intent.action.${name}` },
          })),
        },
      ],
    });
    const manifest = mod.modResults.manifest;
    const bootPermission = 'android.permission.RECEIVE_BOOT_COMPLETED';
    // Expo Notifications also declares this in its library manifest. The off build
    // needs a merger removal marker so that permission follows the widget switch.
    manifest['uses-permission'] = (manifest['uses-permission'] ?? []).filter(
      (item) => item.$['android:name'] !== bootPermission,
    );
    manifest['uses-permission'].push({
      $: {
        'android:name': bootPermission,
        ...(!enabled ? { 'tools:node': 'remove' } : {}),
      },
    });
    if (!enabled) manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    app.activity = (app.activity ?? []).filter(
      (item) =>
        ![
          'com.reactnativeandroidwidget.RNWidgetConfigurationActivity',
          '.widget.GroupConfiguration',
        ].includes(item.$['android:name']),
    );
    app.activity.push({
      $: {
        'android:name': '.widget.GroupConfiguration',
        'android:exported': 'true',
        'android:theme': '@style/AppTheme',
        'android:configChanges':
          'keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode',
        'android:enabled': String(enabled),
      },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': 'android.appwidget.action.APPWIDGET_CONFIGURE' } },
            { $: { 'android:name': `${config.android.package}.WIDGET_CONFIGURE` } },
          ],
          category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
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
        path.join(javaDir, 'FontScaleJob.java'),
        fs
          .readFileSync(path.join(__dirname, 'android-widgets/FontScaleJob.java'), 'utf8')
          .replaceAll('__WIDGET_PACKAGE__', `${config.android.package}.widget`),
      );
      for (const name of ['DateChangeJob', 'ClockChangeReceiver']) {
        fs.writeFileSync(
          path.join(javaDir, `${name}.java`),
          fs
            .readFileSync(path.join(__dirname, `android-widgets/${name}.java`), 'utf8')
            .replaceAll('__WIDGET_PACKAGE__', `${config.android.package}.widget`),
        );
      }
      fs.writeFileSync(
        path.join(javaDir, 'Balances.java'),
        `package ${config.android.package}.widget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public class Balances extends com.reactnativeandroidwidget.RNWidgetProvider {
  @Override public void onReceive(Context context, Intent intent) {
    FontScaleJob.watch(context);
    DateChangeJob.watch(context);
    if ((context.getPackageName() + ".WIDGET_CLICK").equals(intent.getAction())
        && "OPEN_URI".equals(intent.getStringExtra("clickAction"))) {
      Bundle data = intent.getBundleExtra("clickActionData");
      String value = data == null ? null : data.getString("uri");
      if (value != null) {
        Uri uri = Uri.parse(value);
        if ("${Array.isArray(config.scheme) ? config.scheme[0] : config.scheme}".equals(uri.getScheme()) && "widget".equals(uri.getHost())) {
          com.facebook.react.ReactHost host =
              ((com.facebook.react.ReactApplication) context.getApplicationContext()).getReactHost();
          boolean running = host != null && host.getCurrentReactContext() != null;
          // A warm tap stays in the existing project; a cold dev-client tap boots its bundle.
          if (running && uri.getQueryParameter("__expo_url") != null)
            uri = uri.buildUpon().clearQuery().build();
          context.startActivity(new Intent(Intent.ACTION_VIEW, uri)
              .setPackage(context.getPackageName()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                  | (running ? 0 : Intent.FLAG_ACTIVITY_CLEAR_TASK)));
          // Starting calibration on a cold host races the app's bundle and session restore.
          if (running) {
            Intent measure = new Intent(intent);
            measure.removeExtra("clickAction");
            super.onReceive(context, measure);
          }
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
      fs.writeFileSync(
        path.join(javaDir, 'Group.java'),
        `package ${config.android.package}.widget;
public class Group extends Balances {}
`,
      );
      fs.writeFileSync(
        path.join(javaDir, 'GroupConfiguration.java'),
        `package ${config.android.package}.widget;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.os.Bundle;
public class GroupConfiguration extends com.reactnativeandroidwidget.RNWidgetConfigurationActivity {
  @Override protected void onCreate(Bundle savedInstanceState) {
    Bundle extras = getIntent().getExtras();
    Object value = extras == null ? null : extras.get(AppWidgetManager.EXTRA_APPWIDGET_ID);
    // React Native sendIntent encodes JS numbers as Double; Android's host sends Integer.
    int id = value instanceof Number ? ((Number)value).intValue() : AppWidgetManager.INVALID_APPWIDGET_ID;
    AppWidgetProviderInfo info = AppWidgetManager.getInstance(this).getAppWidgetInfo(id);
    if (info == null || !getPackageName().equals(info.provider.getPackageName())
        || !("${config.android.package}.widget.Group".equals(info.provider.getClassName())
          || "${config.android.package}.widget.Balances".equals(info.provider.getClassName())
          || "${config.android.package}.widget.Quick".equals(info.provider.getClassName())))
      id = AppWidgetManager.INVALID_APPWIDGET_ID;
    getIntent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id);
    super.onCreate(savedInstanceState);
  }
}
`,
      );
      fs.writeFileSync(
        path.join(javaDir, 'Quick.java'),
        `package ${config.android.package}.widget;\npublic class Quick extends Balances {}\n`,
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
    android:configure="${config.android.package}.widget.GroupConfiguration" android:widgetFeatures="reconfigurable"
    android:updatePeriodMillis="0" android:widgetCategory="home_screen|not_keyguard" />
`,
      );
      fs.writeFileSync(
        path.join(main, 'res/xml/widget_group.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
 android:minWidth="250dp" android:minHeight="110dp" android:targetCellWidth="4" android:targetCellHeight="2"
 android:minResizeWidth="110dp" android:minResizeHeight="110dp" android:maxResizeWidth="640dp" android:maxResizeHeight="640dp"
 android:resizeMode="horizontal|vertical" android:description="@string/widget_group_description"
 android:initialLayout="@layout/rn_widget" android:previewImage="@drawable/widget_group_preview"
 android:configure="${config.android.package}.widget.GroupConfiguration" android:widgetFeatures="reconfigurable"
 android:updatePeriodMillis="0" android:widgetCategory="home_screen|not_keyguard" />
`,
      );
      fs.writeFileSync(
        path.join(main, 'res/xml/widget_quick.xml'),
        `<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android" android:minWidth="40dp" android:minHeight="40dp" android:targetCellWidth="1" android:targetCellHeight="1" android:minResizeWidth="40dp" android:minResizeHeight="40dp" android:maxResizeWidth="250dp" android:maxResizeHeight="110dp" android:resizeMode="horizontal" android:description="@string/widget_quick_description" android:initialLayout="@layout/rn_widget" android:previewImage="@drawable/widget_quick_preview" android:configure="${config.android.package}.widget.GroupConfiguration" android:widgetFeatures="reconfigurable" android:updatePeriodMillis="0" android:widgetCategory="home_screen|not_keyguard" />`,
      );
      fs.mkdirSync(path.join(main, 'res/drawable'), { recursive: true });
      fs.copyFileSync(
        path.join(mod.modRequest.projectRoot, 'assets/widgets/balances-preview.png'),
        path.join(main, 'res/drawable/widget_balances_preview.png'),
      );
      fs.copyFileSync(
        path.join(mod.modRequest.projectRoot, 'assets/widgets/group-preview.png'),
        path.join(main, 'res/drawable/widget_group_preview.png'),
      );
      fs.copyFileSync(
        path.join(mod.modRequest.projectRoot, 'assets/widgets/quick-preview.png'),
        path.join(main, 'res/drawable/widget_quick_preview.png'),
      );
      fs.mkdirSync(path.join(main, 'res/values'), { recursive: true });
      fs.writeFileSync(
        path.join(main, 'res/values/widget_balances.xml'),
        '<resources><string name="widget_quick_description">Start an Expense in a Group</string><string name="widget_group_description">Your balance and Suggested payments in one Group</string><string name="widget_balances_description">What you owe and are owed, by currency</string></resources>\n',
      );
      return mod;
    },
  ]);
};
