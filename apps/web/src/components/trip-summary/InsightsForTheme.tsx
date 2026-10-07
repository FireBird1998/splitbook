'use client';

import type { ReactNode } from 'react';
import { hasTripSummary } from '@splitbook/shared/trip-summary';
import { useGroupPage } from '@/components/groups/group-page-context';

/**
 * The Insights tab's one switch on the Theme (#316): a Trip's Insights is its Trip summary,
 * and every other Theme compares Months (#314). The page renders both on the server, with
 * whatever only the server reads, and the Group read on the page picks one.
 */
export default function InsightsForTheme({ trip, months }: { trip: ReactNode; months: ReactNode }) {
  const { group } = useGroupPage();
  return <>{hasTripSummary(group.category) ? trip : months}</>;
}
