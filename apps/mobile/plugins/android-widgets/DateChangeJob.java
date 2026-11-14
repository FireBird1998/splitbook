package __WIDGET_PACKAGE__;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import java.util.Calendar;
import com.reactnativeandroidwidget.RNWidgetJsCommunication;

/** One saved-copy redraw at the next local midnight, re-armed for the following day. */
public class DateChangeJob extends JobService {
  private static final int JOB_ID = 0x53425744;
  private static final int IMMEDIATE_JOB_ID = 0x53425745;
  private static final String[] KINDS = { "Balances", "Group", "Quick" };

  private static boolean placed(Context context, String kind) {
    return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(
        context.getPackageName(), context.getPackageName() + ".widget." + kind)).length > 0;
  }

  private static void clockReceiver(Context context, boolean placed) {
    PackageManager packages = context.getPackageManager();
    ComponentName receiver = new ComponentName(context, ClockChangeReceiver.class);
    int state = placed ? PackageManager.COMPONENT_ENABLED_STATE_DEFAULT
        : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
    if (packages.getComponentEnabledSetting(receiver) != state)
      packages.setComponentEnabledSetting(receiver, state, PackageManager.DONT_KILL_APP);
  }

  public static void watch(Context context) {
    JobScheduler jobs = context.getSystemService(JobScheduler.class);
    if (jobs == null) return;
    for (String kind : KINDS) {
      if (placed(context, kind)) {
        clockReceiver(context, true);
        if (jobs.getPendingJob(JOB_ID) == null) {
          Calendar midnight = Calendar.getInstance();
          long now = midnight.getTimeInMillis();
          midnight.add(Calendar.DAY_OF_MONTH, 1);
          midnight.set(Calendar.HOUR_OF_DAY, 0);
          midnight.set(Calendar.MINUTE, 0);
          midnight.set(Calendar.SECOND, 0);
          midnight.set(Calendar.MILLISECOND, 0);
          jobs.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(context, DateChangeJob.class))
              .setMinimumLatency(Math.max(1, midnight.getTimeInMillis() - now)).build());
        }
        return;
      }
    }
    clockReceiver(context, false);
    jobs.cancel(JOB_ID);
    jobs.cancel(IMMEDIATE_JOB_ID);
  }

  /** A broadcast only schedules work. The job supplies Android's background-service allowance. */
  public static void changed(Context context) {
    JobScheduler jobs = context.getSystemService(JobScheduler.class);
    if (jobs == null) return;
    jobs.cancel(JOB_ID);
    watch(context);
    if (jobs.getPendingJob(JOB_ID) != null)
      jobs.schedule(new JobInfo.Builder(IMMEDIATE_JOB_ID,
          new ComponentName(context, DateChangeJob.class)).setMinimumLatency(1).build());
  }

  @Override public boolean onStartJob(JobParameters params) {
    if (params.getJobId() == JOB_ID) {
      JobScheduler jobs = getSystemService(JobScheduler.class);
      if (jobs != null) jobs.cancel(JOB_ID);
    }
    watch(this);
    for (String kind : KINDS) {
      if (placed(this, kind)) RNWidgetJsCommunication.requestWidgetUpdate(this, kind);
    }
    return false;
  }

  @Override public boolean onStopJob(JobParameters params) {
    return true;
  }
}
