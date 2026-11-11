export const metadataReads = [
  { name: 'Expenses title', load: () => import('@/app/(main)/groups/[id]/(tabs)/expenses/page') },
  { name: 'Balances title', load: () => import('@/app/(main)/groups/[id]/(tabs)/balances/page') },
  { name: 'Activity title', load: () => import('@/app/(main)/groups/[id]/(tabs)/activity/page') },
  { name: 'Insights title', load: () => import('@/app/(main)/groups/[id]/(tabs)/insights/page') },
  { name: 'Members title', load: () => import('@/app/(main)/groups/[id]/(tabs)/members/page') },
  { name: 'To review title', load: () => import('@/app/(main)/groups/[id]/(tabs)/review/page') },
  { name: 'Settings title', load: () => import('@/app/(main)/groups/[id]/settings/page') },
];
