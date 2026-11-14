package __WIDGET_PACKAGE__;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.provider.Settings;
import com.reactnativeandroidwidget.RNWidgetJsCommunication;

/** The system observes this URI even when the app process has died (API 24+). */
public class FontScaleJob extends JobService {
  private static final int JOB_ID = 0x53425746;
  private static final String[] KINDS = { "Balances", "Group", "Quick", "Person" };

  private static boolean placed(Context context, String kind) {
    return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(
        context.getPackageName(), context.getPackageName() + ".widget." + kind)).length > 0;
  }

  private static void schedule(Context context, JobScheduler jobs) {
    jobs.schedule(new JobInfo.Builder(JOB_ID, new ComponentName(context, FontScaleJob.class))
        .addTriggerContentUri(new JobInfo.TriggerContentUri(
            Settings.System.getUriFor(Settings.System.FONT_SCALE), 0))
        .setTriggerContentUpdateDelay(500)
        .setTriggerContentMaxDelay(1000)
        .build());
  }

  /** Keep one event-driven watch while any widget is placed; never poll or fetch. */
  public static void watch(Context context) {
    JobScheduler jobs = context.getSystemService(JobScheduler.class);
    if (jobs == null) return;
    for (String kind : KINDS) {
      if (placed(context, kind)) {
        if (jobs.getPendingJob(JOB_ID) == null) schedule(context, jobs);
        return;
      }
    }
    jobs.cancel(JOB_ID);
  }

  @Override public boolean onStartJob(JobParameters params) {
    JobScheduler jobs = getSystemService(JobScheduler.class);
    boolean any = false;
    for (String kind : KINDS) any |= placed(this, kind);
    if (any) {
      // Content jobs are one-shot. Re-arm before queueing the saved-copy redraws so a
      // second font change during rendering is observed too. No periodic job is needed.
      schedule(this, jobs);
      for (String kind : KINDS) {
        if (placed(this, kind)) RNWidgetJsCommunication.requestWidgetUpdate(this, kind);
      }
    } else {
      jobs.cancel(JOB_ID);
    }
    return false;
  }

  @Override public boolean onStopJob(JobParameters params) {
    return true;
  }
}
