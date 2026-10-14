import { redirect, notFound } from 'next/navigation';
import { toReviewHref } from '@splitbook/shared/api-paths';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.PERSISTENT_DRAFTS_ENABLED !== 'true') notFound();
  redirect(toReviewHref((await params).id));
}
