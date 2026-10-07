import GroupInsightsTab from '@/components/insights/GroupInsightsTab';
import InsightsForTheme from '@/components/trip-summary/InsightsForTheme';
import TripSummaryTab from '@/components/trip-summary/TripSummaryTab';
import { recurringExpensesEnabled } from '@/lib/recurring-expenses-switch';

export default function GroupInsightsPage() {
  // A Trip's Insights is the whole trip (#316); every other Theme compares Months (#314).
  // The Recurring Expenses card follows the one product-wide switch (#289), which only the
  // server reads.
  return (
    <InsightsForTheme
      trip={<TripSummaryTab />}
      months={<GroupInsightsTab recurringExpensesEnabled={recurringExpensesEnabled()} />}
    />
  );
}
