import { groupTabMetadata } from '@/lib/group-page-metadata';
import { GroupActivityTab } from '@/components/groups/GroupTabPanels';

export default function GroupActivityPage() {
  return <GroupActivityTab />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return groupTabMetadata(params, 'activity');
}
