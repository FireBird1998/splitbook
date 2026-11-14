package __WIDGET_PACKAGE__;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** System broadcasts enqueue jobs, including when the application process is cold. */
public class ClockChangeReceiver extends BroadcastReceiver {
  @Override public void onReceive(Context context, Intent intent) {
    String action = intent.getAction();
    if (Intent.ACTION_TIME_CHANGED.equals(action) || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
        || Intent.ACTION_BOOT_COMPLETED.equals(action)) DateChangeJob.changed(context);
  }
}
