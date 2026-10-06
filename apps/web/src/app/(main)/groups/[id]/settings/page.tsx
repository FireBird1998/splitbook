import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import GroupSettingsView from '@/components/groups/GroupSettingsView';
import { recurringExpensesEnabled } from '@/lib/recurring-expenses-switch';

export default async function GroupSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect('/login');

  const { id } = await params;

  return (
    <GroupSettingsView
      groupId={id}
      userId={user.id}
      recurringExpensesEnabled={recurringExpensesEnabled()}
    />
  );
}
