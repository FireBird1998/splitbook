import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import GroupsListView from '@/components/groups/GroupsListView';

export default async function GroupsPage() {
  const user = await getAuthUser();
  if (!user) redirect('/login');

  return <GroupsListView userId={user.id} />;
}
