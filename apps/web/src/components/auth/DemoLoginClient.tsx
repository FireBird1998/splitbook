'use client';

import { useSearchParams } from 'next/navigation';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';
import { resolveCallbackUrl } from '@/lib/auth/callback-url';

export default function DemoLoginClient() {
  const searchParams = useSearchParams();
  const callbackUrl = resolveCallbackUrl(searchParams.get('callbackUrl'));

  return (
    <DemoPersonaPicker
      callbackUrl={callbackUrl}
      title="Continue as a demo persona"
      subtitle="Choose who you are entering as for this private beta session."
    />
  );
}
