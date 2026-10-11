import { notFound, redirect } from 'next/navigation';
import { getAuthUser } from '@/lib/utils/api-response';
import { mcpResource } from '@/lib/mcp/config';
import { oauthPageQuery } from '@/lib/mcp/page-query';
import OAuthFlow from '@/components/mcp/OAuthFlow';

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
  return <OAuthFlow accountId={user.id} query={query} consent={true} />;
}
