import { getAuthUser } from '@/lib/utils/api-response';
import { redirect } from 'next/navigation';
import GroupDetailView from '@/components/groups/GroupDetailView';

/**
 * Every tab of a Group (#305) shares this layout: the Group read, its header, the trip strip
 * and the tabs stay in place while the tab below them changes.
 */
export default async function GroupTabsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect('/login');

  const { id } = await params;

  return (
    <GroupDetailView groupId={id} userId={user.id}>
      {children}
    </GroupDetailView>
  );
}
