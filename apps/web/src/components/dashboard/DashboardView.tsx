'use client';

import Stack from '@mui/material/Stack';
import BalancesCard from '@/components/dashboard/BalancesCard';
import GroupsTableCard from '@/components/dashboard/GroupsTableCard';
import HomeHeader from '@/components/dashboard/HomeHeader';
import LatestChangesCard from '@/components/dashboard/LatestChangesCard';
import NeedsYouCard from '@/components/dashboard/NeedsYouCard';
import SpendingChartCard from '@/components/dashboard/SpendingChartCard';
import WhereItWentCard from '@/components/dashboard/WhereItWentCard';
import { HomeRow, HomeSlot } from '@/components/dashboard/HomeCard';

interface DashboardViewProps {
  userId: string;
  userName: string;
}

/**
 * Home, laid out in the design canvas's order ("Web portal", Home): rows of a wide card and a
 * narrow one, inside the shell's 1320 px column. Each card is its own component with its own
 * reads, so it loads, fails and is empty on its own. A card joins Home on its own line below.
 */
export default function DashboardView({ userId, userName }: DashboardViewProps) {
  return (
    <Stack spacing={2.5}>
      <HomeHeader userId={userId} />
      <HomeRow>
        <BalancesCard />
        <NeedsYouCard memberName={userName} />
      </HomeRow>
      <HomeRow>
        <SpendingChartCard />
        <WhereItWentCard />
      </HomeRow>
      <HomeRow>
        <GroupsTableCard userId={userId} />
        <HomeSlot width="narrow">
          <LatestChangesCard userId={userId} />
        </HomeSlot>
      </HomeRow>
    </Stack>
  );
}
