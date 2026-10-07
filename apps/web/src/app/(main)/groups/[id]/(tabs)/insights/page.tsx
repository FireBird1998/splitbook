import GroupInsightsTab from '@/components/insights/GroupInsightsTab';
import { recurringExpensesEnabled } from '@/lib/recurring-expenses-switch';

export default function GroupInsightsPage() {
  // The Recurring Expenses card follows the one product-wide switch (#289), which only the
  // server reads.
  return <GroupInsightsTab recurringExpensesEnabled={recurringExpensesEnabled()} />;
}
