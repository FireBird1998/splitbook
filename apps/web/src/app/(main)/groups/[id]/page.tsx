import { redirect } from 'next/navigation';
import { groupLandingHref, type SearchParamsRecord } from '@/components/groups/group-tabs';

/**
 * A Group's own address lands on its Expenses tab (#305). Old links keep working:
 * `?tab=balances` opens Balances, and `?action=add-expense` and `?month=` go along to the tab.
 */
export default async function GroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParamsRecord>;
}) {
  const { id } = await params;
  redirect(groupLandingHref(id, await searchParams));
}
