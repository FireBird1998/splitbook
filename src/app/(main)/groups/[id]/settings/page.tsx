import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import GroupSettingsView from '@/components/groups/GroupSettingsView';

export default async function GroupSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const { id } = await params;

  return <GroupSettingsView groupId={id} userId={session.user.id!} />;
}
