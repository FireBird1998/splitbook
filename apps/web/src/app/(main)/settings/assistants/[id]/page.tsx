import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import AssistantPage from '@/components/mcp/AssistantPage';
import { whatsLive } from '@/lib/landing/whats-live';
import { getAuthUser } from '@/lib/utils/api-response';

export const metadata: Metadata = { title: 'Connected assistant' };

// One assistant's page (#620), from Settings → Connected assistants.
export default async function ConnectedAssistantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getAuthUser();
  if (!user) redirect('/login');
  if (!whatsLive().assistants.available) notFound();
  const { id } = await params;
  return <AssistantPage id={id} accountId={user.id} />;
}
