import type { Metadata } from 'next';
import { mcpResource } from '@/lib/mcp/config';
import ConnectChatGPT from '@/components/mcp/ConnectChatGPT';
import { whatsLive } from '@/lib/landing/whats-live';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Connect ChatGPT' };

export default function Page() {
  let resource: string | null = null;
  try {
    resource = mcpResource();
  } catch {
    // Invalid deployment configuration must not break the public explanation.
  }
  return <ConnectChatGPT resource={resource} canPrepare={whatsLive().assistants.canPrepare} />;
}
