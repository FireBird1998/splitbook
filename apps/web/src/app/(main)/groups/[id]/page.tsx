import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import GroupDetailView from '@/components/groups/GroupDetailView';

export default async function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) redirect('/login');

  const { id } = await params;

  return <GroupDetailView groupId={id} userId={user.id} />;
}
