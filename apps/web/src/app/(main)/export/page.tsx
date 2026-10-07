import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ExportView from '@/components/export/ExportView';
import { getAuthUser } from '@/lib/utils/api-response';

export const metadata: Metadata = { title: 'Export' };

/**
 * The Export page (#317), from the sidebar or a Group's header. `?group=<id>` picks that Group
 * when the page opens.
 */
export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string | string[] }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect('/login');

  const { group } = await searchParams;
  return (
    <ExportView userId={user.id} preselectedGroupId={typeof group === 'string' ? group : null} />
  );
}
