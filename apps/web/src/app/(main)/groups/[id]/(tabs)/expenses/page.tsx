import { groupTabMetadata } from '@/lib/group-page-metadata';
import GroupExpensesTab from '@/components/groups/GroupExpensesTab';
import { recurringExpensesEnabled } from '@/lib/recurring-expenses-switch';

export default function GroupExpensesPage() {
  // Repeat icons follow the one product-wide switch (#289), which only the server reads.
  return <GroupExpensesTab recurringExpensesEnabled={recurringExpensesEnabled()} />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return groupTabMetadata(params, 'expenses');
}
