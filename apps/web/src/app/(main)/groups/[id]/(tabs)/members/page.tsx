import { groupTabMetadata } from '@/lib/group-page-metadata';
import { GroupMembersTab } from '@/components/groups/GroupTabPanels';

export default function GroupMembersPage() {
  return <GroupMembersTab />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return groupTabMetadata(params, 'members');
}
