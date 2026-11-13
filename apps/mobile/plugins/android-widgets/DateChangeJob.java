package __WIDGET_PACKAGE__;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import java.util.Calendar;
import com.reactnativeandroidwidget.RNWidgetJsCommunication;

/** One saved-copy redraw at the next local midnight, re-armed for the following day. */
public class DateChangeJob extends JobService {
  private static final int JOB_ID = 0x53425744;
  private static final String[] KINDS = { "Balances", "Group", "Quick" };

  private static boolean placed(Context context, String kind) {
    return AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(
        context.getPackageName(), context.getPackageName() + ".widget." + kind)).length > 0;
  }

  public static void watch(Context context) {
    JobScheduler jobs = context.getSystemService(JobScheduler.class);
    if (jobs == null) return;
    for (String kind : KINDS) {
      if (placed(context, kind)) {
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
    jobs.cancel(JOB_ID);
  }

  /** Clock/zone changes and boot recalculate midnight before requesting the headless renderer. */
  public static void changed(Context context) {
    JobScheduler jobs = context.getSystemService(JobScheduler.class);
    if (jobs != null) jobs.cancel(JOB_ID);
    watch(context);
    for (String kind : KINDS) {
      if (placed(context, kind)) RNWidgetJsCommunication.requestWidgetUpdate(context, kind);
    }
  }

  @Override public boolean onStartJob(JobParameters params) {
    changed(this);
    return false;
  }

  @Override public boolean onStopJob(JobParameters params) {
    return true;
  }
}
