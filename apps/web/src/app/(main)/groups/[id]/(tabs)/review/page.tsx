import { getAuthUser } from '@/lib/utils/api-response';
import { redirect, notFound } from 'next/navigation';
import ToReviewPage from '@/components/to-review/ToReviewPage';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.PERSISTENT_DRAFTS_ENABLED !== 'true') notFound();
  const user = await getAuthUser();
  if (!user) redirect('/login');
  const { id } = await params;
  return <ToReviewPage key={`${user.id}:${id}`} accountId={user.id} groupId={id} />;
}
