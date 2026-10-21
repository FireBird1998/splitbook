import type { Metadata } from 'next';
import { mcpResource } from '@/lib/mcp/config';
import ConnectAssistant from '@/components/mcp/ConnectAssistant';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Connect an assistant' };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { assistant } = await searchParams;
  let resource: string | null = null;
  try {
    resource = mcpResource();
  } catch {
    // Invalid deployment configuration must not break the public explanation.
  }
  return (
    <ConnectAssistant
      resource={resource}
      assistant={typeof assistant === 'string' ? assistant : undefined}
    />
  );
}
