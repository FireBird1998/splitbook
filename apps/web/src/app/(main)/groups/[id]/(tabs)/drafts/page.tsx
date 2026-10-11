import { getAuthUser } from '@/lib/utils/api-response';
import { redirect, notFound } from 'next/navigation';
import DraftCollection from '@/components/drafts/DraftCollection';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.PERSISTENT_DRAFTS_ENABLED !== 'true') notFound();
  const user = await getAuthUser();
  if (!user) redirect('/login');
  return (
    <DraftCollection
      key={`${user.id}:${(await params).id}`}
      accountId={user.id}
      groupId={(await params).id}
    />
  );
}
