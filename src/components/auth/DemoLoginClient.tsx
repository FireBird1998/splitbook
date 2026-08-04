'use client';

import { useSearchParams } from 'next/navigation';
import DemoPersonaPicker from '@/components/demo/DemoPersonaPicker';

export default function DemoLoginClient() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  return (
    <DemoPersonaPicker
      callbackUrl={callbackUrl}
      title="Continue as a demo persona"
      subtitle="Choose who you are entering as for this private beta session."
    />
  );
}
