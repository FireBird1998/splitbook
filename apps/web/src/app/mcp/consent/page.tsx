import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/utils/api-response';
import { mcpResource } from '@/lib/mcp/config';
import { oauthPageQuery } from '@/lib/mcp/page-query';
import OAuthFlow from '@/components/mcp/OAuthFlow';
import { assistantLedgerService } from '@/lib/services/assistant-ledger.service';

export const dynamic = 'force-dynamic';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!mcpResource()) notFound();
  const query = oauthPageQuery(await searchParams);
  const user = await getAuthUser();
  if (!user) {
    redirect(`/login?${new URLSearchParams({ callbackUrl: '/mcp/consent?' + query })}`);
  }
  return (
    <OAuthFlow
      account={{ id: user.id, name: user.name, email: user.email }}
      query={query}
      consent={true}
      groups={await assistantLedgerService.approvalGroups(user.id)}
    />
  );
}
