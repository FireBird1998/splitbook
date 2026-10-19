import { groupPageMetadata } from '@/lib/group-page-metadata';
import { GroupBalancesTab } from '@/components/groups/GroupTabPanels';

export default function GroupBalancesPage() {
  return <GroupBalancesTab />;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return groupPageMetadata(params, 'Balances');
}
